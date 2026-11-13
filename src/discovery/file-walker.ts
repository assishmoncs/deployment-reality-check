import * as fs from 'fs';
import * as path from 'path';
import { isPathInsideRoot, normalizePosixPath } from '../utils/fs-safe';

export interface WalkOptions {
  maxDepth?: number;
  maxFiles?: number;
  maxFileSizeBytes?: number;
  ignoreDirs?: Set<string>;
}

export interface WalkResult {
  files: string[];
  skipped: Array<{ file: string; reason: string }>;
}

const DEFAULT_IGNORE_DIRS = new Set([
  'node_modules',
  '.git',
  '.next',
  'dist',
  'build',
  'out',
  'coverage',
  '.nyc_output',
  '.turbo',
  '.vercel',
  '.cache',
  '.drc-backup',
  'vendor',
]);

export function walkProjectFiles(rootDir: string, options: WalkOptions = {}): WalkResult {
  const maxDepth = options.maxDepth ?? 10;
  const maxFiles = options.maxFiles ?? 5000;
  const maxFileSizeBytes = options.maxFileSizeBytes ?? 1024 * 1024;
  const ignoreDirs = options.ignoreDirs ?? DEFAULT_IGNORE_DIRS;

  const resolvedRoot = fs.existsSync(rootDir) ? fs.realpathSync(rootDir) : path.resolve(rootDir);
  const files: string[] = [];
  const skipped: Array<{ file: string; reason: string }> = [];
  const visitedRealDirs = new Set<string>([resolvedRoot]);

  function walk(currentDir: string, depth: number): void {
    if (depth > maxDepth) {
      skipped.push({
        file: normalizePosixPath(path.relative(resolvedRoot, currentDir)),
        reason: `max_depth_exceeded (${maxDepth})`,
      });
      return;
    }

    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(currentDir, { withFileTypes: true });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      skipped.push({
        file: normalizePosixPath(path.relative(resolvedRoot, currentDir)),
        reason: `readdir_error: ${msg}`,
      });
      return;
    }

    entries.sort((a, b) => a.name.localeCompare(b.name));

    for (const entry of entries) {
      if (files.length >= maxFiles) {
        skipped.push({
          file: normalizePosixPath(path.relative(resolvedRoot, path.join(currentDir, entry.name))),
          reason: `max_files_limit (${maxFiles})`,
        });
        return;
      }

      const fullPath = path.join(currentDir, entry.name);
      const relPosix = normalizePosixPath(path.relative(resolvedRoot, fullPath));

      let lstat: fs.Stats;
      try {
        lstat = fs.lstatSync(fullPath);
      } catch {
        skipped.push({ file: relPosix, reason: 'unreadable_stat' });
        continue;
      }

      if (lstat.isSymbolicLink()) {
        let realTarget: string;
        try {
          realTarget = fs.realpathSync(fullPath);
        } catch {
          skipped.push({ file: relPosix, reason: 'broken_symlink' });
          continue;
        }

        if (!isPathInsideRoot(resolvedRoot, realTarget)) {
          skipped.push({ file: relPosix, reason: 'symlink_escape_outside_root' });
          continue;
        }

        let targetStat: fs.Stats;
        try {
          targetStat = fs.statSync(realTarget);
        } catch {
          skipped.push({ file: relPosix, reason: 'unreadable_symlink_target' });
          continue;
        }

        if (targetStat.isDirectory()) {
          if (visitedRealDirs.has(realTarget)) {
            skipped.push({ file: relPosix, reason: 'recursive_symlink_loop' });
            continue;
          }
          visitedRealDirs.add(realTarget);
          walk(fullPath, depth + 1);
          continue;
        }

        if (targetStat.isFile()) {
          if (targetStat.size > maxFileSizeBytes) {
            skipped.push({ file: relPosix, reason: `oversized (${targetStat.size} bytes)` });
            continue;
          }
          files.push(relPosix);
        }
        continue;
      }

      if (lstat.isDirectory()) {
        if (ignoreDirs.has(entry.name)) {
          continue;
        }
        let realDir = fullPath;
        try {
          realDir = fs.realpathSync(fullPath);
        } catch {
          // continue with resolved path
        }
        if (visitedRealDirs.has(realDir)) {
          skipped.push({ file: relPosix, reason: 'recursive_directory_loop' });
          continue;
        }
        visitedRealDirs.add(realDir);
        walk(fullPath, depth + 1);
      } else if (lstat.isFile()) {
        if (lstat.size > maxFileSizeBytes) {
          skipped.push({ file: relPosix, reason: `oversized (${lstat.size} bytes)` });
          continue;
        }
        files.push(relPosix);
      }
    }
  }

  if (fs.existsSync(resolvedRoot)) {
    walk(resolvedRoot, 0);
  }

  return { files, skipped };
}
