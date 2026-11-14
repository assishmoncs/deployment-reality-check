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

  // Stage the replacement beside the destination, then rename it atomically.
  const parentDir = path.dirname(safeTargetPath);
  let stagingDir: string | undefined;
  try {
    fs.mkdirSync(parentDir, { recursive: true });
    assertSafeProjectPath(rootDir, patch.targetFile);
    stagingDir = fs.mkdtempSync(path.join(parentDir, '.drc-tmp-'));
    const tempPath = path.join(stagingDir, 'replacement');
    fs.writeFileSync(tempPath, patch.proposedContent, {
      encoding: 'utf8',
      flag: 'wx',
      mode: existsNow ? fs.statSync(safeTargetPath).mode & 0o777 : undefined,
    });
    assertSafeProjectPath(rootDir, patch.targetFile);
    const existsBeforeRename = fs.existsSync(safeTargetPath);
    const latestContent = existsBeforeRename ? fs.readFileSync(safeTargetPath, 'utf8') : '';
    if (existsBeforeRename !== existsNow || latestContent !== currentDiskContent) {
      return {
        patchId: patch.id,
        targetFile: patch.targetFile,
        status: 'conflict-aborted',
        reason: 'Target changed while staging the patch.',
      };
    }
    fs.renameSync(tempPath, safeTargetPath);
    return {
      patchId: patch.id,
      targetFile: patch.targetFile,
      status: 'applied',
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      patchId: patch.id,
      targetFile: patch.targetFile,
      status: 'validation-failed',
      reason: `Write failed: ${msg}`,
    };
  } finally {
    if (stagingDir) {
      try {
        fs.rmSync(stagingDir, { recursive: true, force: true });
      } catch {
        // Cleanup is best effort after an unsuccessful write.
      }
    }
  }
}
