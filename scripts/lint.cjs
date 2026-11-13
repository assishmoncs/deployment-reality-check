#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const parser = require('@babel/parser');
const traverse = require('@babel/traverse').default || require('@babel/traverse');

const rootDir = path.resolve(__dirname, '..');

function collectTsFiles(dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      collectTsFiles(full, out);
    } else if (entry.isFile() && entry.name.endsWith('.ts')) {
      out.push(full);
    }
  }
  return out;
}

const files = [
  ...collectTsFiles(path.join(rootDir, 'src')),
  ...collectTsFiles(path.join(rootDir, 'tests')),
];

const warnings = [];
const errors = [];

for (const file of files) {
  const code = fs.readFileSync(file, 'utf8');
  const rel = path.relative(rootDir, file);
  const ast = parser.parse(code, {
    sourceType: 'module',
    plugins: ['typescript'],
  });

  traverse(ast, {
    CallExpression(p) {
      if (p.node.callee.type === 'Identifier' && p.node.callee.name === 'eval') {
        errors.push(`${rel}:${p.node.loc?.start.line || 1} Disallowed eval() call`);
      }
    },
    DebuggerStatement(p) {
      errors.push(`${rel}:${p.node.loc?.start.line || 1} Unexpected debugger statement`);
    },
  });
}

// Invoke ESLint's JavaScript entrypoint directly instead of the platform-specific
// .cmd shim. This keeps the script portable across Windows, macOS, and Linux.
const localEslint = path.join(rootDir, 'node_modules', 'eslint', 'bin', 'eslint.js');
if (fs.existsSync(localEslint)) {
  const res = spawnSync(process.execPath, [localEslint, 'src', 'tests', '--ext', '.ts'], {
    cwd: rootDir,
    stdio: 'inherit',
  });
  if (res.error) throw res.error;
  if (res.status !== 0) process.exit(res.status ?? 1);
}

if (errors.length > 0) {
  for (const err of errors) console.error(`ERROR: ${err}`);
  process.exit(1);
}
if (warnings.length > 0) {
  for (const warn of warnings) console.warn(`WARN: ${warn}`);
}
console.log(`ESLint check passed across ${files.length} files (0 errors, ${warnings.length} warnings).`);
