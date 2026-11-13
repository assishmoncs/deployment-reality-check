import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { describe, it, expect } from 'vitest';
import { executeFixCommand } from '../../src/commands/fix';
import { executeScanCommand } from '../../src/commands/scan';
import { executeVerifyCommand } from '../../src/commands/verify';

interface LabeledEvalFixture {
  name: string;
  platform: 'vercel' | 'railway';
  files: Record<string, string>;
  expectedRules: string[];
}

const LABELED_EVALUATION_DATASET: LabeledEvalFixture[] = [
  {
    name: 'clean-nextjs-vercel',
    platform: 'vercel',
    files: {
      'package.json': JSON.stringify({
        name: 'clean-next',
        dependencies: { next: '14.2.0', react: '18.3.0' },
        scripts: { build: 'next build', start: 'next start' },
      }),
      '.env.example': 'NEXT_PUBLIC_API_URL=https://api.example.com\nDATABASE_URL=postgresql://user:pass@host:5432/db\n',
      'src/app/page.tsx': `'use client'; export const url = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3000';`,
      'src/app/api/users/route.ts': `export async function GET() { return Response.json({ db: Boolean(process.env.DATABASE_URL) }); }`,
    },
    expectedRules: [],
  },
  {
    name: 'clean-express-railway',
    platform: 'railway',
    files: {
      'package.json': JSON.stringify({
        name: 'clean-express',
        dependencies: { express: '4.19.2', cors: '2.8.5' },
        scripts: { start: 'node src/index.js' },
      }),
      '.env.example': 'CORS_ORIGIN=https://app.example.com\nDATABASE_URL=postgresql://user:pass@host:5432/db\n',
      'src/index.js': `const express = require('express');
const cors = require('cors');
const app = express();
app.use(cors({ origin: process.env.CORS_ORIGIN || 'http://localhost:5173' }));
const db = process.env.DATABASE_URL;
app.listen(process.env.PORT || 3000, '0.0.0.0', () => console.log('http://localhost:3000'));
`,
    },
    expectedRules: [],
  },
  {
    name: 'clean-vite-vercel',
    platform: 'vercel',
    files: {
      'package.json': JSON.stringify({
        name: 'clean-vite',
        dependencies: { react: '18.3.0', vite: '5.2.0' },
        scripts: { build: 'vite build' },
      }),
      '.env.example': 'VITE_API_URL=https://api.example.com\n',
      'src/main.tsx': `export const endpoint = import.meta.env.VITE_API_URL;`,
      'tests/main.test.ts': `fetch('http://localhost:8080/mock'); const s = process.env.TEST_ONLY_SECRET;`,
    },
    expectedRules: [],
  },
  {
    name: 'broken-nextjs-sqlite-localhost',
    platform: 'vercel',
    files: {
      'package.json': JSON.stringify({
        name: 'broken-next',
        dependencies: { next: '14.2.0', 'better-sqlite3': '9.0.0' },
        scripts: { build: 'next build', start: 'next start' },
      }),
      'src/db.ts': `import Database from 'better-sqlite3'; const db = new Database('./prod.sqlite');`,
      'src/Client.tsx': `'use client'; fetch('http://127.0.0.1:4000/items');`,
    },
    expectedRules: ['DRC002', 'DRC003'],
  },
  {
    name: 'broken-express-railway-port-start',
    platform: 'railway',
    files: {
      'package.json': JSON.stringify({
        name: 'broken-express',
        dependencies: { express: '4.19.2' },
        scripts: { dev: 'nodemon index.js' },
      }),
      'index.js': `const express = require('express'); const app = express(); app.listen(5000, '127.0.0.1');`,
    },
    expectedRules: ['DRC004', 'DRC005'],
  },
  {
    name: 'broken-frontend-secrets-and-prefix',
    platform: 'vercel',
    files: {
      'package.json': JSON.stringify({
        name: 'broken-sec',
        dependencies: { next: '14.2.0' },
        scripts: { build: 'next build', start: 'next start' },
      }),
      '.env.example': 'STRIPE_SECRET_KEY=sk_test_123\nBACKEND_URL=https://api.example.com\n',
      'src/Pay.tsx': `'use client'; const s = process.env.STRIPE_SECRET_KEY; const u = process.env.BACKEND_URL;`,
    },
    expectedRules: ['DRC006', 'DRC007'],
  },
];

