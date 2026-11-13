#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const Module = require('module');
const { spawnSync } = require('child_process');

const rootDir = path.resolve(__dirname, '..');
// Run Vitest's JS entrypoint through the current Node executable. This avoids
// spawning vitest.cmd and works consistently on Windows, macOS, and Linux.
const localVitest = path.join(rootDir, 'node_modules', 'vitest', 'vitest.mjs');

if (fs.existsSync(localVitest)) {
  const res = spawnSync(process.execPath, [localVitest, 'run', ...process.argv.slice(2)], {
    cwd: rootDir,
    stdio: 'inherit',
  });
  if (res.error) throw res.error;
  process.exit(res.status ?? 1);
}

// Ensure dist/ is built before running tests
if (!process.argv.includes('--no-rebuild')) {
  const buildScript = path.join(__dirname, 'build.cjs');
  const buildRes = spawnSync(process.execPath, [buildScript], { cwd: rootDir, stdio: 'inherit' });
  if (buildRes.status !== 0) {
    process.exit(buildRes.status ?? 1);
  }
}

const babel = require('@babel/core');
const harness = require('./vitest-harness.cjs');

// Register .ts hook and map 'vitest' module to our vitest-compatible harness
const origResolveFilename = Module._resolveFilename;
Module._resolveFilename = function (request, parent, isMain, options) {
  if (request === 'vitest') {
    return path.join(__dirname, 'vitest-harness.cjs');
  }
  if (request.startsWith('.') && parent && parent.filename) {
    const baseDir = path.dirname(parent.filename);
    // Map imports from tests into src/ to dist/ so NYC tracks coverage cleanly on compiled dist/ files!
    const candidateSrc = path.resolve(baseDir, request);
    const srcRoot = path.join(rootDir, 'src');
    const distRoot = path.join(rootDir, 'dist');
    if (candidateSrc.startsWith(srcRoot)) {
      const relToSrc = path.relative(srcRoot, candidateSrc);
      const distCandidate = path.join(distRoot, relToSrc);
      for (const ext of ['', '.js', '/index.js']) {
        if (fs.existsSync(distCandidate + ext) && fs.statSync(distCandidate + ext).isFile()) {
          return distCandidate + ext;
        }
      }
    }
    for (const ext of ['', '.ts', '.js', '/index.ts', '/index.js']) {
      if (fs.existsSync(candidateSrc + ext) && fs.statSync(candidateSrc + ext).isFile()) {
        return candidateSrc + ext;
      }
    }
  }
  return origResolveFilename.call(this, request, parent, isMain, options);
};

require.extensions['.ts'] = function (mod, filename) {
  const code = fs.readFileSync(filename, 'utf8');
  const transformed = babel.transformSync(code, {
    filename,
    presets: [['@babel/preset-typescript', { allExtensions: true }]],
    plugins: ['@babel/plugin-transform-modules-commonjs'],
    retainLines: true,
  });
  mod._compile(transformed.code, filename);
};

function collectTestFiles(dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      collectTestFiles(full, out);
    } else if (entry.isFile() && entry.name.endsWith('.test.ts')) {
      out.push(full);
    }
  }
  return out.sort();
}

async function runAllTests() {
  const filterArg = process.argv[2];
  let testFiles = collectTestFiles(path.join(rootDir, 'tests'));
  if (filterArg && !filterArg.startsWith('-')) {
    testFiles = testFiles.filter((f) => f.includes(filterArg));
  }

  let totalPassed = 0;
  let totalFailed = 0;
  let totalSuites = 0;
  const failures = [];
  const startTime = Date.now();

  for (const file of testFiles) {
    harness.resetHarness();
    const relFile = path.relative(rootDir, file);
    require(file);
    const suites = harness.getRegisteredSuites().filter((s) => s.tests.length > 0);
    let filePassed = 0;
    let fileFailed = 0;

    for (const suite of suites) {
      totalSuites++;
      for (const t of suite.tests) {
        try {
          for (const bf of t.beforeEachFns) await bf();
          await t.fn();
          for (const af of t.afterEachFns) await af();
          totalPassed++;
          filePassed++;
        } catch (err) {
          totalFailed++;
          fileFailed++;
          failures.push({
            file: relFile,
            suite: suite.name,
            test: t.name,
            error: err,
          });
        }
      }
    }
    const badge = fileFailed === 0 ? '✓' : '✗';
    console.log(` ${badge} ${relFile} (${filePassed + fileFailed} tests${fileFailed > 0 ? `, ${fileFailed} failed` : ''})`);
  }

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(2);
  console.log('');
  console.log(`Test Files  ${testFiles.length} passed (${testFiles.length})`);
  console.log(`     Tests  ${totalPassed} passed | ${totalFailed} failed (${totalPassed + totalFailed})`);
  console.log(`  Duration  ${elapsed}s`);

  if (failures.length > 0) {
    console.error('\nFailures:');
    for (const f of failures) {
      console.error(`  ✗ [${f.file}] ${f.suite} > ${f.test}`);
      console.error(`    ${f.error && f.error.stack ? f.error.stack : f.error}`);
    }
    process.exit(1);
  }
}

runAllTests().catch((err) => {
  console.error(err);
  process.exit(1);
});
