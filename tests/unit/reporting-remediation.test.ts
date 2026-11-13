import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { RuleEngine } from '../../src/core/rule-engine';
import { getAllRules } from '../../src/core/rule-registry';
import { discoverProject } from '../../src/discovery';
import { getPlatformAdapter } from '../../src/platforms/railway';
import {
  applyPatchSafely,
  validateGeneratedFileContent,
} from '../../src/remediation/patch-applier';
import { generateFixPlan } from '../../src/remediation/patch-generator';
import { renderJsonScanReport } from '../../src/reporting/json';
import { renderSarifScanReport } from '../../src/reporting/sarif';
import { formatFrameworkDisplayName, renderTerminalScanReport } from '../../src/reporting/terminal';
import { TerminalStyler } from '../../src/utils/logger';
import { generateSafeEnvPlaceholder, redactSecrets } from '../../src/utils/redactor';

describe('Reporters, Secret Redaction, and Safe Patch Engine', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'drc-test-remediation-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('redacts API keys, database passwords, and JWTs and generates safe placeholders', () => {
    const raw = `DATABASE_URL=postgresql://admin:superSecretPass123@db.host.com:5432/prod
STRIPE_KEY=sk_live_51Nz999abcDEF1234567890
GITHUB=ghp_1234567890abcdefghijklmnopqrstuvwx
NODE_ENV=production`;
    const sanitized = redactSecrets(raw);
    expect(sanitized).not.toContain('superSecretPass123');
    expect(sanitized).not.toContain('sk_live_51Nz999abcDEF1234567890');
    expect(sanitized).not.toContain('ghp_1234567890abcdefghijklmnopqrstuvwx');
    expect(sanitized).toContain('NODE_ENV=production');
    expect(sanitized).toContain('[REDACTED');

    expect(generateSafeEnvPlaceholder('DATABASE_URL')).toContain('postgresql://');
    expect(generateSafeEnvPlaceholder('NEXT_PUBLIC_API_URL')).toContain('https://');
    expect(generateSafeEnvPlaceholder('PORT')).toBe('3000');
    expect(generateSafeEnvPlaceholder('NODE_ENV')).toBe('production');
    expect(generateSafeEnvPlaceholder('JWT_SECRET')).toContain('your_jwt_secret_here');
    expect(generateSafeEnvPlaceholder('APP_NAME')).toContain('replace_with_app_name');
  });

  it('supports TerminalStyler colors and framework formatting', () => {
    const prevForce = process.env.FORCE_COLOR;
    process.env.FORCE_COLOR = '1';
    try {
      const styler = new TerminalStyler({ noColor: false });
      expect(styler.bold('hi')).toContain('hi');
      expect(styler.dim('hi')).toContain('hi');
      expect(styler.red('hi')).toContain('hi');
      expect(styler.green('hi')).toContain('hi');
      expect(styler.yellow('hi')).toContain('hi');
      expect(styler.blue('hi')).toContain('hi');
      expect(styler.cyan('hi')).toContain('hi');
      expect(styler.gray('hi')).toContain('hi');
    } finally {
      if (prevForce === undefined) delete process.env.FORCE_COLOR;
      else process.env.FORCE_COLOR = prevForce;
    }

    expect(formatFrameworkDisplayName('nextjs', false, ['nextjs'])).toBe('Next.js');
    expect(formatFrameworkDisplayName('react-vite', false, ['react-vite'])).toBe('React (Vite)');
    expect(formatFrameworkDisplayName('express', false, ['express'])).toBe('Node.js (Express)');
    expect(formatFrameworkDisplayName('unknown', false, [])).toContain('Unknown');
    expect(formatFrameworkDisplayName('nextjs', true, ['react-vite', 'express'])).toContain(
      'Monorepo',
    );

    const vercelAdapter = getPlatformAdapter('vercel');
    const railwayAdapter = getPlatformAdapter('railway');
    expect(vercelAdapter.isRecommendedForFramework('nextjs')).toBe(true);
    expect(railwayAdapter.isRecommendedForFramework('express')).toBe(true);
  });

  it('serializes Terminal, JSON, and SARIF 2.1.0 reports accurately across all severities', () => {
    fs.writeFileSync(
      path.join(tmpDir, 'package.json'),
      JSON.stringify({ name: 'test-app', dependencies: { next: '14.0.0', sqlite3: '5.0.0' } }),
    );
    const manifest = discoverProject(tmpDir);
    const engine = new RuleEngine(getAllRules());
    const findings = engine.evaluateProject(manifest, 'vercel');

    const termOut = renderTerminalScanReport(
      {
        version: '1.0.0',
        targetPath: '.',
        platform: 'vercel',
        manifest,
        findings,
        passedChecksCount: 10,
      },
      { noColor: true },
    );
    expect(termOut).toContain('Deployment Reality Check v1.0.0');
    expect(termOut).toContain('DRC004');
    expect(termOut).toContain('Informational');

    const cleanTerm = renderTerminalScanReport(
      {
        version: '1.0.0',
        targetPath: '.',
        platform: 'vercel',
        manifest,
        findings: [],
        passedChecksCount: 12,
      },
      { noColor: true },
    );
    expect(cleanTerm).toContain('Ready to deploy');

    const jsonOut = JSON.parse(
      renderJsonScanReport({
        version: '1.0.0',
        targetPath: '.',
        platform: 'vercel',
        manifest,
        findings,
        passedChecksCount: 10,
      }),
    );
    expect(jsonOut.schemaVersion).toBe('1.0.0');
    expect(jsonOut.summary.critical).toBe(1);

    const sarifOut = JSON.parse(
      renderSarifScanReport({
        version: '1.0.0',
        platform: 'vercel',
        findings,
      }),
    );
    expect(sarifOut.version).toBe('2.1.0');
    expect(sarifOut.runs[0].results.length).toBeGreaterThanOrEqual(2);
  });

  it('generates unified diffs for DRC001, DRC002, DRC004, DRC005, DRC007, DRC008, DRC012 and validates before write', () => {
    fs.writeFileSync(
      path.join(tmpDir, 'package.json'),
      JSON.stringify(
        {
          name: 'full-fix-test',
          dependencies: { next: '14.0.0', express: '4.19.0', cors: '2.8.5' },
          scripts: { start: 'nodemon src/server.ts' },
          devDependencies: { typescript: '5.0.0' },
        },
        null,
        2,
      ),
    );
    fs.mkdirSync(path.join(tmpDir, 'src'), { recursive: true });
    fs.writeFileSync(
      path.join(tmpDir, 'src/Client.tsx'),
      `'use client';
export const apiUrl = process.env.API_URL;
export const data = fetch('http://localhost:4000/items');
`,
    );
    fs.writeFileSync(
      path.join(tmpDir, 'src/server.ts'),
      `import express from 'express';
import cors from 'cors';
const app = express();
app.use(cors({ origin: '*', credentials: true }));
const key = process.env.PRIVATE_SIGNING_KEY;
app.listen(4000, '127.0.0.1');
`,
    );
    fs.writeFileSync(
      path.join(tmpDir, 'vercel.json'),
      JSON.stringify({ builds: [], functions: {} }, null, 2),
    );
    fs.writeFileSync(
      path.join(tmpDir, 'railway.json'),
      JSON.stringify({ deploy: { startCommand: '' } }, null, 2),
    );

    const manifest = discoverProject(tmpDir);
    const engine = new RuleEngine(getAllRules());
    const findings = engine.evaluateProject(manifest, 'railway');
    const plan = generateFixPlan(manifest, findings);

    expect(plan.patches.length).toBeGreaterThanOrEqual(5);

    // Validate syntax validator on broken JSON and broken TS
    expect(validateGeneratedFileContent('bad.json', '{ invalid ').valid).toBe(false);
    expect(validateGeneratedFileContent('bad.ts', 'const x = ;;;').valid).toBe(false);
    expect(validateGeneratedFileContent('good.ts', 'export const x = 1;').valid).toBe(true);

    // Test conflict detection when file is modified externally after patch generation
    const pkgPatch = plan.patches.find((p) => p.targetFile === 'package.json')!;
    fs.writeFileSync(path.join(tmpDir, 'package.json'), '{"name": "modified-concurrently"}');
    const conflictRes = applyPatchSafely(tmpDir, pkgPatch);
    expect(conflictRes.status).toBe('conflict-aborted');

    // Restore original and apply cleanly
    fs.writeFileSync(path.join(tmpDir, 'package.json'), pkgPatch.originalContent);
    const appliedRes = applyPatchSafely(tmpDir, pkgPatch);
    expect(appliedRes.status).toBe('applied');

    // Second application is idempotent
    const secondRes = applyPatchSafely(tmpDir, pkgPatch);
    expect(secondRes.status).toBe('skipped-already-applied');
  });
});
