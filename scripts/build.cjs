#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const rootDir = path.resolve(__dirname, '..');
const srcDir = path.join(rootDir, 'src');
const distDir = path.join(rootDir, 'dist');

function cleanDir(dir) {
  if (fs.existsSync(dir)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
  fs.mkdirSync(dir, { recursive: true });
}

function collectFiles(dir, result = []) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      collectFiles(full, result);
    } else if (entry.isFile()) {
      result.push(full);
    }
  }
  return result;
}

function tryTsc() {
  // Invoke TypeScript's JS entrypoint directly to avoid platform-specific .cmd shims.
  const localTsc = path.join(rootDir, 'node_modules', 'typescript', 'bin', 'tsc');
  if (!fs.existsSync(localTsc)) return false;

  const res = spawnSync(process.execPath, [localTsc, '-p', path.join(rootDir, 'tsconfig.json')], {
    cwd: rootDir,
    stdio: 'inherit',
  });
  if (res.error) throw res.error;
  if (res.status !== 0) process.exit(res.status ?? 1);
  return true;
}

function compileWithBabel() {
  const babel = require('@babel/core');
  const files = collectFiles(srcDir);
  for (const file of files) {
    const rel = path.relative(srcDir, file);
    const outPath = path.join(distDir, rel.replace(/\.ts$/, '.js'));
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    if (file.endsWith('.ts')) {
      const code = fs.readFileSync(file, 'utf8');
      const transformed = babel.transformSync(code, {
        filename: file,
        presets: [
          ['@babel/preset-typescript', { allExtensions: true }],
        ],
        plugins: [
          '@babel/plugin-transform-modules-commonjs',
        ],
        sourceMaps: true,
        retainLines: true,
      });
      if (!transformed || typeof transformed.code !== 'string') {
        throw new Error(`Failed to compile ${rel}`);
      }
      const mapFile = `${path.basename(outPath)}.map`;
      const finalCode = `${transformed.code}\n//# sourceMappingURL=${mapFile}\n`;
      fs.writeFileSync(outPath, finalCode, 'utf8');
      if (transformed.map) {
        fs.writeFileSync(`${outPath}.map`, JSON.stringify(transformed.map), 'utf8');
      }
      // Also emit a basic .d.ts stub so TypeScript consumers have module resolution metadata
      const dtsPath = outPath.replace(/\.js$/, '.d.ts');
      fs.writeFileSync(dtsPath, `export {};\n`, 'utf8');
    } else {
      fs.copyFileSync(file, path.join(distDir, rel));
    }
  }
}

cleanDir(distDir);
if (!tryTsc()) {
  compileWithBabel();
}
console.log('Build completed successfully -> dist/');
