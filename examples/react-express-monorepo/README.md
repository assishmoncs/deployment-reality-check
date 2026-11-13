# Example C — React + Express Monorepo

This example demonstrates a full-stack React (Vite) + Express monorepo with cross-service configuration issues:

1. **DRC001**: `process.env.DATABASE_URL` and `process.env.API_URL` are undocumented in `.env.example`.
2. **DRC007**: `client/src/App.tsx` accesses `process.env.API_URL` instead of `import.meta.env.VITE_API_URL`, which evaluates to `undefined` in Vite browser builds.
3. **DRC008**: `server/src/index.js` hardcodes `cors({ origin: 'http://localhost:5173' })`, blocking requests from the deployed production frontend domain.

## Try It

```bash
drc scan ./examples/react-express-monorepo --platform railway
drc fix ./examples/react-express-monorepo --platform railway --dry-run
```
