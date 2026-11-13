# Example B — Broken Express Application

This example demonstrates a Node.js + Express backend targeting **Railway** with common production deployment issues:

1. **DRC001**: `process.env.PAYMENT_GATEWAY_API_KEY` is used without a `.env.example` file.
2. **DRC004**: `package.json` only defines `"dev": "nodemon src/server.js"` and is missing a production `"start"` script.
3. **DRC005**: `src/server.js` binds to hardcoded port `4000` and loopback address `'127.0.0.1'`, preventing Railway's proxy from routing external traffic.
4. **DRC009**: `multer({ dest: './uploads/avatars' })` writes user uploads to ephemeral local container storage without a persistent Volume or S3 bucket.

## Try It

```bash
drc scan ./examples/express-broken --platform railway
drc fix ./examples/express-broken --platform railway --dry-run
```
