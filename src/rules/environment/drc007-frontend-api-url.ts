import { Finding } from '../../core/finding';
import { DeploymentRule, RuleEvaluationContext } from '../../core/rule-engine';

export const drc007FrontendApiUrlRule: DeploymentRule = {
  definition: {
    id: 'DRC007',
    name: 'Incorrect frontend API URL configuration',
    category: 'environment',
    defaultSeverity: 'warning',
    defaultConfidence: 'high',
    platforms: ['vercel', 'railway'],
    autofixEligible: true,
    fixSafety: 'approval-required',
    summary:
      'Frontend code accesses unprefixed environment variables that are stripped from browser bundles in Next.js or Vite.',
    whatItMeans:
      'Your client-side frontend code reads an environment variable like process.env.API_URL or import.meta.env.API_URL without the framework-required NEXT_PUBLIC_ or VITE_ prefix, or mixes the wrong framework prefix.',
    whyItHappens:
      'Next.js only exposes NEXT_PUBLIC_* variables to browser code, and Vite only exposes VITE_* variables. Unprefixed variables are stripped out for security and evaluate to undefined in the browser.',
    deploymentImpact:
      'Your deployed frontend will make requests to "undefined/api/..." or fail to initialize API clients in production.',
    whenItApplies:
      'Applies when client-side code in Next.js reads non-NEXT_PUBLIC_ environment variables (excluding NODE_ENV) or when React+Vite code reads process.env.* or non-VITE_ environment variables.',
    howToResolve:
      'Rename client-facing API URL variables to start with NEXT_PUBLIC_ (for Next.js) or VITE_ (for React + Vite).',
    PlatformNotes: {
      vercel:
        'Ensure renamed NEXT_PUBLIC_* or VITE_* variables are also updated in Vercel Project Settings.',
      railway:
        'Ensure build-time frontend variables are available during the container build step.',
    },
    docsUrls: {
      vercel: 'https://vercel.com/docs/projects/environment-variables',
      railway: 'https://docs.railway.com/builds/dockerfiles',
    },
  },

  evaluate(ctx: RuleEvaluationContext): Finding[] {
    const { manifest, platform, adapter } = ctx;
    const findings: Finding[] = [];

    for (const usage of manifest.envUsages) {
      if (usage.isTestFile || !usage.isClientFile) continue;
      if (['NODE_ENV', 'MODE', 'DEV', 'PROD', 'SSR', 'BASE_URL'].includes(usage.name)) continue;

      // Skip sensitive secrets already caught by DRC006
      if (/(SECRET|PRIVATE|SERVICE_ROLE|DATABASE_URL|PASSWORD|PASSWD)/i.test(usage.name)) {
        continue;
      }

      const isNextClient =
        manifest.primaryFramework === 'nextjs' ||
        manifest.services.some(
          (s) =>
            s.framework === 'nextjs' &&
            (s.relativePath === '.' || usage.file.startsWith(`${s.relativePath}/`)),
        );

      const isViteClient =
        manifest.primaryFramework === 'react-vite' ||
        manifest.services.some(
          (s) =>
            s.framework === 'react-vite' &&
            (s.relativePath === '.' || usage.file.startsWith(`${s.relativePath}/`)),
        );

      if (isViteClient && !usage.name.startsWith('VITE_')) {
        const suggestedName = `VITE_${usage.name.replace(/^(REACT_APP_|NEXT_PUBLIC_)/, '')}`;
        findings.push({
          ruleId: 'DRC007',
          title: 'Unprefixed frontend environment variable in Vite client code',
          severity: 'warning',
          confidence: 'high',
          platform,
          category: 'environment',
          message: `Frontend file ${usage.file}:${usage.line} reads '${usage.name}', which does not have the required 'VITE_' prefix and will be undefined in the browser.`,
          whyItHappens: this.definition.whyItHappens,
          deploymentImpact: this.definition.deploymentImpact,
          evidence: `Client env access '${usage.name}' in ${usage.file}:${usage.line}`,
          file: usage.file,
          line: usage.line,
          column: usage.column,
          suggestedFix: `Use 'import.meta.env.${suggestedName}' and define '${suggestedName}' in your environment settings.`,
          fix: {
            eligible: true,
            safety: 'approval-required',
            description: `Rename client environment variable '${usage.name}' to '${suggestedName}' in ${usage.file}`,
          },
          docsUrl: adapter.capabilities.officialDocs.environmentVariables,
        });
      } else if (isNextClient && !isViteClient && !usage.name.startsWith('NEXT_PUBLIC_')) {
        const suggestedName = `NEXT_PUBLIC_${usage.name.replace(/^(REACT_APP_|VITE_)/, '')}`;
        findings.push({
          ruleId: 'DRC007',
          title: 'Unprefixed frontend environment variable in Next.js client code',
          severity: 'warning',
          confidence: 'high',
          platform,
          category: 'environment',
          message: `Client-side file ${usage.file}:${usage.line} reads 'process.env.${usage.name}'. Without the 'NEXT_PUBLIC_' prefix, Next.js strips this variable from browser bundles.`,
          whyItHappens: this.definition.whyItHappens,
          deploymentImpact: this.definition.deploymentImpact,
          evidence: `process.env.${usage.name} in client file ${usage.file}:${usage.line}`,
          file: usage.file,
          line: usage.line,
          column: usage.column,
          suggestedFix: `Rename the variable to '${suggestedName}' (process.env.${suggestedName}).`,
          fix: {
            eligible: true,
            safety: 'approval-required',
            description: `Rename 'process.env.${usage.name}' to 'process.env.${suggestedName}' in ${usage.file}`,
          },
          docsUrl: adapter.capabilities.officialDocs.environmentVariables,
        });
      }
    }

    return findings;
  },
};
