#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const rootDir = path.resolve(__dirname, '..');
const localVitest = path.join(rootDir, 'node_modules', '.bin', process.platform === 'win32' ? 'vitest.cmd' : 'vitest');

if (fs.existsSync(localVitest)) {
  const isWindows = process.platform === 'win32';
  const res = spawnSync(
    isWindows ? process.env.ComSpec || 'cmd.exe' : localVitest,
    isWindows
      ? ['/d', '/s', '/c', '"', localVitest, 'run', '--coverage', '"']
      : ['run', '--coverage'],
    { cwd: rootDir, stdio: 'inherit', windowsVerbatimArguments: isWindows },
  );
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
