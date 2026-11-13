import { Finding } from '../../core/finding';
import { DeploymentRule, RuleEvaluationContext } from '../../core/rule-engine';

const BUILTIN_ENV_VARS = new Set([
  'NODE_ENV',
  'PORT',
  'HOST',
  'TZ',
  'CI',
  'VERCEL',
  'VERCEL_ENV',
  'VERCEL_URL',
  'VERCEL_REGION',
  'RAILWAY_ENVIRONMENT',
  'RAILWAY_ENVIRONMENT_NAME',
  'RAILWAY_PUBLIC_DOMAIN',
  'RAILWAY_PRIVATE_DOMAIN',
  'RAILWAY_STATIC_URL',
  'RAILWAY_VOLUME_MOUNT_PATH',
  'RAILWAY_VOLUME_NAME',
  'MODE',
  'DEV',
  'PROD',
  'SSR',
  'BASE_URL',
]);

export const drc001MissingEnvConfigRule: DeploymentRule = {
  definition: {
    id: 'DRC001',
    name: 'Missing required environment configuration',
    category: 'environment',
    defaultSeverity: 'warning',
    defaultConfidence: 'high',
    platforms: ['vercel', 'railway'],
    autofixEligible: true,
    fixSafety: 'safe-auto',
    summary:
      'Application references environment variables without documenting them in .env.example or fallback configuration.',
    whatItMeans:
      'Your source code reads environment variables (via process.env or import.meta.env) that have no default fallback and are not documented in a .env.example template.',
    whyItHappens:
      'During local development, variables often live in an untracked .env.local or shell session. When deploying to a new cloud environment, undocumented variables are frequently forgotten.',
    deploymentImpact:
      'If required variables (like DATABASE_URL, API keys, or auth secrets) are missing in the cloud dashboard, your build may fail or your server may crash at runtime.',
    whenItApplies:
      'Applies when non-test code reads custom environment variables without a default value and those variables are missing from .env.example.',
    howToResolve:
      'Create or update .env.example with safe placeholder keys for every required environment variable, then configure the real values in your hosting provider dashboard.',
    PlatformNotes: {
      vercel:
        'Configure required variables under Project Settings -> Environment Variables for Production, Preview, and Development.',
      railway:
        'Configure required variables in the Service -> Variables tab or link shared project variables.',
    },
    docsUrls: {
      vercel: 'https://vercel.com/docs/projects/environment-variables',
      railway: 'https://docs.railway.com/variables',
    },
  },

  evaluate(ctx: RuleEvaluationContext): Finding[] {
    const { manifest, platform, adapter } = ctx;
    const prodUsages = manifest.envUsages.filter(
      (u) => !u.isTestFile && !BUILTIN_ENV_VARS.has(u.name),
    );

    if (prodUsages.length === 0) return [];

    // Group by variable name (keep first occurrence for file/line reporting)
    const missingFromTemplate = new Map<string, (typeof prodUsages)[0]>();
    for (const usage of prodUsages) {
      if (usage.hasFallback) continue;
      if (manifest.envFacts.definedInEnvExample.has(usage.name)) continue;
      // Check if defined in vercel.json env
      const vercelEnv = manifest.configFacts.vercelJsonRaw?.env as
        Record<string, unknown> | undefined;
      if (vercelEnv && usage.name in vercelEnv) continue;

      if (!missingFromTemplate.has(usage.name)) {
        missingFromTemplate.set(usage.name, usage);
      }
    }

    if (missingFromTemplate.size === 0) return [];

    const missingVars = Array.from(missingFromTemplate.keys()).sort();
    const firstUsage = missingFromTemplate.get(missingVars[0]!)!;
    const hasNoExampleFile = manifest.envFacts.envExampleFilesFound.length === 0;

    return [
      {
        ruleId: 'DRC001',
        title: 'Missing required environment configuration',
        severity: 'warning',
        confidence: 'high',
        platform,
        category: 'environment',
        message: hasNoExampleFile
          ? `Your project references ${missingVars.length} required environment variable(s) (${missingVars.join(', ')}) without a .env.example template or code fallback.`
          : `Environment variable(s) (${missingVars.join(', ')}) are referenced in production code without a fallback and are missing from .env.example.`,
        whyItHappens: this.definition.whyItHappens,
        deploymentImpact: this.definition.deploymentImpact,
        evidence: `Referenced variable(s): ${missingVars.join(', ')} (first seen at ${firstUsage.file}:${firstUsage.line})`,
        file: firstUsage.file,
        line: firstUsage.line,
        column: firstUsage.column,
        suggestedFix:
          'Add placeholder entries for all required environment variables to .env.example and set their production values in your hosting platform dashboard.',
        fix: {
          eligible: true,
          safety: 'safe-auto',
          description: `Generate or update .env.example with safe placeholders for: ${missingVars.join(', ')}`,
        },
        docsUrl: adapter.capabilities.officialDocs.environmentVariables,
      },
    ];
  },
};
