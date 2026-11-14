import { executeExplainCommand } from './commands/explain';
import { executeFixCommand } from './commands/fix';
import { executeScanCommand, ScanCommandOptions } from './commands/scan';
import { executeVerifyCommand } from './commands/verify';

export const DRC_VERSION = '1.0.0';

export function renderMainHelp(): string {
  return `Deployment Reality Check (DRC) v${DRC_VERSION}
Catch deployment problems before production catches you.

USAGE
  $ drc <command> [target] [options]

COMMANDS
  scan [path]       Scan a project for deployment readiness risks
  explain <ruleId>  Explain a deployment rule, why it happens, and how to fix it
  fix [path]        Preview diffs and safely apply automated deployment fixes
  verify [path]     Re-run static checks and optional build/startup verification

GLOBAL OPTIONS
  -v, --version     Show CLI version
  -h, --help        Show help for DRC or a specific command
  --no-color        Disable ANSI color output

EXAMPLES
  $ drc scan .
  $ drc scan ./my-app --platform vercel
  $ drc scan ./my-app --platform railway --format json
  $ drc explain DRC003 --platform vercel
  $ drc fix --dry-run
  $ drc verify --no-exec
`;
}

export function renderCommandHelp(command: string): string {
  switch (command) {
    case 'scan':
      return `Usage: drc scan [path] [options]

Scan a project directory for production deployment risks (read-only).

Options:
  -p, --platform <vercel|railway>           Target deployment platform
  -f, --format <terminal|json|sarif>        Output report format (default: terminal)
  --fail-on <critical|warning|info|none>    Minimum severity that returns exit code 1 (default: critical)
  --non-interactive                         Never prompt interactively
  --no-color                                Disable terminal colors
  -h, --help                                Display help for scan
`;
    case 'explain':
      return `Usage: drc explain <ruleId> [options]

Explain a deployment rule in detail with platform guidance and documentation links.

Options:
  -p, --platform <vercel|railway>           Filter platform notes
  --no-color                                Disable terminal colors
  -h, --help                                Display help for explain
`;
    case 'fix':
      return `Usage: drc fix [path] [options]

Generate proposed fixes, preview unified file diffs, and safely apply changes.

Options:
  -p, --platform <vercel|railway>           Target deployment platform
  --dry-run                                 Show proposed diffs without modifying files
  -y, --yes                                 Approve all eligible patches without prompting
  --non-interactive                         Run without interactive prompts
  --no-color                                Disable terminal colors
  -h, --help                                Display help for fix
`;
    case 'verify':
      return `Usage: drc verify [path] [options]

Re-run static analysis, validate configuration, and optionally test production builds.

Options:
  -p, --platform <vercel|railway>           Target deployment platform
  --build                                   Run production build check (requires --allow-exec in non-interactive mode)
  --startup                                 Run controlled startup port check (requires --allow-exec)
  --allow-exec                              Explicitly permit executing project build/start scripts
  --no-exec                                 Strictly forbid executing any child processes
  --non-interactive                         Run without interactive prompts
  --no-color                                Disable terminal colors
  -h, --help                                Display help for verify
`;
    default:
      return renderMainHelp();
  }
}

export interface CliIo {
  stdout: (msg: string) => void;
  stderr: (msg: string) => void;
}

const defaultIo: CliIo = {
  stdout: (msg: string) => process.stdout.write(`${msg}\n`),
  stderr: (msg: string) => process.stderr.write(`${msg}\n`),
};

