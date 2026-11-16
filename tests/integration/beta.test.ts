import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { runCli } from '../../src/cli';
import { discoverProject } from '../../src/discovery';
import { parseSimpleToml } from '../../src/discovery/config-reader';

describe('Beta deployment checks', () => {
  let project: string;

  beforeEach(() => {
    project = fs.mkdtempSync(path.join(os.tmpdir(), 'drc-beta-'));
  });

  afterEach(() => {
    fs.rmSync(project, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  });

  function write(file: string, content: string) {
    const fullPath = path.join(project, file);
    fs.mkdirSync(path.dirname(fullPath), { recursive: true });
    fs.writeFileSync(fullPath, content);
  }

  async function run(...args: string[]) {
    const [command, ...flags] = args;
    const output: string[] = [];
    const code = await runCli([command!, project, '--non-interactive', '--no-color', ...flags], {
      stdout: (message) => output.push(message),
      stderr: (message) => output.push(message),
    });
    return { code, output: output.join('\n') };
  }

  it('parses TOML arrays and quoted hashes without modifying inherited object properties', () => {
    const parsed = parseSimpleToml(
      '[build]\nwatchPatterns = [\n"src/**",\n]\n[deploy]\nstartCommand = "node app.js # launch"\n' +
        '[__proto__]\ndrcBetaProbe = true',
    );
    expect(parsed.data).toMatchObject({
      build: { watchPatterns: ['src/**'] },
      deploy: { startCommand: 'node app.js # launch' },
    });
    expect(Object.hasOwn(Object.prototype, 'drcBetaProbe')).toBe(false);
  });

  it('reports invalid TOML syntax without echoing the source and checks both Railway config formats', async () => {
    write('railway.toml', 'a = unexpected_demo_value');
    let result = await run('scan', '--platform', 'railway');
    expect(result.code).toBe(1);
    expect(result.output).toContain('line 1');
    expect(result.output).not.toContain('unexpected_demo_value');

    write('railway.toml', '[deploy]\nstartCommand = false');
    write('railway.json', '{"build":{"buildCommand":""},"deploy":{"startCommand":null}}');
    result = await run('scan', '--platform', 'railway');
    expect(result.code).toBe(1);
    expect(result.output).toContain('railway.toml has an invalid value for deploy.startCommand');
    expect(result.output).toContain('railway.json has an invalid value for build.buildCommand');
    expect(result.output).not.toContain(
      'railway.json has an invalid value for deploy.startCommand',
    );

    write('railway.toml', '# use defaults');
    write('railway.json', '');
    expect((await run('verify', '--platform', 'railway')).code).toBe(1);
  });

  it('selects the target root package manager independently of nested lockfiles', () => {
    write('apps/frontend/bun.lock', 'nested lock');
    write('package.json', '{}');
    expect(discoverProject(project).primaryPackageManager).toBe('npm');
    write('pnpm-lock.yaml', 'root lock');
    expect(discoverProject(project).primaryPackageManager).toBe('pnpm');
    write('package.json', '{"packageManager":"yarn@4.0.0"}');
    const manifest = discoverProject(project);
    expect(manifest.primaryPackageManager).toBe('yarn');
    expect(manifest.packageManagers).toEqual(expect.arrayContaining(['yarn', 'pnpm', 'bun']));
  });

  it('requires an explicit platform for conflicting config or framework signals', async () => {
    write('package.json', '{"dependencies":{"next":"1.0.0"},"scripts":{"build":"next build"}}');
    write('vercel.json', '{}');
    write('railway.toml', '# railway');
    for (const command of ['scan', 'fix', 'verify']) {
      const result = await run(command);
      expect(result.code).toBe(2);
      expect(result.output).toContain('Use --platform vercel or --platform railway');
    }
    expect((await run('verify', '--platform=vercel')).code).toBe(0);
    fs.unlinkSync(path.join(project, 'vercel.json'));
    fs.unlinkSync(path.join(project, 'railway.toml'));
    write('apps/api/package.json', '{"dependencies":{"express":"1.0.0"}}');
    expect((await run('fix', '--dry-run')).code).toBe(2);
  });

  it('probes a custom local health endpoint and rejects external targets or missing startup flags', async () => {
    write('package.json', '{"scripts":{"start":"node server.js"}}');
    write(
      'server.js',
      `require('node:http').createServer((req, res) => {
        res.statusCode = req.url === '/health?ready=1' ? 204 : 404;
        res.end();
      }).listen(Number(process.env.PORT));`,
    );
    expect((await run('verify', '--platform=railway', '--health-path=/health')).code).toBe(2);
    for (const invalidPath of ['https://example.com', '//example.com', '/health#part']) {
      expect(
        (await run('verify', '--platform=railway', '--startup', '--health-path', invalidPath)).code,
      ).toBe(2);
    }
    const result = await run(
      'verify',
      '--platform=railway',
      '--startup',
      '--allow-exec',
      '--health-path=/health?ready=1',
    );
    expect(result.code).toBe(0);
    expect(result.output).toContain('Controlled startup health check succeeded');
  });

  it('accepts native Vercel Express listeners in entry files and still flags fixed ports on Railway', async () => {
    write(
      'package.json',
      '{"dependencies":{"express":"1.0.0"},"scripts":{"start":"node src/index.js"}}',
    );
    write(
      'src/index.js',
      "const express = require('express'); const app = express(); app.listen(3000);",
    );
    write(
      'src/server.mts',
      "import express from 'express'; const api = express(); api.listen(4000);",
    );
    write('tests/server.test.js', 'server.listen(9999);');
    expect((await run('scan', '--platform=vercel')).output).not.toContain('DRC005');
    const railway = await run('scan', '--platform=railway');
    expect(railway.code).toBe(1);
    expect(railway.output).toContain('hardcoded port 3000');
    expect(railway.output).not.toContain('9999');
    write('tools/other.js', 'anUnknownServer.listen(8080);');
    expect((await run('scan', '--platform=vercel')).output).toContain('tools/other.js');
  });
});
