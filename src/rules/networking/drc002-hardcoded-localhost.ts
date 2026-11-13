import { Finding } from '../../core/finding';
import { DeploymentRule, RuleEvaluationContext } from '../../core/rule-engine';

export const drc002HardcodedLocalhostRule: DeploymentRule = {
  definition: {
    id: 'DRC002',
    name: 'Hardcoded localhost URLs in production code',
    category: 'networking',
    defaultSeverity: 'warning',
    defaultConfidence: 'high',
    platforms: ['vercel', 'railway'],
    autofixEligible: true,
    fixSafety: 'approval-required',
    summary:
      'Production source code contains hardcoded localhost or 127.0.0.1 URLs without an environment variable override.',
    whatItMeans:
      'Your application directly connects to http://localhost or http://127.0.0.1 instead of reading the target URL from an environment variable.',
    whyItHappens:
      'During local development, frontend and backend services run on localhost ports. Hardcoding these URLs works on your laptop but fails once deployed.',
    deploymentImpact:
      'In browser code, localhost points to the visitor’s own device rather than your cloud server. In backend code, localhost tries to connect to the container itself instead of external services.',
    whenItApplies:
      'Applies when non-test, non-logging code contains a hardcoded localhost URL that is not guarded by an environment variable fallback (e.g., process.env.API_URL || "http://localhost:3000").',
    howToResolve:
      'Replace hardcoded localhost URLs with environment variables (such as NEXT_PUBLIC_API_URL, VITE_API_URL, or API_BASE_URL) with a local fallback for development.',
    PlatformNotes: {
      vercel:
        'Use NEXT_PUBLIC_API_URL (Next.js) or VITE_API_URL (Vite) or relative /api paths when frontend and API share the same Vercel deployment.',
      railway:
        'Use environment variables referencing your Railway public domain (RAILWAY_PUBLIC_DOMAIN) or private service networking.',
    },
    docsUrls: {
      vercel: 'https://vercel.com/docs/projects/environment-variables',
      railway: 'https://docs.railway.com/variables/reference',
    },
  },

  evaluate(ctx: RuleEvaluationContext): Finding[] {
    const { manifest, platform, adapter } = ctx;
    const findings: Finding[] = [];

    for (const usage of manifest.localhostUsages) {
      if (usage.isTestFile) continue;
      if (usage.isServerListenLog) continue;
      if (usage.hasEnvFallback) continue;

      // Avoid double-flagging if this exact file+line is already a CORS origin config (handled by DRC008)
      const isCorsLine = manifest.corsUsages.some(
        (c) => c.file === usage.file && c.line === usage.line,
      );
      if (isCorsLine) continue;

      const envVarSuggestion =
        manifest.primaryFramework === 'nextjs' && usage.isClientFile
          ? 'process.env.NEXT_PUBLIC_API_URL'
          : manifest.primaryFramework === 'react-vite' && usage.isClientFile
            ? 'import.meta.env.VITE_API_URL'
            : 'process.env.API_BASE_URL';

      findings.push({
        ruleId: 'DRC002',
        title: 'Localhost API URL detected',
        severity: usage.isClientFile ? 'critical' : 'warning',
        confidence: 'high',
        platform,
        category: 'networking',
        message: usage.isClientFile
          ? `Your production frontend references ${usage.urlOrHost}. In production, this points to the visitor's own machine instead of your server.`
          : `Your production backend references hardcoded ${usage.urlOrHost} without an environment variable override.`,
        whyItHappens: this.definition.whyItHappens,
        deploymentImpact: this.definition.deploymentImpact,
        evidence: `Hardcoded URL "${usage.urlOrHost}" in ${usage.file}:${usage.line}`,
        file: usage.file,
        line: usage.line,
        column: usage.column,
        suggestedFix: `Configure a production API URL using environment variables (e.g., ${envVarSuggestion} || '${usage.urlOrHost}').`,
        fix: {
          eligible: true,
          safety: 'approval-required',
          description: `Wrap '${usage.urlOrHost}' with environment variable fallback (${envVarSuggestion} || '${usage.urlOrHost}')`,
        },
        docsUrl: adapter.capabilities.officialDocs.environmentVariables,
      });
    }

    return findings;
  },
};