export async function runCli(argv: string[], io: CliIo = defaultIo): Promise<number> {
  const args = [...argv];

  if (args.length === 0 || args[0] === '-h' || args[0] === '--help' || args[0] === 'help') {
    if (args[0] === 'help' && args[1]) {
      io.stdout(renderCommandHelp(args[1]));
      return 0;
    }
    io.stdout(renderMainHelp());
    return 0;
  }

  if (args[0] === '-v' || args[0] === '--version' || args[0] === 'version') {
    io.stdout(
      `deployment-reality-check/${DRC_VERSION} ${process.platform}-${process.arch} node-${process.version}`,
    );
    return 0;
  }

  const command = args.shift()!;
  if (!['scan', 'explain', 'fix', 'verify'].includes(command)) {
    io.stderr(`Error: Unknown command '${command}'. Run 'drc --help' to see available commands.`);
    return 2;
  }

  if (args.includes('-h') || args.includes('--help')) {
    io.stdout(renderCommandHelp(command));
    return 0;
  }

  // Parse flags and positional arguments cleanly
  const positional: string[] = [];
  const flags: Record<string, string | boolean> = {};

  const valueFlags = new Set(['platform', 'format', 'fail-on']);
  const booleanFlags = new Set([
    'no-color',
    'non-interactive',
    'dry-run',
    'yes',
    'build',
    'startup',
    'no-exec',
    'allow-exec',
  ]);

  for (let i = 0; i < args.length; i++) {
    const token = args[i]!;
    if (token.startsWith('--')) {
      const eqIdx = token.indexOf('=');
      const key = token.slice(2, eqIdx === -1 ? undefined : eqIdx);
      const inlineValue = eqIdx === -1 ? undefined : token.slice(eqIdx + 1);

      if (valueFlags.has(key)) {
        const value = inlineValue ?? args[i + 1];
        if (!value || (inlineValue === undefined && value.startsWith('-'))) {
          io.stderr(`Error: Flag '--${key}' requires a value.`);
          return 2;
        }
        flags[key] = value;
        if (inlineValue === undefined) i++;
      } else if (booleanFlags.has(key)) {
        const next = args[i + 1];
        const separateBoolean = inlineValue === undefined && (next === 'true' || next === 'false');
        const value = separateBoolean ? next : inlineValue;
        if (value !== undefined && value !== 'true' && value !== 'false') {
          io.stderr(`Error: Flag '--${key}' accepts only true or false.`);
          return 2;
        }
        flags[key] = value !== 'false';
        if (separateBoolean) i++;
      } else {
        io.stderr(`Error: Unknown option '--${key}'. Run 'drc ${command} --help' for usage.`);
        return 2;
      }
    } else if (token.startsWith('-') && token.length > 1) {
      const short = token.slice(1);
      if (short === 'p') {
        const next = args[i + 1];
        if (!next || next.startsWith('-')) {
          io.stderr(`Error: Flag '-p' requires a platform value.`);
          return 2;
        }
        flags.platform = next;
        i++;
      } else if (short === 'f') {
        const next = args[i + 1];
        if (!next || next.startsWith('-')) {
          io.stderr(`Error: Flag '-f' requires a format value.`);
          return 2;
        }
        flags.format = next;
        i++;
      } else if (short === 'y') {
        flags.yes = true;
      } else {
        io.stderr(`Error: Unknown short flag '-${short}'.`);
        return 2;
      }
    } else {
      positional.push(token);
    }
  }

  const noColor = Boolean(flags['no-color']);
  const nonInteractive = Boolean(flags['non-interactive']);
  const platformFlag = typeof flags.platform === 'string' ? flags.platform : undefined;

  if (command === 'scan') {
    const res = await executeScanCommand({
      targetDir: positional[0] ?? '.',
      platform: platformFlag,
      format: (typeof flags.format === 'string'
        ? flags.format
        : 'terminal') as ScanCommandOptions['format'],
      failOn: (typeof flags['fail-on'] === 'string'
        ? flags['fail-on']
        : 'critical') as ScanCommandOptions['failOn'],
      noColor,
      nonInteractive,
      version: DRC_VERSION,
    });
    if (res.exitCode === 2) {
      io.stderr(res.output);
    } else {
      io.stdout(res.output);
    }
    return res.exitCode;
  }

  if (command === 'explain') {
    const res = executeExplainCommand({
      ruleId: positional[0] ?? '',
      platform: platformFlag,
      noColor,
    });
    if (res.exitCode === 2) {
      io.stderr(res.output);
    } else {
      io.stdout(res.output);
    }
    return res.exitCode;
  }

  if (command === 'fix') {
    const res = await executeFixCommand({
      targetDir: positional[0] ?? '.',
      platform: platformFlag,
      dryRun: Boolean(flags['dry-run']),
      yes: Boolean(flags.yes),
      previewBeforePrompt: io.stdout,
      noColor,
      nonInteractive,
    });
    if (res.exitCode === 2) {
      io.stderr(res.output);
    } else {
      io.stdout(res.output);
    }
    return res.exitCode;
  }

  if (command === 'verify') {
    const res = await executeVerifyCommand({
      targetDir: positional[0] ?? '.',
      platform: platformFlag,
      build: Boolean(flags.build),
      startup: Boolean(flags.startup),
      noExec: Boolean(flags['no-exec']),
      allowExec: Boolean(flags['allow-exec']),
      noColor,
      nonInteractive,
    });
    if (res.exitCode === 2) {
      io.stderr(res.output);
    } else {
      io.stdout(res.output);
    }
    return res.exitCode;
  }

  return 2;
}
