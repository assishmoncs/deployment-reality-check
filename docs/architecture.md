# System Architecture

Deployment Reality Check (DRC) uses a deterministic, strictly layered pipeline where each subsystem communicates via typed data structures without side-effect leakage.

## Pipeline Overview

```text
User
  |
  v
DRC CLI (src/cli.ts -> src/commands/{scan,explain,fix,verify}.ts)
  |
  v
Project Discovery (src/discovery/{file-walker,dependency-reader,framework-detector,config-reader,source-analyzer}.ts)
  |
  v
Normalized Project Manifest (src/core/project-manifest.ts)
  |
  v
Rule Engine (src/core/rule-engine.ts) <---- Platform Capability Registry (src/platforms/{vercel,railway}.ts)
  |
  v
Findings and Evidence (src/core/finding.ts)
  |
  +----> Terminal Reporter (src/reporting/terminal.ts)
  +----> JSON Reporter     (src/reporting/json.ts)
  +----> SARIF Reporter    (src/reporting/sarif.ts)
  |
  v
Fix Planner & Patch Generator (src/remediation/{fix-plan,patch-generator}.ts)
  |
  v
Patch Preview and Approval (Unified Diff + Interactive / --dry-run / --yes)
  |
  v
Safe Patch Applier (src/remediation/patch-applier.ts)
  |
  v
Verification Engine (src/verification/{build-runner,startup-check,process-manager}.ts)
  |
  v
Updated Deployment Readiness Report
```

## Subsystem Separation Guarantees

1. **Discovery (`src/discovery/`)**: Performs bounded, read-only traversal and Babel AST extraction (`@babel/parser` + `@babel/traverse`) to produce a self-contained `ProjectManifest`.
2. **Rule Engine (`src/core/rule-engine.ts` & `src/rules/`)**: Pure functions of `(ProjectManifest, PlatformId, PlatformAdapter) -> Finding[]`. The rule engine never writes to disk or formats terminal strings.
3. **Platform Capability Registry (`src/platforms/`)**: Encapsulates execution model characteristics (`serverless-ephemeral` vs `container-service`), volume support, port/host binding requirements, and versioned provider limits (`Vercel Functions Limits`, `Railway Deployments Reference`).
4. **Reporting (`src/reporting/`)**: Pure serialization layer transforming `Finding[]` into accessible ANSI terminal output, structured JSON, or SARIF v2.1.0 logs after running `redactSecrets()`.
5. **Remediation (`src/remediation/`)**: Computes in-memory unified diffs, verifies SHA-256 hashes of original files to prevent concurrent modification overwrites, validates generated JSON/TS/JS syntax before writing, and performs atomic temp-file renames.
