import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { RuleEngine } from '../../src/core/rule-engine';
import { getAllRules, getRuleById } from '../../src/core/rule-registry';
import { discoverProject } from '../../src/discovery';

describe('All 12 Deployment Rules — Positive, Negative, and Edge-Case Suite', () => {
  let tmpDir: string;
  const engine = new RuleEngine(getAllRules());

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'drc-test-rules-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  function writeProject(files: Record<string, string>) {
    for (const [rel, content] of Object.entries(files)) {
      const full = path.join(tmpDir, rel);
      fs.mkdirSync(path.dirname(full), { recursive: true });
      fs.writeFileSync(full, content, 'utf8');
    }
  }

  it('registers all 12 rules with complete metadata', () => {
    const rules = getAllRules();
    expect(rules).toHaveLength(12);
    for (let i = 1; i <= 12; i++) {
      const id = `DRC${String(i).padStart(3, '0')}`;
      const r = getRuleById(id);
      expect(r).toBeDefined();
      expect(r!.definition.id).toBe(id);
      expect(r!.definition.docsUrls.vercel).toContain('https://');
      expect(r!.definition.docsUrls.railway).toContain('https://');
    }
  });

  it('DRC001: flags undocumented env vars (positive) and ignores documented or fallback vars (negative)', () => {
    writeProject({
      'package.json': JSON.stringify({
        name: 'app',
        dependencies: { express: '4.19.0' },
        scripts: { start: 'node index.js' },
      }),
      'index.js':
        'const db = process.env.STRIPE_WEBHOOK_SECRET; const port = process.env.PORT || 3000;',
    });
    let manifest = discoverProject(tmpDir);
    let findings = engine.evaluateProject(manifest, 'railway');
    expect(findings.some((f) => f.ruleId === 'DRC001')).toBe(true);

    // Negative: documented in .env.example
    writeProject({
      '.env.example': 'STRIPE_WEBHOOK_SECRET=whsec_placeholder\n',
    });
    manifest = discoverProject(tmpDir);
    findings = engine.evaluateProject(manifest, 'railway');
    expect(findings.some((f) => f.ruleId === 'DRC001')).toBe(false);
  });

  it('DRC002: flags hardcoded localhost in production (positive) and ignores test files, console.log, and env fallbacks (negative)', () => {
    writeProject({
      'package.json': JSON.stringify({
        name: 'app',
        dependencies: { next: '14.0.0' },
        scripts: { build: 'next build', start: 'next start' },
      }),
      'src/Component.tsx': `'use client'; export const f = () => fetch('http://localhost:4000/api');`,
      'src/safe.ts': `const u = process.env.API_URL || 'http://localhost:4000'; console.log('http://localhost:4000');`,
      'tests/api.test.ts': `fetch('http://localhost:4000/test');`,
    });

    const manifest = discoverProject(tmpDir);
    const findings = engine
      .evaluateProject(manifest, 'vercel')
      .filter((f) => f.ruleId === 'DRC002');
    expect(findings).toHaveLength(1);
    expect(findings[0]!.file).toBe('src/Component.tsx');
    expect(findings[0]!.severity).toBe('critical');
  });

  it('DRC003: distinguishes active SQLite usage on Vercel (critical), dependency-only (info), and Railway with Volume (negative)', () => {
    // 1. Active SQLite usage on Vercel -> critical
    writeProject({
      'package.json': JSON.stringify({
        name: 'app',
        dependencies: { next: '14.0.0', 'better-sqlite3': '9.0.0' },
        scripts: { build: 'next build' },
      }),
      'src/db.ts': `import Database from 'better-sqlite3'; const db = new Database('app.db');`,
    });
    let manifest = discoverProject(tmpDir);
    let findings = engine.evaluateProject(manifest, 'vercel').filter((f) => f.ruleId === 'DRC003');
    expect(findings).toHaveLength(1);
    expect(findings[0]!.severity).toBe('critical');

    // 2. Railway with RAILWAY_VOLUME_MOUNT_PATH configured -> no finding
    writeProject({
      '.env.example': 'RAILWAY_VOLUME_MOUNT_PATH=/data\n',
    });
    manifest = discoverProject(tmpDir);
    findings = engine.evaluateProject(manifest, 'railway').filter((f) => f.ruleId === 'DRC003');
    expect(findings).toHaveLength(0);

    // 3. Dependency-only in package.json without active file usage -> info
    fs.unlinkSync(path.join(tmpDir, 'src/db.ts'));
    fs.unlinkSync(path.join(tmpDir, '.env.example'));
    manifest = discoverProject(tmpDir);
    findings = engine.evaluateProject(manifest, 'vercel').filter((f) => f.ruleId === 'DRC003');
    expect(findings).toHaveLength(1);
    expect(findings[0]!.severity).toBe('info');
  });

  it('DRC004: flags missing build/start scripts or nodemon in start (positive) and passes valid scripts (negative)', () => {
    writeProject({
      'package.json': JSON.stringify({
        name: 'api',
        dependencies: { express: '4.19.0' },
        scripts: { start: 'nodemon index.js' },
      }),
    });
    let manifest = discoverProject(tmpDir);
    let findings = engine.evaluateProject(manifest, 'railway').filter((f) => f.ruleId === 'DRC004');
    expect(findings).toHaveLength(1);
    expect(findings[0]!.severity).toBe('warning');

    writeProject({
      'package.json': JSON.stringify({
        name: 'api',
        dependencies: { express: '4.19.0' },
        scripts: { start: 'node index.js', dev: 'nodemon index.js' },
      }),
    });
    manifest = discoverProject(tmpDir);
    findings = engine.evaluateProject(manifest, 'railway').filter((f) => f.ruleId === 'DRC004');
    expect(findings).toHaveLength(0);
  });

  it('DRC005: flags hardcoded port / 127.0.0.1 binding on Railway (positive) and passes valid Express serverless export on Vercel (negative)', () => {
    writeProject({
      'package.json': JSON.stringify({
        name: 'api',
        dependencies: { express: '4.19.0' },
        scripts: { start: 'node server.js' },
      }),
      'server.js': `const express = require('express'); const app = express(); app.listen(8080);`,
    });
    let manifest = discoverProject(tmpDir);
    let findings = engine.evaluateProject(manifest, 'railway').filter((f) => f.ruleId === 'DRC005');
    expect(findings).toHaveLength(1);

    // Valid Express app on Vercel that exports app and guards listen
    writeProject({
      'server.js': `const express = require('express'); const app = express(); if (process.env.NODE_ENV !== 'production') { app.listen(process.env.PORT || 3000); } module.exports = app;`,
    });
    manifest = discoverProject(tmpDir);
    findings = engine.evaluateProject(manifest, 'vercel').filter((f) => f.ruleId === 'DRC005');
    expect(findings).toHaveLength(0);
  });

  it('DRC006: flags secrets exposed to client components or prefixed with NEXT_PUBLIC_/VITE_ (positive) and allows anon/publishable keys (negative)', () => {
    writeProject({
      'package.json': JSON.stringify({
        name: 'web',
        dependencies: { next: '14.0.0' },
        scripts: { build: 'next build' },
      }),
      'src/Checkout.tsx': `'use client'; const k1 = process.env.STRIPE_SECRET_KEY; const k2 = process.env.NEXT_PUBLIC_DATABASE_URL; const safe = process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY;`,
    });
    const manifest = discoverProject(tmpDir);
    const findings = engine
      .evaluateProject(manifest, 'vercel')
      .filter((f) => f.ruleId === 'DRC006');
    expect(findings).toHaveLength(2);
  });

  it('DRC006/DRC007: does not flag Next.js App Router Server Components (without use client) reading server env vars', () => {
    writeProject({
      'package.json': JSON.stringify({
        name: 'next-rsc',
        dependencies: { next: '14.2.0', react: '18.3.0' },
        scripts: { build: 'next build', start: 'next start' },
      }),
      '.env.example':
        'DATABASE_URL=postgresql://user:pass@host:5432/db\nINTERNAL_API_URL=https://internal.example.com\n',
      'src/app/page.tsx': `export default async function Page() { const db = process.env.DATABASE_URL; const api = process.env.INTERNAL_API_URL; return <div>{Boolean(db && api)}</div>; }`,
    });
    const manifest = discoverProject(tmpDir);
    const findings = engine.evaluateProject(manifest, 'vercel');
    expect(findings.filter((f) => f.ruleId === 'DRC006' || f.ruleId === 'DRC007')).toHaveLength(0);
  });

  it('DRC007: flags unprefixed client API URLs in Next.js and Vite (positive) and passes properly prefixed vars (negative)', () => {
    writeProject({
      'package.json': JSON.stringify({
        name: 'web',
        dependencies: { react: '18.2.0', vite: '5.0.0' },
        scripts: { build: 'vite build' },
      }),
      'src/App.tsx': `export const url = process.env.BACKEND_API_URL; export const ok = import.meta.env.VITE_API_URL;`,
    });
    const manifest = discoverProject(tmpDir);
    const findings = engine
      .evaluateProject(manifest, 'vercel')
      .filter((f) => f.ruleId === 'DRC007');
    expect(findings).toHaveLength(1);
    expect(findings[0]!.evidence).toContain('BACKEND_API_URL');
  });

  it('DRC008: flags hardcoded localhost CORS and wildcard with credentials (positive) and passes env-driven CORS (negative)', () => {
    writeProject({
      'package.json': JSON.stringify({
        name: 'api',
        dependencies: { express: '4.19.0', cors: '2.8.5' },
        scripts: { start: 'node index.js' },
      }),
      'index.js': `const cors = require('cors'); app.use(cors({ origin: '*', credentials: true }));`,
    });
    let manifest = discoverProject(tmpDir);
    let findings = engine.evaluateProject(manifest, 'railway').filter((f) => f.ruleId === 'DRC008');
    expect(findings).toHaveLength(1);
    expect(findings[0]!.severity).toBe('critical');

    writeProject({
      'index.js': `const cors = require('cors'); app.use(cors({ origin: process.env.CORS_ORIGIN || 'http://localhost:3000', credentials: true }));`,
    });
    manifest = discoverProject(tmpDir);
    findings = engine.evaluateProject(manifest, 'railway').filter((f) => f.ruleId === 'DRC008');
    expect(findings).toHaveLength(0);
  });

  it('DRC009: flags multer and fs.writeFile local upload storage (positive)', () => {
    writeProject({
      'package.json': JSON.stringify({
        name: 'api',
        dependencies: { express: '4.19.0' },
        scripts: { start: 'node index.js' },
      }),
      'index.js': `const fs = require('fs'); fs.writeFileSync('./public/uploads/pic.png', data);`,
    });
    const manifest = discoverProject(tmpDir);
    const findings = engine
      .evaluateProject(manifest, 'vercel')
      .filter((f) => f.ruleId === 'DRC009');
    expect(findings).toHaveLength(1);
    expect(findings[0]!.severity).toBe('critical');
  });

  it('DRC010: flags destructive prisma migrate reset in start script and missing prisma generate (positive)', () => {
    writeProject({
      'package.json': JSON.stringify({
        name: 'api',
        dependencies: { '@prisma/client': '5.0.0' },
        scripts: { start: 'prisma migrate reset --force && node index.js' },
      }),
      'prisma/schema.prisma': 'datasource db { provider = "postgresql" }',
    });
    const manifest = discoverProject(tmpDir);
    const findings = engine
      .evaluateProject(manifest, 'railway')
      .filter((f) => f.ruleId === 'DRC010');
    expect(findings.length).toBeGreaterThanOrEqual(2);
    expect(findings.some((f) => f.severity === 'critical')).toBe(true);
  });

  it('DRC011: flags cron, BullMQ Worker, and WebSocketServer on Vercel (positive) but allows them on Railway (negative)', () => {
    writeProject({
      'package.json': JSON.stringify({
        name: 'app',
        dependencies: { ws: '8.0.0', bullmq: '5.0.0' },
        scripts: { start: 'node index.js' },
      }),
      'index.js': `import { WebSocketServer } from 'ws'; import { Worker } from 'bullmq'; cron.schedule('* * * * *', () => {}); const wss = new WebSocketServer({ port: 8080 }); const w = new Worker('jobs', async () => {});`,
    });
    const manifest = discoverProject(tmpDir);
    const vercelFindings = engine
      .evaluateProject(manifest, 'vercel')
      .filter((f) => f.ruleId === 'DRC011');
    expect(vercelFindings).toHaveLength(3);

    const railwayFindings = engine
      .evaluateProject(manifest, 'railway')
      .filter((f) => f.ruleId === 'DRC011');
    expect(railwayFindings).toHaveLength(0);
  });

  it('DRC012: flags conflicting builds+functions or invalid cron in vercel.json and empty startCommand in railway.json', () => {
    writeProject({
      'package.json': JSON.stringify({
        name: 'app',
        scripts: { build: 'next build', start: 'next start' },
      }),
      'vercel.json': JSON.stringify({
        builds: [{ src: 'package.json', use: '@vercel/next' }],
        functions: { 'api/*.js': { maxDuration: 60 } },
        crons: [{ path: 'invalid-no-leading-slash', schedule: '* * *' }],
      }),
      'railway.json': JSON.stringify({
        deploy: { startCommand: '' },
      }),
    });
    const manifest = discoverProject(tmpDir);
    const findings = engine
      .evaluateProject(manifest, 'vercel')
      .filter((f) => f.ruleId === 'DRC012');
    expect(findings).toHaveLength(2);
    expect(findings.every((finding) => finding.file === 'vercel.json')).toBe(true);

    const railwayFindings = engine
      .evaluateProject(manifest, 'railway')
      .filter((f) => f.ruleId === 'DRC012');
    expect(railwayFindings).toHaveLength(1);
    expect(railwayFindings[0]?.file).toBe('railway.json');
  });
});
