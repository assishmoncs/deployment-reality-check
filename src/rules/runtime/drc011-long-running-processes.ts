import { Finding } from '../../core/finding';
import { DeploymentRule, RuleEvaluationContext } from '../../core/rule-engine';

export const drc011LongRunningProcessesRule: DeploymentRule = {
  definition: {
    id: 'DRC011',
    name: 'Platform-incompatible long-running processes',
    category: 'runtime',
    defaultSeverity: 'critical',
    defaultConfidence: 'high',
    platforms: ['vercel', 'railway'],
    autofixEligible: false,
    fixSafety: 'manual-guided',
    summary:
      'Application starts in-process cron jobs, persistent queue workers, background timers, or stateful WebSocket servers on a serverless platform.',
    whatItMeans:
      'Your code spawns background tasks (node-cron, BullMQ workers, setInterval loops) or attaches a persistent WebSocketServer (ws / socket.io) inside an environment that freezes or terminates instances after each HTTP response.',
    whyItHappens:
      'In a local Node.js process, the event loop stays alive continuously. On serverless platforms like Vercel, functions spin up per request and terminate once the HTTP response completes.',
    deploymentImpact:
      'On Vercel, in-process cron timers and background workers will silently stop executing between requests, and stateful WebSocket connections cannot be maintained across serverless invocations.',
    whenItApplies:
      'Applies when non-test code uses in-process cron schedulers, background worker loops, or WebSocket servers on serverless platforms (Vercel). Note: Vercel function timeout limits depend on plan and runtime (Hobby: 300s max; Pro/Enterprise: 300s default, up to 800s configurable, 1800s beta with Fluid Compute).',
    howToResolve:
      'On Vercel, replace node-cron with Vercel Cron Jobs (`crons` in vercel.json), use Vercel Queues/Workflows for background tasks, or deploy stateful WebSocket/worker services to a persistent container platform like Railway.',
    PlatformNotes: {
      vercel:
        'Vercel Functions are request-driven (Hobby max 300s; Pro/Ent up to 800s / 1800s beta). Persistent daemons, node-cron, and stateful WebSockets require Vercel Cron Jobs, Vercel Workflows, or an external container host.',
      railway:
        'Railway runs persistent containers that support WebSockets, workers, and in-process schedulers natively (ensure graceful SIGTERM handling on redeploy).',
    },
    docsUrls: {
      vercel: 'https://vercel.com/docs/functions/limitations',
      railway: 'https://docs.railway.com/deployments/reference',
    },
  },

  evaluate(ctx: RuleEvaluationContext): Finding[] {
    const { manifest, platform, adapter } = ctx;
    const findings: Finding[] = [];

    const activeProcesses = manifest.longRunningProcesses.filter((p) => !p.isTestFile);
    if (activeProcesses.length === 0) return [];

    if (!adapter.capabilities.supportsLongRunningProcesses) {
      for (const proc of activeProcesses) {
        const isCritical =
          proc.kind === 'websocket-server' || proc.kind === 'worker-queue' || proc.kind === 'cron';
        findings.push({
          ruleId: 'DRC011',
          title: `Serverless-incompatible ${proc.kind} detected`,
          severity: isCritical ? 'critical' : 'warning',
          confidence: 'high',
          platform,
          category: 'runtime',
          message: `Detected ${proc.kind} (${proc.evidence}) in ${proc.file}:${proc.line}. ${adapter.capabilities.displayName} runs request-driven functions where background loops and stateful sockets do not persist between invocations. (${adapter.capabilities.limitsSummary.functionDurationNote})`,
          whyItHappens: this.definition.whyItHappens,
          deploymentImpact: this.definition.deploymentImpact,
          evidence: `${proc.kind}: ${proc.evidence} at ${proc.file}:${proc.line}`,
          file: proc.file,
          line: proc.line,
          column: proc.column,
          suggestedFix:
            proc.kind === 'cron'
              ? 'Use Vercel Cron Jobs (`crons` in vercel.json) to trigger an API route on a schedule, or deploy this service to Railway.'
              : 'Move persistent WebSocket servers or background queue workers to a container platform like Railway, or use managed serverless queues/realtime services.',
          fix: {
            eligible: false,
            safety: 'manual-guided',
            description:
              'Architectural change required: migrate background daemon/WebSocket to platform-native crons/queues or a container host.',
          },
          docsUrl: adapter.capabilities.officialDocs.limits,
        });
      }
    }

    return findings;
  },
};
