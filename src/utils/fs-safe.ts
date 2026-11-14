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
  return (
    relative !== '' &&
    relative !== '..' &&
    !relative.startsWith(`..${path.sep}`) &&
    !path.isAbsolute(relative)
  );
}

export function assertSafeProjectPath(rootDir: string, targetPath: string): string {
  const resolvedRoot = fs.existsSync(rootDir) ? fs.realpathSync(rootDir) : path.resolve(rootDir);
  const resolvedTarget = path.resolve(resolvedRoot, targetPath);

  if (!isPathInsideRoot(resolvedRoot, resolvedTarget)) {
    throw new Error(
      `Security violation: Path '${targetPath}' resolves outside the project root '${resolvedRoot}'.`,
    );
  }

  let current = resolvedRoot;
  for (const segment of path.relative(resolvedRoot, resolvedTarget).split(path.sep)) {
    current = path.join(current, segment);
    let stat: fs.Stats;
    try {
      stat = fs.lstatSync(current);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') break;
      throw error;
    }
    if (stat.isSymbolicLink() && !isPathInsideRoot(resolvedRoot, fs.realpathSync(current))) {
      throw new Error(
        `Security violation: Symbolic link '${current}' resolves outside project root.`,
      );
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
