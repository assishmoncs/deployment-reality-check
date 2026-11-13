import { PlatformId } from '../core/finding';
import { getAllRuleDefinitions, getRuleById } from '../core/rule-registry';
import { getPlatformAdapter } from '../platforms/railway';
import { TerminalStyler } from '../utils/logger';

export interface ExplainCommandOptions {
  ruleId: string;
  platform?: string;
  noColor?: boolean;
}

export interface ExplainCommandResult {
  exitCode: number;
  output: string;
}

export function executeExplainCommand(options: ExplainCommandOptions): ExplainCommandResult {
  const s = new TerminalStyler({ noColor: options.noColor });

  if (!options.ruleId) {
    const available = getAllRuleDefinitions()
      .map((r) => `  ${r.id} — ${r.name}`)
      .join('\n');
    return {
      exitCode: 2,
      output: `Error: Missing rule ID. Specify a rule ID such as 'drc explain DRC001'.\n\nAvailable rules:\n${available}`,
    };
  }

  let selectedPlatform: PlatformId | undefined;
  if (options.platform) {
    const norm = options.platform.trim().toLowerCase();
    if (norm !== 'vercel' && norm !== 'railway') {
      return {
        exitCode: 2,
        output: `Error: Unsupported platform '${options.platform}'. Supported platforms: vercel, railway.`,
      };
    }
    selectedPlatform = norm;
  }

  const rule = getRuleById(options.ruleId);
  if (!rule) {
    const available = getAllRuleDefinitions()
      .map((r) => `  ${r.id} — ${r.name}`)
      .join('\n');
    return {
      exitCode: 2,
      output: `Error: Unknown rule ID '${options.ruleId}'.\n\nAvailable rules:\n${available}`,
    };
  }

  const def = rule.definition;
  const lines: string[] = [];

  lines.push(s.bold(`${def.id} — ${def.name}`));
  lines.push(
    `Category: ${def.category} | Default Severity: ${def.defaultSeverity.toUpperCase()} | Confidence: ${def.defaultConfidence.toUpperCase()}`,
  );
  lines.push(`Supported Platforms: ${def.platforms.join(', ')}`);
  lines.push('');

  lines.push(s.bold('What this problem means:'));
  lines.push(`  ${def.whatItMeans}`);
  lines.push('');

  lines.push(s.bold('Why it happens:'));
  lines.push(`  ${def.whyItHappens}`);
  lines.push('');

  lines.push(s.bold('How it affects deployment:'));
  lines.push(`  ${def.deploymentImpact}`);
  lines.push('');

  lines.push(s.bold('When this warning applies:'));
  lines.push(`  ${def.whenItApplies}`);
  lines.push('');

  lines.push(s.bold('How to resolve it:'));
  lines.push(`  ${def.howToResolve}`);
  lines.push('');

  lines.push(s.bold('Automatic fix capability:'));
  if (def.autofixEligible) {
    lines.push(`  ${s.green('✓ Eligible for drc fix')} (Safety tier: ${def.fixSafety})`);
  } else {
    lines.push(
      `  ${s.yellow('• Guided manual remediation only')} (Safety tier: ${def.fixSafety} — DRC will not automatically mutate this code or database state)`,
    );
  }
  lines.push('');

  const platformsToShow: PlatformId[] = selectedPlatform
    ? [selectedPlatform]
    : ['vercel', 'railway'];
  lines.push(s.bold('Platform-specific notes & documentation:'));
  for (const p of platformsToShow) {
    const adapter = getPlatformAdapter(p);
    lines.push(`  • ${s.cyan(adapter.capabilities.displayName)}: ${def.PlatformNotes[p]}`);
    lines.push(
      `    Docs: ${def.docsUrls[p]} (Last reviewed: ${adapter.capabilities.lastReviewedDate})`,
    );
  }

  return {
    exitCode: 0,
    output: lines.join('\n'),
  };
}
