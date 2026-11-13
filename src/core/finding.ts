export type Severity = 'critical' | 'warning' | 'info';
export type Confidence = 'high' | 'medium' | 'low';
export type PlatformId = 'vercel' | 'railway';
export type FixSafetyLevel = 'safe-auto' | 'approval-required' | 'manual-guided';

export interface FindingFixMetadata {
  eligible: boolean;
  safety: FixSafetyLevel;
  description: string;
}

export interface Finding {
  ruleId: string;
  title: string;
  severity: Severity;
  confidence: Confidence;
  platform: PlatformId | 'all';
  category: 'environment' | 'networking' | 'persistence' | 'security' | 'runtime';
  message: string;
  whyItHappens: string;
  deploymentImpact: string;
  evidence: string;
  file?: string;
  line?: number;
  column?: number;
  suggestedFix: string;
  fix: FindingFixMetadata;
  docsUrl?: string;
}

export interface RuleDefinition {
  id: string;
  name: string;
  category: 'environment' | 'networking' | 'persistence' | 'security' | 'runtime';
  defaultSeverity: Severity;
  defaultConfidence: Confidence;
  platforms: PlatformId[];
  autofixEligible: boolean;
  fixSafety: FixSafetyLevel;
  summary: string;
  whatItMeans: string;
  whyItHappens: string;
  deploymentImpact: string;
  whenItApplies: string;
  howToResolve: string;
  PlatformNotes: Record<PlatformId, string>;
  docsUrls: Record<PlatformId, string>;
}

export const SEVERITY_ORDER: Record<Severity, number> = {
  critical: 3,
  warning: 2,
  info: 1,
};

export function sortFindingsDeterministically(findings: Finding[]): Finding[] {
  return [...findings].sort((a, b) => {
    const sevDiff = SEVERITY_ORDER[b.severity] - SEVERITY_ORDER[a.severity];
    if (sevDiff !== 0) return sevDiff;
    const ruleCmp = a.ruleId.localeCompare(b.ruleId);
    if (ruleCmp !== 0) return ruleCmp;
    const fileCmp = (a.file ?? '').localeCompare(b.file ?? '');
    if (fileCmp !== 0) return fileCmp;
    return (a.line ?? 0) - (b.line ?? 0);
  });
}
