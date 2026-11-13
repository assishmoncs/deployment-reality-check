# Deployment Rule Catalog (`DRC001` – `DRC012`)

| Rule ID  | Name                                                            | Category      | Default Severity                      | Confidence    | Autofix                               |
| :------- | :-------------------------------------------------------------- | :------------ | :------------------------------------ | :------------ | :------------------------------------ |
| `DRC001` | Missing required environment configuration                      | `environment` | Warning                               | High          | `safe-auto` (`.env.example`)          |
| `DRC002` | Hardcoded localhost URLs in production code                     | `networking`  | Critical (Client) / Warning (Server)  | High          | `approval-required`                   |
| `DRC003` | Non-persistent SQLite database or file storage                  | `persistence` | Critical (Vercel) / Warning (Railway) | High          | `manual-guided`                       |
| `DRC004` | Missing or invalid production build/start scripts               | `runtime`     | Critical / Warning                    | High          | `safe-auto` / `approval-required`     |
| `DRC005` | Incorrect host or port binding                                  | `networking`  | Critical                              | High          | `approval-required`                   |
| `DRC006` | Sensitive server environment variables exposed to frontend code | `security`    | Critical                              | High          | `manual-guided`                       |
| `DRC007` | Incorrect frontend API URL configuration                        | `environment` | Warning                               | High          | `approval-required`                   |
| `DRC008` | CORS origin mismatch                                            | `networking`  | Warning / Critical                    | High          | `approval-required`                   |
| `DRC009` | Non-persistent local file upload storage                        | `persistence` | Critical (Vercel) / Warning (Railway) | High          | `manual-guided`                       |
| `DRC010` | Database migration or initialization risks                      | `persistence` | Critical / Warning                    | High / Medium | `manual-guided`                       |
| `DRC011` | Platform-incompatible long-running processes                    | `runtime`     | Critical / Warning                    | High          | `manual-guided`                       |
| `DRC012` | Conflicting or invalid deployment configuration                 | `runtime`     | Critical                              | High          | `approval-required` / `manual-guided` |

## False-Positive Prevention Design

- **`DRC001`**: Built-in runtime variables (`NODE_ENV`, `PORT`, `VERCEL_*`, `RAILWAY_*`) and expressions with fallbacks (`process.env.API_URL || 'https://...'`) are not flagged.
- **`DRC002`**: Localhost URLs in `*.test.*` / `*.spec.*` files, `console.log()` server startup messages, and fallback right-hand operands (`process.env.X || 'http://localhost:3000'`) are ignored.
- **`DRC003`**: Distinguishes active SQLite file creation (`new Database('app.db')` / Prisma `provider = "sqlite"`) from `package.json`-only dependencies (downgraded to `info`) and in-memory `:memory:` databases (ignored). Respects `RAILWAY_VOLUME_MOUNT_PATH` on Railway.
- **`DRC005`**: Does not flag Express apps targeting Vercel when the module exports the Express handler and guards `app.listen()`.
