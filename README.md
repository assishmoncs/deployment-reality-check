# Deployment Reality Check (DRC)

> **Catch deployment problems before production catches you.**

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](./LICENSE)
[![Node.js: >=18.0.0](https://img.shields.io/badge/node-%3E%3D18.0.0-brightgreen.svg)](https://nodejs.org)
[![TypeScript: Strict](https://img.shields.io/badge/TypeScript-Strict-3178C6.svg)](https://www.typescriptlang.org/)

## 1. Project Introduction

**Deployment Reality Check (`drc`)** is a deterministic, evidence-based deployment preflight CLI that detects production risks, explains platform-specific failures in beginner-friendly English, and safely applies fixes before you deploy. Think of it as **ESLint for deployment compatibility**.

DRC operates 100% locally offline—requiring no backend server, no hosted database, no AI API keys, no Docker daemon, and no user authentication.

## 2. Problem Being Solved

Thousands of developers, bootstrapped founders, and AI-assisted builders create applications that work on `localhost` but fail immediately when deployed to cloud platforms due to:

- Undocumented production environment variables (`process.env.*` missing in cloud dashboards).
- Hardcoded `http://localhost:3000` API URLs compiled into production browser bundles.
- Ephemeral/read-only filesystem failures when writing to local SQLite databases or upload folders (`./uploads`).
- Incorrect host (`127.0.0.1`) or hardcoded port binding on container platforms that inject dynamic `$PORT`.
- Missing production `build`/`start` scripts or dev-only watchers (`nodemon`) running in production.
- Private server secrets (`STRIPE_SECRET_KEY`, `DATABASE_URL`) leaked into client components or `NEXT_PUBLIC_`/`VITE_` variables.
- Unprefixed client environment variables stripped out by Next.js or Vite bundlers.
- CORS configurations locked to `http://localhost:5173` or combining `origin: '*'` with `credentials: true`.
- Destructive database resets (`prisma migrate reset`) in startup scripts or missing `prisma generate` steps.
- In-process background timers, `node-cron` jobs, BullMQ workers, or stateful WebSockets deployed to stateless serverless functions.
- Conflicting or malformed `vercel.json`, `railway.json`, or `railway.toml` files.

## 3. Main Features

- **Four Complete Commands**: `drc scan`, `drc explain`, `drc fix`, and `drc verify`.
- **AST-Powered Static Analysis**: Parses TypeScript, TSX, JavaScript, JSX, JSON, YAML, TOML, and Prisma schemas without executing untrusted project code.
- **Platform-Aware Evaluation**: Evaluates code against versioned capability specs for **Vercel** and **Railway**.
- **Multiple Output Formats**: Human-friendly terminal reports (with `--no-color` support), machine-readable JSON (`--format json`), and GitHub Code Scanning SARIF v2.1.0 (`--format sarif`).
- **Trust-First Remediation Engine**: Previews unified file diffs, supports `--dry-run`, checks SHA-256 hashes for concurrent modifications, validates AST syntax before writing, and re-scans automatically.
- **Built-In Secret Redaction**: Automatically redacts API keys, tokens, JWTs, and database passwords across all outputs and logs.

## 4. Supported Frameworks

- **Next.js** (Pages Router & App Router, Client vs. Server Components)
- **React with Vite**
- **Node.js with Express**
- **Frontend + Backend Monorepos** (multi-service workspace discovery)
- Recognizes **SQLite** (`better-sqlite3`, `sqlite3`, `sql.js`), **PostgreSQL** (`pg`, `postgres`), **Prisma**, **Drizzle**, and **Supabase** integrations.

## 5. Supported Hosting Platforms

- **Vercel** ([Vercel Functions Limits](https://vercel.com/docs/functions/limitations), [Project Configuration](https://vercel.com/docs/project-configuration))
- **Railway** ([Railway Deployments Reference](https://docs.railway.com/deployments/reference), [Variables Reference](https://docs.railway.com/variables/reference))

## 6. Installation

```bash
# Install globally from npm (once published) or from local packed tarball
npm install -g deployment-reality-check

# Or run directly in a repository
npx deployment-reality-check scan .
```

## 7. Quickstart

```bash
# 1. Scan your project for deployment risks
drc scan . --platform vercel

# 2. Learn why a specific finding happens and how to resolve it
drc explain DRC003 --platform vercel

# 3. Preview safe automated fixes without modifying files
drc fix . --platform vercel --dry-run

# 4. Apply approved fixes and verify readiness
drc fix . --platform vercel
drc verify . --platform vercel --no-exec
```

## 8. Command Examples

```bash
# Scan Commands
drc scan .
drc scan ./my-app --platform vercel
drc scan ./my-app --platform railway
drc scan . --format json
drc scan . --format sarif
drc scan . --fail-on warning

# Explain Commands
drc explain DRC001
drc explain DRC003 --platform vercel

# Fix Commands
drc fix
drc fix --dry-run
drc fix --platform railway

# Verify Commands
drc verify
drc verify --platform vercel
drc verify --build --allow-exec
drc verify --no-exec
```

## 9. Sample Terminal Output

```text
Deployment Reality Check v1.0.0

Scanning: ./examples/nextjs-broken
Framework: Next.js
Target: Vercel

✓ Project structure detected
✓ Production build/start script found

✗ DRC002 — Localhost API URL detected
  File: src/lib/api.ts:5

  Your production frontend references http://localhost:3000/api/orders. In production, this points to the visitor's own machine instead of your server.

  Suggested fix:
  Configure a production API URL using environment variables (e.g., process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3000/api/orders').

✗ DRC003 — Local database persistence risk
  File: src/database.ts:4

  Your application writes data to a local SQLite database, but this deployment environment does not provide persistent writable application storage.

  Suggested fix:
  Move persistent application data to a hosted database (e.g., PostgreSQL, Supabase, or Turso).

⚠ DRC001 — Missing required environment configuration
  File: src/database.ts:7

  Your project references 1 required environment variable(s) (INTERNAL_JWT_SECRET) without a .env.example template or code fallback.

  Suggested fix:
  Add placeholder entries for all required environment variables to .env.example and set their production values in your hosting platform dashboard.

──────────────────────────────────────
Deployment Readiness Summary

2 Critical
1 Warning
9 Passed

Run: drc fix
──────────────────────────────────────
```

## 10. Supported Rules

| Rule ID | Description | Severity | Autofix Tier |
| :--- | :--- | :--- | :--- |
| `DRC001` | Missing required environment configuration | Warning | `safe-auto` |
| `DRC002` | Hardcoded localhost URLs in production code | Critical / Warning | `approval-required` |
| `DRC003` | Non-persistent SQLite database or file storage | Critical / Warning | `manual-guided` |
| `DRC004` | Missing or invalid production build/start scripts | Critical / Warning | `safe-auto` / `approval-required` |
| `DRC005` | Incorrect host or port binding | Critical | `approval-required` |
| `DRC006` | Sensitive server environment variables exposed to frontend code | Critical | `manual-guided` |
| `DRC007` | Incorrect frontend API URL configuration | Warning | `approval-required` |
| `DRC008` | CORS origin mismatch | Warning / Critical | `approval-required` |
| `DRC009` | Non-persistent local file upload storage | Critical / Warning | `manual-guided` |
| `DRC010` | Database migration or initialization risks | Critical / Warning | `manual-guided` |
| `DRC011` | Platform-incompatible long-running processes | Critical / Warning | `manual-guided` |
| `DRC012` | Conflicting or invalid deployment configuration | Critical | `approval-required` / `manual-guided` |

See [`docs/rule-catalog.md`](./docs/rule-catalog.md) for full details.

## 11. Fix Safety Model

DRC categorizes every remediation into three explicit safety tiers:

1. **`safe-auto`**: Non-destructive additions (such as generating `.env.example` with safe placeholder values or adding missing `build`/`start` scripts to `package.json`).
2. **`approval-required`**: Targeted source code or configuration updates (wrapping hardcoded localhost URLs with environment fallbacks, updating `.listen()` port bindings, or adding `NEXT_PUBLIC_`/`VITE_` prefixes). Always displays a unified diff and requires interactive confirmation (or `--yes`).
3. **`manual-guided`**: Complex architectural or database changes (`DRC003` SQLite migration, `DRC006` secret extraction, `DRC009` S3 upload migration, `DRC010` schema migrations, `DRC011` background daemons). DRC provides step-by-step instructions and never mutates database state automatically.

## 12. Limitations

- **Static Analysis Scope**: DRC analyzes static AST patterns and configuration files. Dynamic runtime configuration loaded from external secret managers (e.g., AWS Secrets Manager, Vault) at runtime cannot be verified statically.
- **Supported Targets in v1.0.0**: Version 1.0.0 supports **Next.js**, **React (Vite)**, and **Node.js (Express)** targeting **Vercel** and **Railway**. Adapter interfaces are extensible for future targets (FastAPI, Flask, Render), which are not yet enabled in v1.0.0.
- **Subprocess Sandboxing**: Running `drc verify --build` or `--startup` with `--allow-exec` spawns project scripts using Node's `child_process.spawn` (`shell: false`), which is not a kernel-level security sandbox.

## 13. Local Development Instructions

```bash
cd deployment-reality-check
npm ci
npm run build
node ./bin/run.js scan ./examples/nextjs-broken --platform vercel
```

## 14. Running Tests

```bash
# Run unit, integration, and E2E tests
npm test

# Run test suite with coverage report
npm run test:coverage

# Run typechecking, linting, and formatting checks
npm run typecheck
npm run lint
npm run format:check
```

## 15. Contributing

Contributions are welcome! Please read [`CONTRIBUTING.md`](./CONTRIBUTING.md), [`CODE_OF_CONDUCT.md`](./CODE_OF_CONDUCT.md), and [`docs/contributing-rules.md`](./docs/contributing-rules.md).

## 16. Security Reporting

Please see [`SECURITY.md`](./SECURITY.md) for our security policy, trust boundaries, and instructions on privately reporting vulnerabilities.

## 17. License

Released under the [MIT License](./LICENSE).
