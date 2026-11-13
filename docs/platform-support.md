# Platform Capability Matrix & References

DRC evaluates rules against a versioned **Platform Capability Registry** (`src/platforms/`).

## Supported Platforms in v1.0.0

| Capability | Vercel (`vercel`) | Railway (`railway`) |
| :--- | :--- | :--- |
| **Execution Model** | Request-driven Serverless & Edge Functions | Persistent Container Services (Nixpacks / Docker) |
| **Default Local Filesystem** | Read-only (except ephemeral `/tmp`) | Ephemeral container root across redeploys |
| **Persistent Volumes** | Not supported (use Managed Storage / Blob / Postgres) | Supported via Railway Volumes (`RAILWAY_VOLUME_MOUNT_PATH`) |
| **Long-Running Daemons / WebSockets** | Incompatible in-process (use Vercel Cron Jobs / Workflows) | Supported natively |
| **Port & Host Binding** | Exported handler (`export default app`) | Must bind `process.env.PORT` on `0.0.0.0` |
| **Function Duration / Timeout** | Plan & runtime dependent: Hobby max 300s; Pro/Ent 300s default, up to 800s configurable, 1800s beta (Fluid Compute). Edge initial response 25s | Continuous execution; receives `SIGTERM` on redeploy |
| **Bundle Size Limit** | 250 MB uncompressed for Node.js (up to 5 GB beta Large Functions) | Container image limits |

## Official Documentation References (Last Reviewed: 2026-09-16)

- **Vercel Functions Limits**: https://vercel.com/docs/functions/limitations
- **Vercel General Limits**: https://vercel.com/docs/limits
- **Vercel Project Configuration**: https://vercel.com/docs/project-configuration
- **Railway Deployments Reference**: https://docs.railway.com/deployments/reference
- **Railway Variables Reference**: https://docs.railway.com/variables/reference
- **Railway Databases & Volumes Reference**: https://docs.railway.com/databases/reference