describe('End-to-End Integration Workflows & Evaluation Dataset Benchmark', () => {
  const examplesRoot = path.resolve(__dirname, '../../examples');

  it('detects expected issues in Example A (nextjs-broken targeting Vercel)', async () => {
    const res = await executeScanCommand({
      targetDir: path.join(examplesRoot, 'nextjs-broken'),
      platform: 'vercel',
      noColor: true,
      nonInteractive: true,
    });
    expect(res.exitCode).toBe(1);
    const ruleIds = res.findings.map((f) => f.ruleId);
    expect(ruleIds).toContain('DRC001');
    expect(ruleIds).toContain('DRC002');
    expect(ruleIds).toContain('DRC003');
  });

  it('detects expected issues in Example B (express-broken targeting Railway)', async () => {
    const res = await executeScanCommand({
      targetDir: path.join(examplesRoot, 'express-broken'),
      platform: 'railway',
      noColor: true,
      nonInteractive: true,
    });
    expect(res.exitCode).toBe(1);
    const ruleIds = res.findings.map((f) => f.ruleId);
    expect(ruleIds).toContain('DRC001');
    expect(ruleIds).toContain('DRC004');
    expect(ruleIds).toContain('DRC005');
    expect(ruleIds).toContain('DRC009');
  });

  it('detects expected issues in Example C (react-express-monorepo targeting Railway)', async () => {
    const res = await executeScanCommand({
      targetDir: path.join(examplesRoot, 'react-express-monorepo'),
      platform: 'railway',
      failOn: 'warning',
      noColor: true,
      nonInteractive: true,
    });
    expect(res.exitCode).toBe(1);
    const ruleIds = res.findings.map((f) => f.ruleId);
    expect(ruleIds).toContain('DRC001');
    expect(ruleIds).toContain('DRC007');
    expect(ruleIds).toContain('DRC008');
  });

  it('achieves <5% false-positive rate (0% false positives, 0% false negatives) on the labeled evaluation dataset', async () => {
    let falsePositives = 0;
    let falseNegatives = 0;
    let totalChecks = 0;

    for (const fixture of LABELED_EVALUATION_DATASET) {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), `drc-eval-${fixture.name}-`));
      try {
        for (const [rel, content] of Object.entries(fixture.files)) {
          const full = path.join(dir, rel);
          fs.mkdirSync(path.dirname(full), { recursive: true });
          fs.writeFileSync(full, content, 'utf8');
        }

        const scanRes = await executeScanCommand({
          targetDir: dir,
          platform: fixture.platform,
          noColor: true,
          nonInteractive: true,
        });

        const actualRules = new Set(scanRes.findings.map((f) => f.ruleId));
        const expectedSet = new Set(fixture.expectedRules);
        totalChecks += 12;

        for (const actual of actualRules) {
          if (!expectedSet.has(actual)) falsePositives++;
        }
        for (const expected of expectedSet) {
          if (!actualRules.has(expected)) falseNegatives++;
        }
      } finally {
        fs.rmSync(dir, { recursive: true, force: true });
      }
    }

    const fpRate = falsePositives / totalChecks;
    expect(falsePositives).toBe(0);
    expect(falseNegatives).toBe(0);
    expect(fpRate).toBeLessThan(0.05);
  });

  it('executes complete scan -> fix -> verify workflow on a temporary project copy', async () => {
    const tmpCopy = fs.mkdtempSync(path.join(os.tmpdir(), 'drc-e2e-fix-'));
    try {
      fs.writeFileSync(
        path.join(tmpCopy, 'package.json'),
        JSON.stringify({
          name: 'fixable-express-app',
          main: 'server.js',
          dependencies: { express: '^4.19.2', cors: '^2.8.5' },
        }),
      );
      fs.writeFileSync(
        path.join(tmpCopy, 'server.js'),
        `const express = require('express');
const cors = require('cors');
const app = express();
app.use(cors({ origin: 'http://localhost:5173' }));
const apiKey = process.env.SERVICE_API_KEY;
app.listen(4000, '127.0.0.1');
`,
      );

      const initialScan = await executeScanCommand({
        targetDir: tmpCopy,
        platform: 'railway',
        noColor: true,
        nonInteractive: true,
      });
      expect(initialScan.exitCode).toBe(1);
      expect(initialScan.findings.length).toBe(4);

      const dryRunRes = await executeFixCommand({
        targetDir: tmpCopy,
        platform: 'railway',
        dryRun: true,
        noColor: true,
        nonInteractive: true,
      });
      expect(dryRunRes.appliedResults).toHaveLength(0);
      expect(fs.existsSync(path.join(tmpCopy, '.env.example'))).toBe(false);

      const fixRes = await executeFixCommand({
        targetDir: tmpCopy,
        platform: 'railway',
        yes: true,
        noColor: true,
        nonInteractive: true,
      });
      expect(fixRes.exitCode).toBe(0);
      expect(fixRes.remainingFindingsCount).toBe(0);
      expect(fs.existsSync(path.join(tmpCopy, '.env.example'))).toBe(true);

      const verifyRes = await executeVerifyCommand({
        targetDir: tmpCopy,
        platform: 'railway',
        noExec: true,
        noColor: true,
        nonInteractive: true,
      });
      expect(verifyRes.exitCode).toBe(0);
      expect(verifyRes.ready).toBe(true);
    } finally {
      fs.rmSync(tmpCopy, { recursive: true, force: true });
    }
  });
});
