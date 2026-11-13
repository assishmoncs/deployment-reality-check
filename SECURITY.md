# Security Policy

## Supported Versions

| Version | Supported          |
| ------- | ------------------ |
| 1.0.x   | :white_check_mark: |

## Security Model & Trust Boundaries

Deployment Reality Check (DRC) treats all scanned repositories as **untrusted input**:

1. **Read-Only Default Static Analysis**: `drc scan` and `drc explain` never execute project code, child processes, or npm scripts inside the scanned target directory.
2. **Path Traversal & Symlink Containment**: File walking (`src/discovery/file-walker.ts`) and patch application (`src/remediation/patch-applier.ts`) validate canonical real paths (`fs.realpathSync`) and reject any file or symbolic link that resolves outside the target project root.
3. **Bounded Resource Consumption**: File walking enforces a maximum recursion depth (default: 10), maximum file count (default: 5,000), and maximum per-file byte limit (default: 1 MB), skipping binary buffers automatically.
4. **Automatic Secret Redaction**: All terminal, JSON, SARIF, and subprocess outputs pass through `redactSecrets()` (`src/utils/redactor.ts`), masking API keys (`sk_live_*`, `ghp_*`, `AKIA*`), JWTs, private keys, and connection-string passwords. Generated `.env.example` templates only use safe placeholder values.
5. **Opt-In Process Execution Boundary**: `drc verify --build` and `drc verify --startup` execute third-party project scripts (`npm run build` / `npm run start`). Because spawning a child process is **not** a security sandbox, DRC refuses to execute build/start commands in non-interactive environments unless `--allow-exec` is explicitly passed, and always honors `--no-exec`.

## Reporting a Vulnerability

Please report security vulnerabilities privately via GitHub Security Advisories rather than opening a public issue. We aim to acknowledge reports within 48 hours.
