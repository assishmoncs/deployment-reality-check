import { Finding, PlatformId } from '../core/finding';
import { FrameworkType, ProjectManifest } from '../core/project-manifest';
import { getProjectParseErrors } from '../discovery';
import { TerminalStyler } from '../utils/logger';
import { redactSecrets } from '../utils/redactor';

export interface ScanReportMetadata {
  version: string;
  targetPath: string;
  platform: PlatformId;
  manifest: ProjectManifest;
  findings: Finding[];
  passedChecksCount: number;
}

export function formatFrameworkDisplayName(
  fw: FrameworkType,
  isMonorepo: boolean,
  allFrameworks: FrameworkType[],
): string {
  if (isMonorepo && allFrameworks.length > 1) {
    const names = allFrameworks.map((f) => {
      if (f === 'nextjs') return 'Next.js';
      if (f === 'react-vite') return 'React (Vite)';
      if (f === 'express') return 'Node.js (Express)';
      return 'Unknown';
    });
    return `Monorepo (${names.join(' + ')})`;
  }
  switch (fw) {
    case 'nextjs':
      return 'Next.js';
    case 'react-vite':
      return 'React (Vite)';
    case 'express':
      return 'Node.js (Express)';
    default:
      return 'Unknown / Generic JavaScript';
  }
}

export function formatPlatformDisplayName(platform: PlatformId): string {
  return platform === 'vercel' ? 'Vercel' : 'Railway';
}

export function renderTerminalScanReport(
  meta: ScanReportMetadata,
  options: { noColor?: boolean } = {},
): string {
  const s = new TerminalStyler({ noColor: options.noColor });
  const lines: string[] = [];

  lines.push(s.bold(`Deployment Reality Check v${meta.version}`));
  lines.push('');
  lines.push(`Scanning: ${meta.targetPath}`);
  lines.push(
    `Framework: ${formatFrameworkDisplayName(
      meta.manifest.primaryFramework,
      meta.manifest.isMonorepo,
      meta.manifest.detectedFrameworks,
    )}`,
  );
  lines.push(`Target: ${formatPlatformDisplayName(meta.platform)}`);
  lines.push('');

  if (meta.manifest.services.length > 0) {
    lines.push(`${s.green('✓')} Project structure detected`);
  }
  const hasBuildOrStart = meta.manifest.services.some((svc) =>
    Boolean(svc.scripts.build || svc.scripts.start),
  );
  if (hasBuildOrStart && !meta.findings.some((f) => f.ruleId === 'DRC004')) {
    lines.push(`${s.green('✓')} Production build/start script found`);
  }
  lines.push('');

  const parseErrors = getProjectParseErrors(meta.manifest, meta.platform);
  if (parseErrors.length > 0) {
    lines.push(s.red('✗ Scan incomplete due to configuration/source syntax errors:'));
    for (const { file, error } of parseErrors) {
      lines.push(`  ${file}: ${redactSecrets(error)}`);
    }
    lines.push('');
  }

  if (meta.findings.length === 0 && parseErrors.length === 0) {
    lines.push(s.green('✓ No deployment blockers or warnings detected for this target!'));
    lines.push('');
  } else {
    for (const f of meta.findings) {
      const icon =
        f.severity === 'critical'
          ? s.red('✗')
          : f.severity === 'warning'
            ? s.yellow('⚠')
            : s.blue('ℹ');
      const headerText = `${f.ruleId} — ${f.title}`;
      const styledHeader =
        f.severity === 'critical'
          ? s.bold(s.red(headerText))
          : f.severity === 'warning'
            ? s.bold(s.yellow(headerText))
            : s.bold(s.blue(headerText));

      lines.push(`${icon} ${styledHeader}`);
      if (f.file) {
        const locSuffix = f.line ? `:${f.line}` : '';
        lines.push(`  File: ${f.file}${locSuffix}`);
      }
      lines.push('');
      for (const msgLine of redactSecrets(f.message).split('\n')) {
        lines.push(`  ${msgLine}`);
      }
      lines.push('');
      lines.push(`  ${s.bold('Suggested fix:')}`);
      lines.push(`  ${redactSecrets(f.suggestedFix)}`);
      lines.push('');
    }
  }

  const criticalCount = meta.findings.filter((f) => f.severity === 'critical').length;
  const warningCount = meta.findings.filter((f) => f.severity === 'warning').length;
  const infoCount = meta.findings.filter((f) => f.severity === 'info').length;
  const divider = '──────────────────────────────────────';

  lines.push(divider);
  lines.push(s.bold('Deployment Readiness Summary'));
  lines.push('');
  lines.push(`${criticalCount} Critical`);
  lines.push(`${warningCount} Warning`);
  if (infoCount > 0) {
    lines.push(`${infoCount} Informational`);
  }
  if (parseErrors.length === 0) lines.push(`${meta.passedChecksCount} Passed`);
  lines.push('');
  if (meta.findings.some((f) => f.fix.eligible)) {
    lines.push(`Run: ${s.cyan('drc fix')}`);
  } else if (meta.findings.length > 0) {
    lines.push(`Run: ${s.cyan(`drc explain ${meta.findings[0]!.ruleId}`)}`);
  } else if (parseErrors.length === 0) {
    lines.push(`Status: ${s.green('Ready to deploy')}`);
  }
  lines.push(divider);

  return lines.join('\n');
}
