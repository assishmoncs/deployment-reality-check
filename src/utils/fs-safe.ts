import * as fs from 'fs';
import * as path from 'path';

export function normalizePosixPath(inputPath: string): string {
  return inputPath.replace(/\\+/g, '/');
}

export function isPathInsideRoot(rootDir: string, candidatePath: string): boolean {
  const resolvedRoot = path.resolve(rootDir);
  const resolvedCandidate = path.resolve(candidatePath);
  if (resolvedRoot === resolvedCandidate) return true;
  const relative = path.relative(resolvedRoot, resolvedCandidate);
  return relative !== '' && !relative.startsWith('..') && !path.isAbsolute(relative);
}

export function assertSafeProjectPath(rootDir: string, targetPath: string): string {
  const resolvedRoot = fs.existsSync(rootDir) ? fs.realpathSync(rootDir) : path.resolve(rootDir);
  const resolvedTarget = path.resolve(resolvedRoot, targetPath);

  if (!isPathInsideRoot(resolvedRoot, resolvedTarget)) {
    throw new Error(
      `Security violation: Path '${targetPath}' resolves outside the project root '${resolvedRoot}'.`,
    );
  }

  if (fs.existsSync(resolvedTarget)) {
    const stat = fs.lstatSync(resolvedTarget);
    if (stat.isSymbolicLink()) {
      const realTarget = fs.realpathSync(resolvedTarget);
      if (!isPathInsideRoot(resolvedRoot, realTarget)) {
        throw new Error(
          `Security violation: Symbolic link '${targetPath}' points outside project root to '${realTarget}'.`,
        );
      }
    }
  } else {
    const parentDir = path.dirname(resolvedTarget);
    if (fs.existsSync(parentDir)) {
      const realParent = fs.realpathSync(parentDir);
      if (!isPathInsideRoot(resolvedRoot, realParent)) {
        throw new Error(
          `Security violation: Parent directory '${parentDir}' resolves outside project root.`,
        );
      }
    }
  }

  return resolvedTarget;
}

export function isLikelyBinaryBuffer(buf: Buffer): boolean {
  const sampleLength = Math.min(buf.length, 4096);
  for (let i = 0; i < sampleLength; i++) {
    if (buf[i] === 0) {
      return true;
    }
  }
  return false;
}

export function readTextFileSafe(
  rootDir: string,
  filePath: string,
  maxBytes = 1024 * 1024,
): { content: string | null; skippedReason?: string } {
  const safePath = assertSafeProjectPath(rootDir, filePath);
  if (!fs.existsSync(safePath)) {
    return { content: null, skippedReason: 'missing' };
  }
  const stat = fs.statSync(safePath);
  if (!stat.isFile()) {
    return { content: null, skippedReason: 'not_a_file' };
  }
  if (stat.size > maxBytes) {
    return { content: null, skippedReason: `oversized (${stat.size} bytes > ${maxBytes} bytes)` };
  }
  const buffer = fs.readFileSync(safePath);
  if (isLikelyBinaryBuffer(buffer)) {
    return { content: null, skippedReason: 'binary' };
  }
  return { content: buffer.toString('utf8') };
}
