import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { discoverProject } from '../../src/discovery';
import { parseDotenvKeys, parseSimpleToml } from '../../src/discovery/config-reader';
import { walkProjectFiles } from '../../src/discovery/file-walker';
import { assertSafeProjectPath, isLikelyBinaryBuffer, normalizePosixPath, readTextFileSafe } from '../../src/utils/fs-safe';
import { resolveTargetPlatform } from '../../src/utils/prompts';
import { validateJsonSafe } from '../../src/utils/schema';

describe('Discovery Subsystem & Security Safeguards', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'drc-test-discovery-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('normalizes Windows backslash paths to POSIX slashes', () => {
    expect(normalizePosixPath('src\\components\\Header.tsx')).toBe('src/components/Header.tsx');
  });

  it('blocks directory traversal outside project root', () => {
    expect(() => assertSafeProjectPath(tmpDir, '../../etc/passwd')).toThrow('Security violation');
  });

  it('blocks symbolic links pointing outside the project root', () => {
    const outsideFile = path.join(os.tmpdir(), `drc-outside-${Date.now()}.txt`);
    fs.writeFileSync(outsideFile, 'secret');
    const symlinkPath = path.join(tmpDir, 'escape-link.txt');
    try {
      fs.symlinkSync(outsideFile, symlinkPath);
      expect(() => assertSafeProjectPath(tmpDir, 'escape-link.txt')).toThrow('Security violation');
      const walked = walkProjectFiles(tmpDir);
      expect(walked.files).not.toContain('escape-link.txt');
      expect(walked.skipped.some((s) => s.reason === 'symlink_escape_outside_root')).toBe(true);
    } finally {
      fs.rmSync(outsideFile, { force: true });
    }
  });

  it('detects recursive directory symlink loops safely without hanging', () => {
    const subDir = path.join(tmpDir, 'nested');
    fs.mkdirSync(subDir);
    const loopLink = path.join(subDir, 'loop');
    fs.symlinkSync(tmpDir, loopLink);

    const walked = walkProjectFiles(tmpDir);
    expect(walked.skipped.some((s) => s.reason === 'recursive_symlink_loop')).toBe(true);
  });

  it('skips oversized and binary files safely', () => {
    const bigFile = path.join(tmpDir, 'huge.ts');
    fs.writeFileSync(bigFile, 'x'.repeat(2048));
    const walked = walkProjectFiles(tmpDir, { maxFileSizeBytes: 512 });
    expect(walked.files).not.toContain('huge.ts');
    expect(walked.skipped.some((s) => s.file === 'huge.ts')).toBe(true);

    const binFile = path.join(tmpDir, 'binary.dat');
    const buf = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0x0d, 0x0a]);
    fs.writeFileSync(binFile, buf);
    expect(isLikelyBinaryBuffer(buf)).toBe(true);
    const readRes = readTextFileSafe(tmpDir, 'binary.dat');
    expect(readRes.content).toBeNull();
    expect(readRes.skippedReason).toBe('binary');
  });

  it('handles Unicode file paths and ignores node_modules/.git by default', () => {
    fs.mkdirSync(path.join(tmpDir, 'node_modules', 'pkg'), { recursive: true });
    fs.writeFileSync(path.join(tmpDir, 'node_modules', 'pkg', 'index.js'), 'console.log(1);');
    fs.mkdirSync(path.join(tmpDir, 'src'), { recursive: true });
    fs.writeFileSync(path.join(tmpDir, 'src', 'café-🚀.ts'), 'export const x = 1;');

    const walked = walkProjectFiles(tmpDir);
    expect(walked.files).toContain('src/café-🚀.ts');
    expect(walked.files.some((f) => f.includes('node_modules'))).toBe(false);
  });

  it('parses .env keys and simple TOML configurations with error handling', () => {
    const keys = parseDotenvKeys('# comment\nDATABASE_URL=postgres://localhost/db\nexport API_KEY = "123"\n');
    expect(keys).toEqual(['DATABASE_URL', 'API_KEY']);

    const validToml = parseSimpleToml('[build]\nbuilder = "NIXPACKS"\n[deploy]\nstartCommand = "npm start"\nreplicas = 2\nhealthcheck = true');
    expect(validToml.error).toBeUndefined();
    const deploy = validToml.data?.deploy as Record<string, unknown> | undefined;
    expect(deploy?.startCommand).toBe('npm start');
    expect(deploy?.replicas).toBe(2);
    expect(deploy?.healthcheck).toBe(true);

    const brokenToml = parseSimpleToml('[unclosed_section\nkey = "val"');
    expect(brokenToml.error).toBeDefined();

    const badAssignToml = parseSimpleToml('invalid_line_without_equals');
    expect(badAssignToml.error).toBeDefined();
  });

  it('detects package managers, frameworks, and monorepo services', () => {
    fs.writeFileSync(
      path.join(tmpDir, 'package.json'),
      JSON.stringify({
        name: 'root-app',
        dependencies: { next: '14.2.0', react: '18.2.0' },
        scripts: { build: 'next build', start: 'next start' },
      }),
    );
    fs.writeFileSync(path.join(tmpDir, 'pnpm-lock.yaml'), 'lockfileVersion: 6.0');
    fs.writeFileSync(path.join(tmpDir, 'vercel.json'), JSON.stringify({ version: 2 }));

    const manifest = discoverProject(tmpDir);
    expect(manifest.primaryFramework).toBe('nextjs');
    expect(manifest.primaryPackageManager).toBe('pnpm');
    expect(manifest.inferredPlatforms).toContain('vercel');
  });

  it('parses pnpm-workspace.yaml and resolves target platforms cleanly', () => {
    fs.writeFileSync(
      path.join(tmpDir, 'pnpm-workspace.yaml'),
      'packages:\n  - "apps/*"\n  - "packages/*"\n',
    );
    const manifest = discoverProject(tmpDir);
    expect(manifest.configFacts.pnpmWorkspacePackages).toEqual(['apps/*', 'packages/*']);

    expect(resolveTargetPlatform({ explicitPlatform: 'VERCEL', inferredPlatforms: [], primaryFramework: 'unknown' })).toBe('vercel');
    expect(resolveTargetPlatform({ inferredPlatforms: ['railway'], primaryFramework: 'unknown' })).toBe('railway');
    expect(resolveTargetPlatform({ inferredPlatforms: [], primaryFramework: 'nextjs' })).toBe('vercel');
    expect(resolveTargetPlatform({ inferredPlatforms: [], primaryFramework: 'express' })).toBe('railway');
    expect(resolveTargetPlatform({ inferredPlatforms: [], primaryFramework: 'unknown' })).toBeNull();
    expect(() => resolveTargetPlatform({ explicitPlatform: 'heroku', inferredPlatforms: [], primaryFramework: 'unknown' })).toThrow('Unsupported deployment platform');
  });

  it('validates JSON files and records parse errors without crashing on malformed source or JSON', () => {
    fs.writeFileSync(path.join(tmpDir, 'package.json'), '{ broken json ');
    fs.mkdirSync(path.join(tmpDir, 'src'));
    fs.writeFileSync(path.join(tmpDir, 'src', 'broken.ts'), 'export const x = ;;; {{{');

    const vRes = validateJsonSafe('[]', 'array.json');
    expect(vRes.success).toBe(false);

    const manifest = discoverProject(tmpDir);
    expect(manifest.parseErrors.length).toBeGreaterThanOrEqual(2);
  });
});
