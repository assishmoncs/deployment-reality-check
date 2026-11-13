import * as crypto from 'crypto';
import { FixSafetyLevel } from '../core/finding';

export interface ProposedPatch {
  id: string;
  ruleId: string;
  title: string;
  targetFile: string;
  safety: FixSafetyLevel;
  isNewFile: boolean;
  originalContent: string;
  originalSha256: string;
  proposedContent: string;
  unifiedDiff: string;
}

export interface GuidedManualStep {
  ruleId: string;
  title: string;
  file?: string;
  line?: number;
  instructions: string;
  docsUrl?: string;
}

export interface FixPlan {
  patches: ProposedPatch[];
  manualSteps: GuidedManualStep[];
}

export function computeContentSha256(content: string): string {
  return crypto.createHash('sha256').update(content, 'utf8').digest('hex');
}
