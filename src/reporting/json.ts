import { Finding, PlatformId } from '../core/finding';
import { ProjectManifest } from '../core/project-manifest';
import { redactSecrets } from '../utils/redactor';

export interface JsonScanReport {
  schemaVersion: '1.0.0';
  toolVersion: string;
  targetPath: string;
  platform: PlatformId;
  framework: string;
  isMonorepo: boolean;
  summary: {
    critical: number;
    warning: number;
    info: number;
    passed: number;
    totalFindings: number;
    autofixableCount: number;
  };
  findings: Finding[];
}

export function buildJsonScanReport(params: {
  version: string;
  targetPath: string;
  platform: PlatformId;
  manifest: ProjectManifest;
  findings: Finding[];
  passedChecksCount: number;
}): JsonScanReport {
  const sanitizedFindings: Finding[] = params.findings.map((f) => ({
    ...f,
    message: redactSecrets(f.message),
    evidence: redactSecrets(f.evidence),
    suggestedFix: redactSecrets(f.suggestedFix),
  }));

  const critical = sanitizedFindings.filter((f) => f.severity === 'critical').length;
  const warning = sanitizedFindings.filter((f) => f.severity === 'warning').length;
  const info = sanitizedFindings.filter((f) => f.severity === 'info').length;
  const autofixableCount = sanitizedFindings.filter((f) => f.fix.eligible).length;

  return {
    schemaVersion: '1.0.0',
    toolVersion: params.version,
    targetPath: params.targetPath,
    platform: params.platform,
    framework: params.manifest.primaryFramework,
    isMonorepo: params.manifest.isMonorepo,
    summary: {
      critical,
      warning,
      info,
      passed: params.passedChecksCount,
      totalFindings: sanitizedFindings.length,
      autofixableCount,
    },
    findings: sanitizedFindings,
  };
}

export function renderJsonScanReport(params: {
  version: string;
  targetPath: string;
  platform: PlatformId;
  manifest: ProjectManifest;
  findings: Finding[];
  passedChecksCount: number;
}): string {
  const report = buildJsonScanReport(params);
  return JSON.stringify(report, null, 2);
}
