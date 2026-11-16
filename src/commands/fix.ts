import * as fs from 'fs';
import * as path from 'path';
import { PlatformId } from '../core/finding';
import { RuleEngine } from '../core/rule-engine';
import { getAllRules } from '../core/rule-registry';
import { discoverProject } from '../discovery';
import { applyPatchSafely, PatchApplicationResult } from '../remediation/patch-applier';
import { generateFixPlan } from '../remediation/patch-generator';
import { redactSecrets } from '../utils/redactor';
import { TerminalStyler } from '../utils/logger';
import {
  isInteractiveTerminal,
  PLATFORM_SELECTION_REQUIRED,
  PromptAdapter,
  resolveTargetPlatform,
  TerminalPromptAdapter,
} from '../utils/prompts';

export interface FixCommandOptions {
  targetDir: string;
  platform?: string;
  dryRun?: boolean;
  yes?: boolean;
  noColor?: boolean;
  nonInteractive?: boolean;
  promptAdapter?: PromptAdapter;
  previewBeforePrompt?: (preview: string) => void;
}

export interface FixCommandResult {
  exitCode: number;
  output: string;
  appliedResults: PatchApplicationResult[];
  remainingFindingsCount: number;
}

export async function executeFixCommand(options: FixCommandOptions): Promise<FixCommandResult> {
  const s = new TerminalStyler({ noColor: options.noColor });
  const resolvedPath = path.resolve(options.targetDir || '.');

  if (!fs.existsSync(resolvedPath) || !fs.statSync(resolvedPath).isDirectory()) {
    return {
      exitCode: 2,
      output: `Error: Target directory '${options.targetDir}' does not exist or is not a directory.`,
      appliedResults: [],
      remainingFindingsCount: 0,
    };
  }

  const manifest = discoverProject(resolvedPath);
  let platform: PlatformId | null;
  try {
    platform = resolveTargetPlatform({
      explicitPlatform: options.platform,
      inferredPlatforms: manifest.inferredPlatforms,
      primaryFramework: manifest.primaryFramework,
      detectedFrameworks: manifest.detectedFrameworks,
    });
  } catch (err) {
    return {
      exitCode: 2,
      output: `Error: ${err instanceof Error ? err.message : String(err)}`,
      appliedResults: [],
      remainingFindingsCount: 0,
    };
  }

  if (!platform) {
    if (!isInteractiveTerminal(options.nonInteractive)) {
      return {
        exitCode: 2,
        output: PLATFORM_SELECTION_REQUIRED,
        appliedResults: [],
        remainingFindingsCount: 0,
      };
    }
    const prompter = options.promptAdapter ?? new TerminalPromptAdapter();
    platform = await prompter.selectPlatform();
  }

  const engine = new RuleEngine(getAllRules());
  const initialFindings = engine.evaluateProject(manifest, platform);
  const fixPlan = generateFixPlan(manifest, initialFindings);

  const lines: string[] = [];
  lines.push(s.bold('Deployment Reality Check — Remediation Engine'));
  lines.push(`Target: ${options.targetDir || '.'} (${platform})`);
  lines.push('');

  if (fixPlan.patches.length === 0 && fixPlan.manualSteps.length === 0) {
    lines.push(s.green('✓ No deployment issues requiring fixes were found.'));
    return {
      exitCode: 0,
      output: lines.join('\n'),
      appliedResults: [],
      remainingFindingsCount: 0,
    };
  }

  const appliedResults: PatchApplicationResult[] = [];
  const prompter = options.promptAdapter ?? new TerminalPromptAdapter();
  const interactive = isInteractiveTerminal(options.nonInteractive);

  for (const patch of fixPlan.patches) {
    const preview = [
      s.bold(`Proposed Fix [${patch.ruleId}] (${patch.safety}): ${redactSecrets(patch.title)}`),
      `File: ${patch.targetFile}`,
      s.dim('--- Diff Preview ---'),
      patch.unifiedDiff.trim(),
      s.dim('--------------------'),
    ].join('\n');
    if (interactive && !options.yes && !options.dryRun && options.previewBeforePrompt) {
      options.previewBeforePrompt(preview);
    } else {
      lines.push(preview);
    }

    if (options.dryRun) {
      lines.push(s.yellow('Dry-run mode: patch was NOT written to disk.'));
      lines.push('');
      continue;
    }

    let approved = false;
    if (options.yes) {
      approved = true;
    } else if (interactive) {
      approved = await prompter.confirmAction(
        `Apply fix [${patch.ruleId}] to ${patch.targetFile}?`,
        patch.safety === 'safe-auto',
      );
    } else if (patch.safety === 'safe-auto') {
      approved = true;
    }

    if (!approved) {
      lines.push(
        s.yellow(`Skipped patch for ${patch.targetFile} (user declined or approval required).`),
      );
      lines.push('');
      continue;
    }

    const res = applyPatchSafely(resolvedPath, patch);
    appliedResults.push(res);
    if (res.status === 'applied') {
      lines.push(s.green(`✓ Applied fix to ${patch.targetFile}`));
    } else if (res.status === 'skipped-already-applied') {
      lines.push(s.blue(`ℹ Skipped ${patch.targetFile}: ${res.reason ?? 'already applied'}`));
    } else {
      lines.push(s.red(`✗ Failed to apply patch to ${patch.targetFile}: ${res.reason ?? 'error'}`));
    }
    lines.push('');
  }

  if (fixPlan.manualSteps.length > 0) {
    lines.push(s.bold('Guided Manual Remediation (Not Auto-Applied for Safety):'));
    for (const step of fixPlan.manualSteps) {
      const loc = step.file ? ` (${step.file}${step.line ? `:${step.line}` : ''})` : '';
      lines.push(`  • [${step.ruleId}] ${step.title}${loc}`);
      lines.push(`    Action: ${step.instructions}`);
      if (step.docsUrl) {
        lines.push(`    Docs: ${step.docsUrl}`);
      }
    }
    lines.push('');
  }

  // Re-scan project after applying fixes
  const updatedManifest = discoverProject(resolvedPath);
  const remainingFindings = engine.evaluateProject(updatedManifest, platform);

  if (!options.dryRun) {
    lines.push(
      s.bold(
        `Post-Fix Re-scan: ${initialFindings.length} initial finding(s) -> ${remainingFindings.length} remaining finding(s).`,
      ),
    );
  }

  return {
    exitCode: appliedResults.some((result) =>
      ['conflict-aborted', 'validation-failed'].includes(result.status),
    )
      ? 1
      : 0,
    output: lines.join('\n'),
    appliedResults,
    remainingFindingsCount: remainingFindings.length,
  };
}
