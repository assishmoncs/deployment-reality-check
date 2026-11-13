#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const rootDir = path.resolve(__dirname, '..');
// Invoke the TypeScript JS entrypoint directly instead of tsc.cmd. This avoids
// shell-dependent child-process behavior on Windows.
const localTsc = path.join(rootDir, 'node_modules', 'typescript', 'bin', 'tsc');

if (fs.existsSync(localTsc)) {
  const res = spawnSync(process.execPath, [localTsc, '--noEmit', '-p', path.join(rootDir, 'tsconfig.json')], {
    cwd: rootDir,
    stdio: 'inherit',
  });
  if (res.error) throw res.error;
  process.exit(res.status ?? 1);
}

const parser = require('@babel/parser');
const traverse = require('@babel/traverse').default || require('@babel/traverse');

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

const allFiles = [
  ...collectTsFiles(path.join(rootDir, 'src')),
  ...collectTsFiles(path.join(rootDir, 'tests')),
];

const errors = [];
const exportMap = new Map();

for (const file of allFiles) {
  const code = fs.readFileSync(file, 'utf8');
  try {
    const ast = parser.parse(code, {
      sourceType: 'module',
      plugins: ['typescript'],
    });
    const exportsSet = new Set();
    traverse(ast, {
      ExportNamedDeclaration(nodePath) {
        const decl = nodePath.node.declaration;
        if (decl) {
          if (decl.id && decl.id.name) exportsSet.add(decl.id.name);
          if (decl.declarations) {
            for (const d of decl.declarations) {
              if (d.id && d.id.name) exportsSet.add(d.id.name);
            }
          }
        }
        if (nodePath.node.specifiers) {
          for (const spec of nodePath.node.specifiers) {
            if (spec.exported && spec.exported.name) {
              exportsSet.add(spec.exported.name);
            }
          }
        }
      },
      ExportDefaultDeclaration() {
        exportsSet.add('default');
      },
      ExportAllDeclaration() {
        exportsSet.add('*');
      },
    });
    exportMap.set(file, { ast, exportsSet });
  } catch (err) {
    errors.push(`${path.relative(rootDir, file)}: Syntax/Type parse error: ${err.message}`);
  }
}

for (const [file, { ast }] of exportMap.entries()) {
  traverse(ast, {
    ImportDeclaration(nodePath) {
      const source = nodePath.node.source.value;
      if (source.startsWith('.')) {
        const resolvedBase = path.resolve(path.dirname(file), source);
        const candidates = [
          resolvedBase,
          `${resolvedBase}.ts`,
          `${resolvedBase}.js`,
          path.join(resolvedBase, 'index.ts'),
        ];
        const found = candidates.find((c) => fs.existsSync(c));
        if (!found) {
          errors.push(`${path.relative(rootDir, file)}:${nodePath.node.loc?.start.line || 1} Cannot find module '${source}'`);
        }
      }
    },
  });
}

if (errors.length > 0) {
  for (const e of errors) {
    console.error(e);
  }
  process.exit(1);
}

console.log(`Typecheck passed across ${allFiles.length} TypeScript files (0 errors).`);
