#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const rootDir = path.resolve(__dirname, '..');
// Run Vitest's JS entrypoint directly instead of the platform-specific .cmd shim.
const localVitest = path.join(rootDir, 'node_modules', 'vitest', 'vitest.mjs');

if (fs.existsSync(localVitest)) {
  const res = spawnSync(process.execPath, [localVitest, 'run', '--coverage'], {
    cwd: rootDir,
    stdio: 'inherit',
  });
  if (res.error) throw res.error;
  process.exit(res.status ?? 1);
}

// Build once before invoking NYC so NYC instruments the built files cleanly
const buildScript = path.join(__dirname, 'build.cjs');
const buildRes = spawnSync(process.execPath, [buildScript], { cwd: rootDir, stdio: 'inherit' });
if (buildRes.status !== 0) {
  process.exit(buildRes.status ?? 1);
}

const nycBin = '/usr/bin/nyc';
const testScript = path.join(__dirname, 'test.cjs');

const res = spawnSync(
  nycBin,
  [
    '--source-map=false',
    '--reporter=text',
    '--reporter=json-summary',
    '--include=dist/**/*.js',
    '--exclude=dist/index.js',
    process.execPath,
    testScript,
    '--no-rebuild',
  ],
  {
    cwd: rootDir,
    stdio: 'inherit',
  },
);

process.exit(res.status ?? 1);
