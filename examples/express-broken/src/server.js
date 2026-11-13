const express = require('express');
const multer = require('multer');

const app = express();

// DRC009: Non-persistent local disk upload directory
const upload = multer({ dest: './uploads/avatars' });

app.post('/profile/avatar', upload.single('avatar'), (req, res) => {
  res.json({ uploaded: true, file: req.file?.filename });
});

app.get('/health', (_req, res) => {
  res.json({ status: 'ok', apiKey: Boolean(process.env.PAYMENT_GATEWAY_API_KEY) });
});

// DRC005: Hardcoded port 4000 and loopback 127.0.0.1 binding
app.listen(4000, '127.0.0.1', () => {
  console.log('Server running on http://localhost:4000');
});
