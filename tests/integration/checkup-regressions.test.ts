import * as fs from 'node:fs';
import * as http from 'node:http';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { runCli } from '../../src/cli';
import { applyPatchSafely } from '../../src/remediation/patch-applier';
import { computeContentSha256 } from '../../src/remediation/fix-plan';
import { readTextFileSafe } from '../../src/utils/fs-safe';
import { runControlledStartupCheck } from '../../src/verification/startup-check';

describe('Deployment checkup regressions', () => {
  let tempDir: string;
  let project: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'drc-checkup-'));
    project = path.join(tempDir, 'project');
    fs.mkdirSync(project);
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  });

  function write(file: string, content: string) {
    fs.writeFileSync(path.join(project, file), content);
  }

  async function invoke(command: string, ...args: string[]) {
    const output: string[] = [];
    const code = await runCli([command, project, '--platform', 'railway', '--no-color', ...args], {
      stdout: (message) => output.push(message),
      stderr: (message) => output.push(message),
    });
    return { code, output: output.join('\n') };
  }

  it('does not run project scripts when execution is false or a requested check is skipped', async () => {
    write('package.json', JSON.stringify({ scripts: { build: 'node build.js' } }));
    write('build.js', "require('node:fs').writeFileSync('marker', 'ran');");
    for (const flags of [['--allow-exec=false'], ['--allow-exec', 'false'], []]) {
      const result = await invoke('verify', '--build', '--non-interactive', ...flags);
      expect(result.code).toBe(1);
      expect(result.output).toContain('Build script execution skipped');
    }
    expect((await invoke('verify', '--build', '--allow-exec=maybe')).code).toBe(2);
    expect((await invoke('verify', '--unknown=true')).code).toBe(2);
    expect(fs.existsSync(path.join(project, 'marker'))).toBe(false);
  });

  it('reports redacted diagnostics from a failing build that logs to stdout', async () => {
    write('package.json', JSON.stringify({ scripts: { build: 'node build.js' } }));
    write('build.js', "console.log('Build error\\nAPI_TOKEN=example-value'); process.exit(1);");
    const result = await invoke('verify', '--build', '--allow-exec');
    expect(result.code).toBe(1);
    expect(result.output).toContain('Production build check failed');
    expect(result.output).toContain('Build error');
    expect(result.output).toContain('API_TOKEN=[REDACTED]');
    expect(result.output).not.toContain('example-value');
  });

  it('fails verification and reports syntax errors in all scan formats', async () => {
    write('broken.js', 'const broken = ;');
    const verification = await invoke('verify', '--no-exec');
    expect(verification.code).toBe(1);
    expect(verification.output).toContain('broken.js');
    expect(verification.output).not.toContain('Result: PASSED');
    for (const format of ['terminal', 'json', 'sarif']) {
      const result = await invoke('scan', '--format', format);
      expect(result.code).toBe(1);
      expect(result.output).toContain('broken.js');
      expect(result.output).not.toContain('Ready to deploy');
    }
    expect((await invoke('scan', '--fail-on=none')).code).toBe(0);
  });

  it('rejects a start script that exits before opening a port and a server that returns HTTP 500', async () => {
    write('package.json', JSON.stringify({ scripts: { start: 'node server.js' } }));
    const options = { rootDir: project, packageManager: 'npm' as const, allowExec: true };
    write('server.js', 'process.exit(0);');
    const earlyExit = await runControlledStartupCheck(options);
    expect(earlyExit.success).toBe(false);
    expect(earlyExit.failureReason).toContain('exited (0)');
    write(
      'server.js',
      "require('node:http').createServer((req, res) => { res.statusCode = 500; res.end(); }).listen(process.env.PORT);",
    );
    const unhealthy = await runControlledStartupCheck(options);
    expect(unhealthy.success).toBe(false);
    expect(unhealthy.httpStatus).toBe(500);
  });

  it('rejects an occupied probe port before starting a project', async () => {
    const server = http.createServer((_request, response) => response.end('another service'));
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    try {
      const address = server.address();
      if (!address || typeof address === 'string') throw new Error('Expected a TCP address.');
      const result = await runControlledStartupCheck({
        rootDir: project,
        packageManager: 'npm',
        allowExec: true,
        port: address.port,
      });
      expect(result.success).toBe(false);
      expect(result.failureReason).toContain('EADDRINUSE');
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it('rejects an escaping directory link for existing and new patch targets', () => {
    const external = path.join(tempDir, 'external');
    fs.mkdirSync(external);
    const existing = path.join(external, 'existing.js');
    fs.writeFileSync(existing, 'const outside = true;');
    fs.symlinkSync(external, path.join(project, 'link'), 'junction');

    expect(() => readTextFileSafe(project, 'link/existing.js')).toThrow('outside project root');
    for (const [targetFile, originalContent] of [
      ['link/existing.js', 'const outside = true;'],
      ['link/new-directory/new.js', ''],
    ] as const) {
      expect(() =>
        applyPatchSafely(project, {
          id: 'test',
          ruleId: 'DRC002',
          title: 'Test patch',
          targetFile,
          safety: 'approval-required',
          isNewFile: !originalContent,
          originalContent,
          originalSha256: computeContentSha256(originalContent),
          proposedContent: 'const changed = true;',
          unifiedDiff: '',
        }),
      ).toThrow('outside project root');
    }
    expect(fs.readFileSync(existing, 'utf8')).toBe('const outside = true;');
    expect(fs.readdirSync(external)).toEqual(['existing.js']);
  });

  it('redacts env values and keeps them intact when applying a fix', async () => {
    const original = 'export API_TOKEN="fake-value-first\nfake-value-second"\n';
    write('.env.example', original);
    write('app.js', 'console.log(process.env.REQUIRED_SERVICE);');
    const preview = await invoke('fix', '--dry-run');
    expect(preview.code).toBe(0);
    expect(preview.output).toContain('REQUIRED_SERVICE=');
    expect(preview.output).not.toContain('fake-value-');
    expect(fs.readFileSync(path.join(project, '.env.example'), 'utf8')).toBe(original);
    const applied = await invoke('fix', '--non-interactive');
    expect(applied.code).toBe(0);
    expect(applied.output).not.toContain('fake-value-');
    expect(fs.readFileSync(path.join(project, '.env.example'), 'utf8')).toBe(
      original + 'REQUIRED_SERVICE=replace_with_required_service\n',
    );
  });

  it('preserves custom build scripts and fixes only the selected deployment config', async () => {
    const vercelConfig = '{"builds":[],"functions":{}}';
    write('vercel.json', vercelConfig);
    write('railway.json', '{"deploy":{"startCommand":" "}}');
    write(
      'package.json',
      JSON.stringify({
        dependencies: { next: '14.0.0' },
        scripts: { build: 'node custom_setup.js', start: 'next dev --port 3000' },
      }),
    );
    const safeFix = await invoke('fix', '--non-interactive');
    expect(safeFix.code).toBe(0);
    const packageFile = path.join(project, 'package.json');
    expect(JSON.parse(fs.readFileSync(packageFile, 'utf8')).scripts.start).toBe(
      'next dev --port 3000',
    );
    const approvedFix = await invoke('fix', '--yes');
    expect(approvedFix.code).toBe(0);
    expect(JSON.parse(fs.readFileSync(packageFile, 'utf8')).scripts).toEqual({
      build: 'node custom_setup.js',
      start: 'next start --port 3000',
    });
    expect(fs.readFileSync(path.join(project, 'vercel.json'), 'utf8')).toBe(vercelConfig);
    expect(
      JSON.parse(fs.readFileSync(path.join(project, 'railway.json'), 'utf8')).deploy.startCommand,
    ).toBeUndefined();
    write('vercel.json', '{invalid');
    expect((await invoke('verify')).code).toBe(0);
  });

  it('generates a runnable Express start command for a JavaScript entry in src', async () => {
    fs.mkdirSync(path.join(project, 'src'));
    write(
      'src/server.js',
      "require('node:http').createServer((req, res) => res.end('ok')).listen(process.env.PORT);",
    );
    for (const scripts of [{ start: 'nodemon src/server.js' }, {}]) {
      write('package.json', JSON.stringify({ dependencies: { express: '4.19.2' }, scripts }));
      expect((await invoke('fix', '--yes')).code).toBe(0);
      const verification = await invoke('verify', '--startup', '--allow-exec');
      expect(verification.output).toContain('Controlled startup health check succeeded');
      expect(verification.code).toBe(0);
    }
  });

  it('fixes Vite environment reads on the same line without publishing server secrets', async () => {
    write(
      'package.json',
      JSON.stringify({
        dependencies: { react: '18.0.0', vite: '5.0.0' },
        scripts: { build: 'vite build' },
      }),
    );
    write(
      'App.jsx',
      'const values = [process.env.SERVICE_API_KEY, process.env.VITE_API_URL, process.env.API_URL];',
    );
    expect((await invoke('fix', '--yes')).code).toBe(0);
    expect(fs.readFileSync(path.join(project, 'App.jsx'), 'utf8')).toBe(
      'const values = [process.env.SERVICE_API_KEY, import.meta.env.VITE_API_URL, import.meta.env.VITE_API_URL];',
    );
  });
});
