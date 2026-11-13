# CLI Command Reference

## Global Options

| Flag | Description |
| :--- | :--- |
| `-v, --version` | Print the DRC version, platform, and Node.js runtime version |
| `-h, --help` | Print general or command-specific usage documentation |
| `--no-color` | Disable ANSI colors (also respects `NO_COLOR` and `TERM=dumb`) |

## Exit Codes

| Exit Code | Meaning |
| :--- | :--- |
| `0` | Scan or verification completed without findings meeting the failure threshold |
| `1` | One or more findings met or exceeded the selected `--fail-on` severity threshold (or verification failed) |
| `2` | Usage error, invalid CLI option, invalid target directory, or unsupported platform |

## `drc scan [path]`

Scans a project directory (defaults to `.`) in read-only mode.

```bash
drc scan .
drc scan ./my-app --platform vercel
drc scan ./my-app --platform railway
drc scan . --format json
drc scan . --format sarif
drc scan . --fail-on warning
```

### Options
- `-p, --platform <vercel|railway>`: Explicitly set target deployment platform.
- `-f, --format <terminal|json|sarif>`: Output format (default: `terminal`).
- `--fail-on <critical|warning|info|none>`: Minimum severity that causes exit code `1` (default: `critical`).
- `--non-interactive`: Fail with exit code `2` instead of prompting when platform cannot be inferred.

## `drc explain <ruleId>`

Prints a comprehensive explanation of a rule (`DRC001`–`DRC012`), including why it happens, how it impacts deployment, remediation examples, and official platform documentation links.

```bash
drc explain DRC001
drc explain DRC003 --platform vercel
```

## `drc fix [path]`

Generates safe patches for eligible findings, displays unified diffs, prompts for approval (or auto-applies `safe-auto` fixes), validates generated syntax, and re-scans the project.

```bash
drc fix
drc fix --dry-run
drc fix ./my-app --platform railway --yes
```

## `drc verify [path]`

Re-runs static analysis and configuration validation, and optionally performs opt-in production build (`--build`) or controlled startup health checks (`--startup`).

```bash
drc verify
drc verify --platform vercel
drc verify --build --allow-exec
drc verify --no-exec
```
