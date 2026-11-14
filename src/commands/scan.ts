import * as fs from 'fs';
import * as path from 'path';
import { Finding, PlatformId, SEVERITY_ORDER, Severity } from '../core/finding';
import { RuleEngine } from '../core/rule-engine';
import { getAllRules } from '../core/rule-registry';
import { discoverProject, getProjectParseErrors } from '../discovery';
import { renderJsonScanReport } from '../reporting/json';
import { renderSarifScanReport } from '../reporting/sarif';
import { renderTerminalScanReport } from '../reporting/terminal';
import {
  isInteractiveTerminal,
  PromptAdapter,
  resolveTargetPlatform,
  TerminalPromptAdapter,
} from '../utils/prompts';

export interface ScanCommandOptions {
  targetDir: string;
  platform?: string;
  format?: 'terminal' | 'json' | 'sarif';
  failOn?: 'critical' | 'warning' | 'info' | 'none';
  noColor?: boolean;
  nonInteractive?: boolean;
  promptAdapter?: PromptAdapter;
  version?: string;
}

export interface ScanCommandResult {
  exitCode: number;
  output: string;
  findings: Finding[];
  platform?: PlatformId;
}

export function shouldFailOnFindings(
  findings: Finding[],
  failOn: 'critical' | 'warning' | 'info' | 'none',
): boolean {
  if (failOn === 'none') return false;
  const thresholdWeight = SEVERITY_ORDER[failOn as Severity];
  return findings.some((f) => SEVERITY_ORDER[f.severity] >= thresholdWeight);
}

export async function executeScanCommand(options: ScanCommandOptions): Promise<ScanCommandResult> {
  const version = options.version ?? '1.0.0';
  const format = options.format ?? 'terminal';
  const failOn = options.failOn ?? 'critical';

  if (!['terminal', 'json', 'sarif'].includes(format)) {
    return {
      exitCode: 2,
      output: `Error: Invalid output format '${format}'. Supported formats: terminal, json, sarif.`,
      findings: [],
    };
  }

  if (!['critical', 'warning', 'info', 'none'].includes(failOn)) {
    return {
      exitCode: 2,
      output: `Error: Invalid --fail-on level '${failOn}'. Supported levels: critical, warning, info, none.`,
      findings: [],
    };
  }

  const resolvedPath = path.resolve(options.targetDir || '.');
  if (!fs.existsSync(resolvedPath) || !fs.statSync(resolvedPath).isDirectory()) {
    return {
      exitCode: 2,
      output: `Error: Target directory '${options.targetDir}' does not exist or is not a directory.`,
      findings: [],
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
    const msg = err instanceof Error ? err.message : String(err);
    return {
      exitCode: 2,
      output: `Error: ${msg}`,
      findings: [],
    };
  }

  if (!platform) {
    if (isInteractiveTerminal(options.nonInteractive) && format === 'terminal') {
      const prompter = options.promptAdapter ?? new TerminalPromptAdapter();
      platform = await prompter.selectPlatform();
    } else {
      return {
        exitCode: 2,
        output:
          'Error: Could not automatically detect the deployment platform for this project.\nPlease specify a target platform explicitly using `--platform vercel` or `--platform railway`.',
        findings: [],
      };
    }
  }

  const parseErrors = getProjectParseErrors(manifest, platform);
  const allRules = getAllRules();
  const engine = new RuleEngine(allRules);
  const findings = engine.evaluateProject(manifest, platform);

  const triggeredRules = new Set(findings.map((f) => f.ruleId));
  const applicableRulesCount = allRules.filter((r) =>
    r.definition.platforms.includes(platform!),
  ).length;
  const passedChecksCount = Math.max(0, applicableRulesCount - triggeredRules.size);

  let output: string;
  if (format === 'json') {
    output = renderJsonScanReport({
      version,
      targetPath: options.targetDir || '.',
      platform,
      manifest,
      findings,
      passedChecksCount,
    });
  } else if (format === 'sarif') {
    output = renderSarifScanReport({
      version,
      platform,
      findings,
      parseErrors,
    });
  } else {
    output = renderTerminalScanReport(
      {
        version,
        targetPath: options.targetDir || '.',
        platform,
        manifest,
        findings,
        passedChecksCount,
      },
      { noColor: options.noColor },
    );
  }

  const exitCode =
    failOn !== 'none' && (parseErrors.length > 0 || shouldFailOnFindings(findings, failOn)) ? 1 : 0;
  return {
    exitCode,
    output,
    findings,
    platform,
  };
}
