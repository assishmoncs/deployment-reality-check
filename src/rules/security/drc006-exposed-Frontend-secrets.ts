import { Finding } from '../../core/finding';
import { DeploymentRule, RuleEvaluationContext } from '../../core/rule-engine';
import { isSensitiveEnvName } from '../../utils/redactor';

const SAFE_PUBLIC_KEYS = new Set([
  'NEXT_PUBLIC_API_URL',
  'NEXT_PUBLIC_APP_URL',
  'NEXT_PUBLIC_SITE_URL',
  'NEXT_PUBLIC_SUPABASE_URL',
  'NEXT_PUBLIC_SUPABASE_ANON_KEY',
  'NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY',
  'VITE_API_URL',
  'VITE_APP_URL',
  'VITE_SUPABASE_URL',
  'VITE_SUPABASE_ANON_KEY',
  'VITE_STRIPE_PUBLISHABLE_KEY',
]);

export const drc006ExposedFrontendSecretsRule: DeploymentRule = {
  definition: {
    id: 'DRC006',
    name: 'Sensitive server environment variables exposed to frontend code',
    category: 'security',
    defaultSeverity: 'critical',
    defaultConfidence: 'high',
    platforms: ['vercel', 'railway'],
    autofixEligible: false,
    fixSafety: 'manual-guided',
    summary: 'Client-side frontend code references private server secrets or uses public prefixes (NEXT_PUBLIC_/VITE_) on sensitive credentials.',
    whatItMeans:
      'Your browser-side code accesses a secret environment variable (such as a database URL, private API key, or service role token), or prefixes a private secret with NEXT_PUBLIC_ or VITE_.',
    whyItHappens:
      'Developers sometimes access process.env.SECRET_KEY inside React components or add NEXT_PUBLIC_ / VITE_ to make an undefined variable work in the browser without realizing it embeds the secret in public JavaScript bundles.',
    deploymentImpact:
      'If prefixed with NEXT_PUBLIC_ or VITE_, the secret is compiled directly into public browser bundles where any visitor can steal it. If unprefixed, it evaluates to undefined in the browser and breaks runtime calls.',
    whenItApplies:
      'Applies when client-side files access sensitive environment variables or when any NEXT_PUBLIC_* / VITE_* variable name contains sensitive secret markers (like SECRET, PRIVATE_KEY, SERVICE_ROLE, DATABASE_URL, PASSWORD).',
    howToResolve:
      'Move calls that require secret credentials to server-side API routes or backend endpoints, and remove NEXT_PUBLIC_ / VITE_ prefixes from private secrets.',
    PlatformNotes: {
      vercel:
        'Vercel inlines NEXT_PUBLIC_* and VITE_* variables into static client JavaScript bundles at build time.',
      railway:
        'Client bundles built on Railway embed NEXT_PUBLIC_* and VITE_* values into browser assets.',
    },
    docsUrls: {
      vercel: 'https://vercel.com/docs/projects/environment-variables',
      railway: 'https://docs.railway.com/variables',
    },
  },

  evaluate(ctx: RuleEvaluationContext): Finding[] {
    const { manifest, platform, adapter } = ctx;
    const findings: Finding[] = [];
    const seen = new Set<string>();

    for (const usage of manifest.envUsages) {
      if (usage.isTestFile) continue;
      if (SAFE_PUBLIC_KEYS.has(usage.name)) continue;

      const isPublicPrefixed =
        usage.name.startsWith('NEXT_PUBLIC_') ||
        usage.name.startsWith('VITE_') ||
        usage.name.startsWith('REACT_APP_');

      const hasPublicDangerKeyword =
        /(SECRET|PRIVATE|SERVICE_ROLE|DATABASE_URL|PASSWORD|PASSWD|ADMIN_TOKEN|STRIPE_SECRET)/i.test(
          usage.name,
        );

      if (isPublicPrefixed && hasPublicDangerKeyword) {
        const key = `${usage.file}:${usage.line}:${usage.name}`;
        if (seen.has(key)) continue;
        seen.add(key);

        findings.push({
          ruleId: 'DRC006',
          title: 'Secret exposed via public frontend environment prefix',
          severity: 'critical',
          confidence: 'high',
          platform,
          category: 'security',
          message: `Variable '${usage.name}' uses a public client prefix (NEXT_PUBLIC_ / VITE_) on a sensitive credential name. Its value will be bundled into public browser code.`,
          whyItHappens: this.definition.whyItHappens,
          deploymentImpact: this.definition.deploymentImpact,
          evidence: `Public-prefixed secret '${usage.name}' in ${usage.file}:${usage.line}`,
          file: usage.file,
          line: usage.line,
          column: usage.column,
          suggestedFix: `Remove the public prefix from '${usage.name}' and access it only inside server-side API routes or backend controllers.`,
          fix: {
            eligible: false,
            safety: 'manual-guided',
            description: 'Move secret usage to a backend API route and rename the variable without NEXT_PUBLIC_/VITE_.',
          },
          docsUrl: adapter.capabilities.officialDocs.environmentVariables,
        });
        continue;
      }

      if (usage.isClientFile && !isPublicPrefixed && isSensitiveEnvName(usage.name)) {
        const key = `${usage.file}:${usage.line}:${usage.name}`;
        if (seen.has(key)) continue;
        seen.add(key);

        findings.push({
          ruleId: 'DRC006',
          title: 'Server secret referenced inside client-side component',
          severity: 'critical',
          confidence: 'high',
          platform,
          category: 'security',
          message: `Client-side file ${usage.file} directly references server secret '${usage.name}'. Do not expose server secrets to client components.`,
          whyItHappens: this.definition.whyItHappens,
          deploymentImpact: this.definition.deploymentImpact,
          evidence: `process.env.${usage.name} referenced in client file ${usage.file}:${usage.line}`,
          file: usage.file,
          line: usage.line,
          column: usage.column,
          suggestedFix: `Create a server-side API endpoint that uses '${usage.name}' securely and call that endpoint from ${usage.file}.`,
          fix: {
            eligible: false,
            safety: 'manual-guided',
            description: 'Move sensitive environment variable access to server-side code.',
          },
          docsUrl: adapter.capabilities.officialDocs.environmentVariables,
        });
      }
    }

    return findings;
  },
};
