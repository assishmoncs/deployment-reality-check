import * as fs from 'fs';
import * as path from 'path';
import { PlatformId } from '../core/finding';
import { RuleEngine } from '../core/rule-engine';
import { getAllRules } from '../core/rule-registry';
import { discoverProject, getProjectParseErrors } from '../discovery';
import { redactSecrets } from '../utils/redactor';
import { TerminalStyler } from '../utils/logger';
import {
  isInteractiveTerminal,
  PromptAdapter,
  resolveTargetPlatform,
  TerminalPromptAdapter,
} from '../utils/prompts';
import { runProductionBuildCheck } from '../verification/build-runner';
import { runControlledStartupCheck } from '../verification/startup-check';

export interface VerifyCommandOptions {
  targetDir: string;
  platform?: string;
  build?: boolean;
  startup?: boolean;
  noExec?: boolean;
  allowExec?: boolean;
  noColor?: boolean;
  nonInteractive?: boolean;
  promptAdapter?: PromptAdapter;
}

export interface VerifyCommandResult {
  exitCode: number;
  output: string;
  ready: boolean;
}

export async function executeVerifyCommand(
  options: VerifyCommandOptions,
): Promise<VerifyCommandResult> {
  const s = new TerminalStyler({ noColor: options.noColor });
  const resolvedPath = path.resolve(options.targetDir || '.');

  if (!fs.existsSync(resolvedPath) || !fs.statSync(resolvedPath).isDirectory()) {
    return {
      exitCode: 2,
      output: `Error: Target directory '${options.targetDir}' does not exist or is not a directory.`,
      ready: false,
    };
  }

  const manifest = discoverProject(resolvedPath);
  let platform: PlatformId | null;
  try {
    platform = resolveTargetPlatform({
      explicitPlatform: options.platform,
      inferredPlatforms: manifest.inferredPlatforms,
      primaryFramework: manifest.primaryFramework,
    });
  } catch (err) {
    return {
      exitCode: 2,
      output: `Error: ${err instanceof Error ? err.message : String(err)}`,
      ready: false,
    };
  }

  if (!platform) {
    platform = 'vercel';
  }

  const engine = new RuleEngine(getAllRules());
  const findings = engine.evaluateProject(manifest, platform);
  const criticalCount = findings.filter((f) => f.severity === 'critical').length;
  const warningCount = findings.filter((f) => f.severity === 'warning').length;

  const lines: string[] = [];
  lines.push(s.bold('Deployment Reality Check — Verification Report'));
  lines.push(`Target: ${options.targetDir || '.'} (${platform})`);
  lines.push('');

  // 1. Static Analysis & Config Validation
  const parseErrors = getProjectParseErrors(manifest, platform);
  if (parseErrors.length === 0) {
    lines.push(`${s.green('✓')} Configuration and source syntax validation passed`);
  } else {
    lines.push(`${s.red('✗')} Configuration/source syntax errors found (${parseErrors.length})`);
    for (const { file, error } of parseErrors) {
      lines.push(`  ${file}: ${redactSecrets(error)}`);
    }
  }

  if (criticalCount === 0) {
    lines.push(
      `${s.green('✓')} Static analysis passed with 0 critical blockers (${warningCount} warning(s))`,
    );
  } else {
    lines.push(
      `${s.red('✗')} Static analysis found ${criticalCount} critical blocker(s) and ${warningCount} warning(s)`,
    );
  }

  let buildPassed = !options.build;
  let startupPassed = !options.startup;

  // 2. Optional build check (requires permission and not --no-exec)
  if (options.build && !options.noExec) {
    let permitted = Boolean(options.allowExec);
    if (!permitted && isInteractiveTerminal(options.nonInteractive)) {
      const prompter = options.promptAdapter ?? new TerminalPromptAdapter();
      permitted = await prompter.confirmAction(
        'WARNING: Executing project build scripts runs third-party code without a sandbox. Proceed with `npm run build`?',
        false,
      );
    }

    const buildReport = await runProductionBuildCheck({
      rootDir: resolvedPath,
      packageManager: manifest.primaryPackageManager,
      allowExec: permitted,
    });

    if (!buildReport.executed) {
      lines.push(`${s.yellow('⚠')} ${buildReport.skippedReason}`);
    } else if (buildReport.success) {
      buildPassed = true;
      lines.push(
        `${s.green('✓')} Production build check succeeded (${buildReport.result?.durationMs ?? 0}ms)`,
      );
    } else {
      lines.push(`${s.red('✗')} Production build check failed`);
      if (buildReport.result?.stderr) {
        lines.push(`  ${buildReport.result.stderr.trim()}`);
      }
    }
  } else if (options.noExec) {
    lines.push(
      `${s.blue('ℹ')} Dynamic process execution disabled via --no-exec (static verification only)`,
    );
  }

  // 3. Optional startup check
  if (options.startup && !options.noExec) {
    let permitted = Boolean(options.allowExec);
    if (!permitted && isInteractiveTerminal(options.nonInteractive)) {
      const prompter = options.promptAdapter ?? new TerminalPromptAdapter();
      permitted = await prompter.confirmAction(
        'WARNING: Executing project start scripts runs third-party code without a sandbox. Proceed with startup check?',
        false,
      );
    }

    const startupReport = await runControlledStartupCheck({
      rootDir: resolvedPath,
      packageManager: manifest.primaryPackageManager,
      allowExec: permitted,
    });

    if (!startupReport.executed) {
      lines.push(`${s.yellow('⚠')} ${startupReport.skippedReason}`);
    } else if (startupReport.success) {
      startupPassed = true;
      lines.push(`${s.green('✓')} Controlled startup health check succeeded`);
    } else {
      lines.push(`${s.red('✗')} Controlled startup health check failed`);
      if (startupReport.failureReason) lines.push(`  ${startupReport.failureReason}`);
    }
  }

  lines.push('');
  const ready = parseErrors.length === 0 && criticalCount === 0 && buildPassed && startupPassed;
  if (ready) {
    lines.push(s.bold(s.green('Verification Result: PASSED — All requested checks passed.')));
  } else {
    lines.push(
      s.bold(s.red('Verification Result: FAILED — Review the failed or skipped checks above.')),
    );
  }

  return {
    exitCode: ready ? 0 : 1,
    output: lines.join('\n'),
    ready,
  };
}
