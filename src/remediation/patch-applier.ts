import * as fs from 'fs';
import * as path from 'path';
import { assertSafeProjectPath } from '../utils/fs-safe';
import { validateJsonSafe } from '../utils/schema';
import { computeContentSha256, ProposedPatch } from './fix-plan';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const babelParser = require('@babel/parser');

export interface PatchApplicationResult {
  patchId: string;
  targetFile: string;
  status: 'applied' | 'skipped-already-applied' | 'conflict-aborted' | 'validation-failed';
  reason?: string;
}

export function validateGeneratedFileContent(
  targetFile: string,
  content: string,
): {
  valid: boolean;
  error?: string;
} {
  if (targetFile.endsWith('.json')) {
    const res = validateJsonSafe(content, targetFile);
    if (!res.success) {
      return { valid: false, error: res.issues.map((i) => i.message).join('; ') };
    }
    return { valid: true };
  }

  if (/\.(ts|tsx|js|jsx|mjs|cjs)$/.test(targetFile)) {
    try {
      babelParser.parse(content, {
        sourceType: 'unambiguous',
        plugins: ['typescript', 'jsx', 'decorators-legacy', 'classProperties', 'topLevelAwait'],
      });
      return { valid: true };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return { valid: false, error: `Generated code syntax error: ${msg}` };
    }
  }

  return { valid: true };
}

export function applyPatchSafely(rootDir: string, patch: ProposedPatch): PatchApplicationResult {
  const safeTargetPath = assertSafeProjectPath(rootDir, patch.targetFile);

  // 1. Validate proposed content syntax before touching disk
  const validation = validateGeneratedFileContent(patch.targetFile, patch.proposedContent);
  if (!validation.valid) {
    return {
      patchId: patch.id,
      targetFile: patch.targetFile,
      status: 'validation-failed',
      reason: validation.error,
    };
  }

  // 2. Check current file on disk for idempotency or external concurrent modification conflict
  const existsNow = fs.existsSync(safeTargetPath);
  const currentDiskContent = existsNow ? fs.readFileSync(safeTargetPath, 'utf8') : '';

  if (existsNow && currentDiskContent === patch.proposedContent) {
    return {
      patchId: patch.id,
      targetFile: patch.targetFile,
      status: 'skipped-already-applied',
      reason: 'File already matches proposed content (idempotent).',
    };
  }

  const currentSha256 = computeContentSha256(currentDiskContent);
  if (currentSha256 !== patch.originalSha256) {
    return {
      patchId: patch.id,
      targetFile: patch.targetFile,
      status: 'conflict-aborted',
      reason: `File '${patch.targetFile}' was modified since the patch was generated (SHA-256 mismatch). Aborting to prevent overwriting changes.`,
    };
  }

  // 3. Atomic write with rollback protection
  const parentDir = path.dirname(safeTargetPath);
  fs.mkdirSync(parentDir, { recursive: true });
  const tempPath = path.join(
    parentDir,
    `.drc-tmp-${process.pid}-${Date.now()}-${path.basename(safeTargetPath)}`,
  );

  try {
    fs.writeFileSync(tempPath, patch.proposedContent, 'utf8');
    fs.renameSync(tempPath, safeTargetPath);
    return {
      patchId: patch.id,
      targetFile: patch.targetFile,
      status: 'applied',
    };
  } catch (err) {
    if (fs.existsSync(tempPath)) {
      try {
        fs.unlinkSync(tempPath);
      } catch {
        // ignore cleanup error
      }
    }
    // Restore original if needed
    if (
      existsNow &&
      (!fs.existsSync(safeTargetPath) ||
        fs.readFileSync(safeTargetPath, 'utf8') !== currentDiskContent)
    ) {
      fs.writeFileSync(safeTargetPath, currentDiskContent, 'utf8');
    }
    const msg = err instanceof Error ? err.message : String(err);
    return {
      patchId: patch.id,
      targetFile: patch.targetFile,
      status: 'validation-failed',
      reason: `Write failed and rolled back: ${msg}`,
    };
  }
}
