import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { describe, it, expect } from 'vitest';
import { runCli } from '../../src/cli';
import { runProductionBuildCheck } from '../../src/verification/build-runner';
import { runBoundedProcess } from '../../src/verification/process-manager';
import { runControlledStartupCheck } from '../../src/verification/startup-check';

describe('E2E CLI Dispatcher, Arguments, Exit Codes, and Bounded Subprocess Execution', () => {
  const examplesRoot = path.resolve(__dirname, '../../examples');

  async function invokeCli(
    args: string[],
  ): Promise<{ code: number; stdout: string; stderr: string }> {
    const out: string[] = [];
    const err: string[] = [];
    const code = await runCli(args, {
      stdout: (m) => out.push(m),
      stderr: (m) => err.push(m),
    });
    return { code, stdout: out.join('\n'), stderr: err.join('\n') };
  }

  it('displays help and version with exit code 0 across all commands', async () => {
    const helpRes = await invokeCli(['--help']);
    expect(helpRes.code).toBe(0);
    expect(helpRes.stdout).toContain('Deployment Reality Check (DRC)');

    for (const cmd of ['scan', 'explain', 'fix', 'verify']) {
      const cmdHelp = await invokeCli([cmd, '--help']);
      expect(cmdHelp.code).toBe(0);
      expect(cmdHelp.stdout).toContain(`Usage: drc ${cmd}`);
    }

    const helpSub = await invokeCli(['help', 'scan']);
    expect(helpSub.code).toBe(0);

    const verRes = await invokeCli(['--version']);
    expect(verRes.code).toBe(0);
    expect(verRes.stdout).toContain('deployment-reality-check/1.0.0');
  });

  it('explains rules in detail with and without platform filters', async () => {
    const exp1 = await invokeCli(['explain', 'DRC001', '--no-color']);
    expect(exp1.code).toBe(0);
    expect(exp1.stdout).toContain('DRC001 — Missing required environment configuration');
    expect(exp1.stdout).toContain('Eligible for drc fix');

    const exp3 = await invokeCli(['explain', 'DRC003', '--platform', 'vercel', '--no-color']);
    expect(exp3.code).toBe(0);
    expect(exp3.stdout).toContain('Guided manual remediation only');

    const expMissing = await invokeCli(['explain']);
    expect(expMissing.code).toBe(2);

    const expBadPlatform = await invokeCli(['explain', 'DRC001', '--platform', 'heroku']);
    expect(expBadPlatform.code).toBe(2);
  });

  it('returns exit code 2 for unknown commands, missing flag values, or invalid directories', async () => {
    expect((await invokeCli(['unknown-cmd'])).code).toBe(2);
    expect((await invokeCli(['scan', '--platform'])).code).toBe(2);
    expect((await invokeCli(['scan', '--unknown-flag'])).code).toBe(2);
    expect((await invokeCli(['scan', '-z'])).code).toBe(2);
    expect((await invokeCli(['scan', '.', '--format', 'xml'])).code).toBe(2);
    expect((await invokeCli(['scan', '.', '--fail-on', 'invalid'])).code).toBe(2);
    expect((await invokeCli(['scan', './non-existent-folder-xyz'])).code).toBe(2);
    expect((await invokeCli(['fix', './non-existent-folder-xyz'])).code).toBe(2);
    expect((await invokeCli(['verify', './non-existent-folder-xyz'])).code).toBe(2);
    expect((await invokeCli(['explain', 'DRC999'])).code).toBe(2);
  });

  it('supports JSON and SARIF output and dry-run fix via CLI flags', async () => {
    const jsonRes = await invokeCli([
      'scan',
      path.join(examplesRoot, 'nextjs-broken'),
      '--platform=vercel',
      '--format=json',
      '--fail-on=none',
    ]);
    expect(jsonRes.code).toBe(0);
    const parsedJson = JSON.parse(jsonRes.stdout);
    expect(parsedJson.platform).toBe('vercel');

    const sarifRes = await invokeCli([
      'scan',
      path.join(examplesRoot, 'nextjs-broken'),
      '-p',
      'vercel',
      '-f',
      'sarif',
      '--fail-on=none',
    ]);
    expect(sarifRes.code).toBe(0);
    const parsedSarif = JSON.parse(sarifRes.stdout);
    expect(parsedSarif.version).toBe('2.1.0');

    const fixDry = await invokeCli([
      'fix',
      path.join(examplesRoot, 'nextjs-broken'),
      '--platform',
      'vercel',
      '--dry-run',
      '--no-color',
    ]);
    expect(fixDry.code).toBe(0);
    expect(fixDry.stdout).toContain('Dry-run mode');
  });

  it('executes verify, build-runner, startup-check, and bounded process timeouts safely', async () => {
    const tmpProj = fs.mkdtempSync(path.join(os.tmpdir(), 'drc-verify-exec-'));
    try {
      fs.writeFileSync(
        path.join(tmpProj, 'package.json'),
        JSON.stringify({
          name: 'verify-exec-app',
          scripts: {
            build: 'node -e "console.log(123)"',
            start: 'node server.js',
          },
          dependencies: { express: '^4.19.2' },
        }),
      );
      fs.writeFileSync(
        path.join(tmpProj, 'server.js'),
        `const http = require('http');
const port = process.env.PORT || 3000;
const srv = http.createServer((req, res) => { res.writeHead(200); res.end('ok'); });
srv.listen(port, '127.0.0.1');
`,
      );

      // 1. Build check with allowExec: true
      const bRes = await runProductionBuildCheck({
        rootDir: tmpProj,
        packageManager: 'npm',
        allowExec: true,
        timeoutMs: 10000,
      });
      expect(bRes.executed).toBe(true);
      expect(bRes.success).toBe(true);

      // 2. Startup check with allowExec: true
      const sRes = await runControlledStartupCheck({
        rootDir: tmpProj,
        packageManager: 'npm',
        allowExec: true,
        port: 45921,
        timeoutMs: 5000,
      });
      expect(sRes.executed).toBe(true);
      expect(sRes.success).toBe(true);
      expect(sRes.httpStatus).toBe(200);

      // 3. CLI verify with --build and --allow-exec
      const cliVerify = await invokeCli([
        'verify',
        tmpProj,
        '--platform',
        'railway',
        '--build',
        '--allow-exec',
        '--no-color',
      ]);
      expect(cliVerify.stdout).toContain('Production build check succeeded');

      // 4. Process timeout enforcement
      const timeoutRes = await runBoundedProcess({
        cwd: tmpProj,
        command: process.execPath,
        args: ['-e', 'setTimeout(() => {}, 10000);'],
        timeoutMs: 300,
      });
      expect(timeoutRes.timedOut).toBe(true);
    } finally {
      fs.rmSync(tmpProj, { recursive: true, force: true });
    }
  });
});
