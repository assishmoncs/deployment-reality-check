import { Finding } from '../../core/finding';
import { DeploymentRule, RuleEvaluationContext } from '../../core/rule-engine';

export const drc008CorsMismatchRule: DeploymentRule = {
  definition: {
    id: 'DRC008',
    name: 'CORS origin mismatch',
    category: 'networking',
    defaultSeverity: 'warning',
    defaultConfidence: 'high',
    platforms: ['vercel', 'railway'],
    autofixEligible: true,
    fixSafety: 'approval-required',
    summary:
      'Backend CORS configuration hardcodes a localhost origin or pairs wildcard origin "*" with credentials: true.',
    whatItMeans:
      'Your backend server configures Cross-Origin Resource Sharing (CORS) with a hardcoded localhost origin (e.g., http://localhost:5173) or invalidly combines origin: "*" with credentials: true.',
    whyItHappens:
      'During local development, locking CORS to http://localhost:5173 or http://localhost:3000 allows the local frontend to talk to the local API. When deployed to production domains, browsers reject requests from the real frontend URL.',
    deploymentImpact:
      'Every API call from your deployed frontend will be blocked by the browser with a CORS policy error.',
    whenItApplies:
      'Applies when cors({ origin: ... }) hardcodes localhost without reading process.env.CORS_ORIGIN / FRONTEND_URL, or sets origin: "*" alongside credentials: true.',
    howToResolve:
      'Configure CORS origin via an environment variable (e.g., `origin: process.env.CORS_ORIGIN || "http://localhost:5173"`).',
    PlatformNotes: {
      vercel: 'Set CORS_ORIGIN to your Vercel production domain (and preview domains if needed).',
      railway:
        'Set CORS_ORIGIN in your Railway backend service variables to match your deployed frontend domain.',
    },
    docsUrls: {
      vercel: 'https://vercel.com/docs/projects/environment-variables',
      railway: 'https://docs.railway.com/variables',
    },
  },

  evaluate(ctx: RuleEvaluationContext): Finding[] {
    const { manifest, platform, adapter } = ctx;
    const findings: Finding[] = [];

    for (const cors of manifest.corsUsages) {
      if (cors.isHardcodedLocalhost) {
        findings.push({
          ruleId: 'DRC008',
          title: 'Hardcoded localhost origin in CORS configuration',
          severity: 'warning',
          confidence: 'high',
          platform,
          category: 'networking',
          message: `CORS middleware in ${cors.file}:${cors.line} restricts allowed origin to ${cors.originValue} without reading an environment variable. Requests from your production frontend domain will be blocked.`,
          whyItHappens: this.definition.whyItHappens,
          deploymentImpact: this.definition.deploymentImpact,
          evidence: `cors({ origin: ${cors.originValue} }) in ${cors.file}:${cors.line}`,
          file: cors.file,
          line: cors.line,
          column: cors.column,
          suggestedFix: `Use an environment variable for CORS origin: \`origin: process.env.CORS_ORIGIN || ${cors.originValue}\`.`,
          fix: {
            eligible: true,
            safety: 'approval-required',
            description: `Update cors() origin in ${cors.file}:${cors.line} to use process.env.CORS_ORIGIN || ${cors.originValue}`,
          },
          docsUrl: adapter.capabilities.officialDocs.environmentVariables,
        });
      } else if (cors.usesWildcardWithCredentials) {
        findings.push({
          ruleId: 'DRC008',
          title: 'Invalid CORS wildcard origin with credentials: true',
          severity: 'critical',
          confidence: 'high',
          platform,
          category: 'networking',
          message: `CORS middleware in ${cors.file}:${cors.line} combines \`origin: '*'\` with \`credentials: true\`. Browsers strictly reject wildcard origins when credentials (cookies/authorization headers) are enabled.`,
          whyItHappens: this.definition.whyItHappens,
          deploymentImpact: this.definition.deploymentImpact,
          evidence: `cors({ origin: '*', credentials: true }) in ${cors.file}:${cors.line}`,
          file: cors.file,
          line: cors.line,
          column: cors.column,
          suggestedFix:
            'Replace `origin: "*"` with an explicit origin loaded from `process.env.CORS_ORIGIN`.',
          fix: {
            eligible: true,
            safety: 'approval-required',
            description: `Replace wildcard origin in ${cors.file}:${cors.line} with process.env.CORS_ORIGIN`,
          },
          docsUrl: adapter.capabilities.officialDocs.environmentVariables,
        });
      }
    }

    return findings;
  },
};
