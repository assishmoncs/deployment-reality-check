# Example A — Broken Next.js Application

This example demonstrates a Next.js application targeting **Vercel** with three common production deployment blockers:

1. **DRC001**: `process.env.INTERNAL_JWT_SECRET` is referenced in `src/database.ts` without a `.env.example` template or default value.
2. **DRC002**: `src/lib/api.ts` (`'use client'`) hardcodes `http://localhost:3000/api/orders`, which points to the visitor's own machine in production.
3. **DRC003**: `src/database.ts` writes to a local SQLite file (`./data/app.sqlite`), which fails on Vercel's ephemeral/read-only serverless filesystem.

## Try It

```bash
drc scan ./examples/nextjs-broken --platform vercel
drc fix ./examples/nextjs-broken --platform vercel --dry-run
```
