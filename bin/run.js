#!/usr/bin/env node
'use strict';

const path = require('path');
const { runCli } = require(path.join(__dirname, '..', 'dist', 'cli.js'));

runCli(process.argv.slice(2)).then((exitCode) => {
  process.exitCode = typeof exitCode === 'number' ? exitCode : 0;
}).catch((err) => {
  const message = err && err.message ? err.message : String(err);
  process.stderr.write(`Error: ${message}\n`);
  process.exitCode = 2;
});
