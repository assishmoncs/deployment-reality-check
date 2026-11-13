import { Finding } from '../../core/finding';
import { DeploymentRule, RuleEvaluationContext } from '../../core/rule-engine';

export const drc005PortHostBindingRule: DeploymentRule = {
  definition: {
    id: 'DRC005',
    name: 'Incorrect host or port binding',
    category: 'networking',
    defaultSeverity: 'critical',
    defaultConfidence: 'high',
    platforms: ['vercel', 'railway'],
    autofixEligible: true,
    fixSafety: 'approval-required',
    summary: 'Server binds to a hardcoded port or loopback host (127.0.0.1/localhost) instead of dynamic process.env.PORT and 0.0.0.0.',
    whatItMeans:
      'Your HTTP server calls app.listen(...) with a fixed port number (like 3000 or 8080) or binds exclusively to 127.0.0.1/localhost.',
    whyItHappens:
      'Locally, binding to a fixed port like 3000 or localhost works because you connect from the same machine. Cloud container platforms dynamically assign a PORT via environment variable and route traffic from an external proxy.',
    deploymentImpact:
      'On Railway, binding to a hardcoded port or 127.0.0.1 prevents the load balancer from reaching your container, causing health checks to fail and return 502 Bad Gateway. On Vercel, unconditional app.listen() without exporting the Express app is incompatible with serverless invocation.',
    whenItApplies:
      'Applies when an Express/Node server calls .listen() with a hardcoded port, binds to 127.0.0.1/localhost on Railway, or calls unconditional .listen() without exporting the handler on Vercel.',
    howToResolve:
      'Use `process.env.PORT || 3000` and bind to `0.0.0.0` (or omit the host argument so Node binds to all interfaces). For Vercel, export the Express app as default/module.exports.',
    PlatformNotes: {
      vercel:
        'Vercel invokes exported request handlers directly; guard app.listen() with `if (process.env.NODE_ENV !== "production")` or export the Express instance.',
      railway:
        'Railway injects `process.env.PORT` at runtime and routes traffic over the container network interface (`0.0.0.0`).',
    },
    docsUrls: {
      vercel: 'https://vercel.com/docs/frameworks/backend/express',
      railway: 'https://docs.railway.com/deployments/reference',
    },
  },

  evaluate(ctx: RuleEvaluationContext): Finding[] {
    const { manifest, platform, adapter } = ctx;
    const findings: Finding[] = [];

    for (const call of manifest.listenCalls) {
      if (platform === 'railway') {
        if (call.hostAddress === '127.0.0.1' || call.hostAddress === 'localhost') {
          findings.push({
            ruleId: 'DRC005',
            title: 'Server bound to loopback interface (127.0.0.1 / localhost)',
            severity: 'critical',
            confidence: 'high',
            platform,
            category: 'networking',
            message: `Server in ${call.file}:${call.line} binds to '${call.hostAddress}'. Railway's external proxy cannot route traffic to a container loopback interface.`,
            whyItHappens: this.definition.whyItHappens,
            deploymentImpact: this.definition.deploymentImpact,
            evidence: `listen(..., '${call.hostAddress}') in ${call.file}:${call.line}`,
            file: call.file,
            line: call.line,
            column: call.column,
            suggestedFix: `Bind to '0.0.0.0' and use process.env.PORT (e.g., app.listen(process.env.PORT || ${call.hardcodedPort ?? 3000}, '0.0.0.0')).`,
            fix: {
              eligible: true,
              safety: 'approval-required',
              description: `Update listen() call in ${call.file}:${call.line} to use process.env.PORT and '0.0.0.0'`,
            },
            docsUrl: adapter.capabilities.officialDocs.limits,
          });
          continue;
        }

        if (!call.usesProcessEnvPort && call.hardcodedPort !== undefined) {
          findings.push({
            ruleId: 'DRC005',
            title: 'Hardcoded server port binding',
            severity: 'critical',
            confidence: 'high',
            platform,
            category: 'networking',
            message: `Server in ${call.file}:${call.line} listens on hardcoded port ${call.hardcodedPort} instead of reading process.env.PORT.`,
            whyItHappens: this.definition.whyItHappens,
            deploymentImpact: this.definition.deploymentImpact,
            evidence: `app.listen(${call.hardcodedPort}) without process.env.PORT in ${call.file}:${call.line}`,
            file: call.file,
            line: call.line,
            column: call.column,
            suggestedFix: `Use process.env.PORT with a fallback: app.listen(process.env.PORT || ${call.hardcodedPort}, '0.0.0.0').`,
            fix: {
              eligible: true,
              safety: 'approval-required',
              description: `Replace hardcoded port ${call.hardcodedPort} with process.env.PORT || ${call.hardcodedPort}`,
            },
            docsUrl: adapter.capabilities.officialDocs.limits,
          });
        }
      } else if (platform === 'vercel') {
        // Do not flag Express app if its platform-specific startup handling is valid (exports app and guards listen, or exports app)
        if (!call.exportsServerlessApp && !call.isConditionalServerlessGuard) {
          findings.push({
            ruleId: 'DRC005',
            title: 'Unconditional app.listen() without serverless export on Vercel',
            severity: 'warning',
            confidence: 'medium',
            platform,
            category: 'networking',
            message: `Server in ${call.file}:${call.line} calls unconditional .listen() without exporting the request handler for Vercel Functions.`,
            whyItHappens: this.definition.whyItHappens,
            deploymentImpact: this.definition.deploymentImpact,
            evidence: `Unconditional .listen() in ${call.file}:${call.line} with no default/module export`,
            file: call.file,
            line: call.line,
            column: call.column,
            suggestedFix:
              'Export your Express `app` (e.g., `export default app`) and guard `app.listen(process.env.PORT || 3000)` for local development.',
            fix: {
              eligible: false,
              safety: 'manual-guided',
              description: 'Export the Express app instance and conditionally invoke app.listen() when not running on Vercel.',
            },
            docsUrl: 'https://vercel.com/docs/frameworks/backend/express',
          });
        }
      }
    }

    return findings;
  },
};
