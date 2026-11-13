const express = require('express');
const cors = require('cors');

const app = express();

// DRC008: Hardcoded localhost origin in CORS configuration
app.use(
  cors({
    origin: 'http://localhost:5173',
    credentials: true,
  }),
);

app.get('/api/dashboard', (_req, res) => {
  const dbUrl = process.env.DATABASE_URL;
  res.json({ ok: true, connected: Boolean(dbUrl) });
});

const port = process.env.PORT || 3001;
app.listen(port, '0.0.0.0');
