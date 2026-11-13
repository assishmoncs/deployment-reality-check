import * as fs from 'fs';
import * as path from 'path';
import { PlatformId } from '../core/finding';
import { RuleEngine } from '../core/rule-engine';
import { getAllRules } from '../core/rule-registry';
import { discoverProject } from '../discovery';
import { applyPatchSafely, PatchApplicationResult } from '../remediation/patch-applier';
import { generateFixPlan } from '../remediation/patch-generator';
import { TerminalStyler } from '../utils/logger';
import {
  isInteractiveTerminal,
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
    platform = 'vercel';
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
    lines.push(s.bold(`Proposed Fix [${patch.ruleId}] (${patch.safety}): ${patch.title}`));
    lines.push(`File: ${patch.targetFile}`);
    lines.push(s.dim('--- Diff Preview ---'));
    lines.push(patch.unifiedDiff.trim());
    lines.push(s.dim('--------------------'));

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
      lines.push(s.yellow(`Skipped patch for ${patch.targetFile} (user declined or approval required).`));
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
    exitCode: 0,
    output: lines.join('\n'),
    appliedResults,
    remainingFindingsCount: remainingFindings.length,
  };
}
