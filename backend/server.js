const express = require('express');
const db = require('./db');
const routes = require('./routes');

const app = express();
const PORT = process.env.PORT || 3001;

app.use(express.json());

// Confirms the server is up and the db connection + foreign_keys pragma are live.
app.get('/api/health', (req, res) => {
  const { count } = db.prepare('SELECT COUNT(*) AS count FROM suburbs').get();
  const foreignKeysOn = db.pragma('foreign_keys', { simple: true });
  res.json({ status: 'ok', suburbCount: count, foreignKeysOn: Boolean(foreignKeysOn) });
});

app.use('/api', routes);

app.listen(PORT, () => {
  console.log(`Backend listening on http://localhost:${PORT}`);
});
