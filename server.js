const express = require('express');
const { createClient } = require('@libsql/client');

const app = express();
app.use(express.json());

app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

let db = null;

app.post('/connect', (req, res) => {
  try {
    db = createClient({
      url: 'libsql://cobalt-ojaskul26.aws-ap-south-1.turso.io',
      authToken: req.body.token,
    });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/execute', async (req, res) => {
  if (!db) return res.status(400).json({ error: 'Not connected' });
  try {
    const result = await db.execute({ sql: req.body.sql, args: req.body.args || [] });
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/execute-batch', async (req, res) => {
  if (!db) return res.status(400).json({ error: 'Not connected' });
  try {
    const stmts = req.body.statements.map(s =>
      typeof s === 'string' ? { sql: s } : { sql: s.sql, args: s.args || [] }
    );
    const results = await db.batch(stmts);
    res.json({ results });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`Cobalt server running on http://localhost:${PORT}`);
});
