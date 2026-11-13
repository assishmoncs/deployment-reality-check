#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const rootDir = path.resolve(__dirname, '..');
const isCheck = process.argv.includes('--check');
const isWrite = process.argv.includes('--write');

const localPrettier = path.join(rootDir, 'node_modules', '.bin', process.platform === 'win32' ? 'prettier.cmd' : 'prettier');
if (fs.existsSync(localPrettier)) {
  const args = [isWrite ? '--write' : '--check', 'src/**/*.ts', 'tests/**/*.ts', 'README.md', 'docs/**/*.md'];
  const res = spawnSync(localPrettier, args, { cwd: rootDir, stdio: 'inherit' });
  process.exit(res.status ?? 0);
}

function collectFiles(dir, exts, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (['node_modules', 'dist', 'coverage', '.nyc_output', '.git'].includes(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      collectFiles(full, exts, out);
    } else if (entry.isFile() && exts.some((ext) => entry.name.endsWith(ext))) {
      out.push(full);
    }
  }
  return out;
}

const files = [
  ...collectFiles(path.join(rootDir, 'src'), ['.ts']),
  ...collectFiles(path.join(rootDir, 'tests'), ['.ts']),
  ...collectFiles(path.join(rootDir, 'docs'), ['.md']),
  path.join(rootDir, 'README.md'),
].filter((f) => fs.existsSync(f));

const violations = [];
for (const file of files) {
  const raw = fs.readFileSync(file, 'utf8');
  const normalized = raw.replace(/\r\n/g, '\n').replace(/[ \t]+$/gm, '');
  const ensuredNewline = normalized.endsWith('\n') ? normalized : `${normalized}\n`;
  if (raw !== ensuredNewline) {
    if (isWrite) {
      fs.writeFileSync(file, ensuredNewline, 'utf8');
    } else if (isCheck) {
      violations.push(path.relative(rootDir, file));
    }
  }
}

if (isCheck && violations.length > 0) {
  console.error('Formatting issues found in:', violations.join(', '));
  process.exit(1);
}
console.log(`Formatting verified across ${files.length} files.`);
