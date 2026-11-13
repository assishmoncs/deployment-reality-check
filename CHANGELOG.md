# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.0.0] - 2026-11-13

### Added
- Initial stable release of **Deployment Reality Check (`drc`)**.
- Implemented `drc scan`, `drc explain`, `drc fix`, and `drc verify` commands.
- Added static discovery for **Next.js**, **React (Vite)**, **Node.js (Express)**, and frontend/backend monorepos.
- Added platform capability adapters for **Vercel** and **Railway** with official documentation references.
- Implemented 12 deterministic deployment rules (`DRC001` through `DRC012`).
- Added Terminal, JSON (`schemaVersion: 1.0.0`), and SARIF (`2.1.0`) reporters with secret redaction.
- Added safe remediation engine with unified diff previews, `--dry-run`, SHA-256 conflict detection, idempotency, and AST validation.
