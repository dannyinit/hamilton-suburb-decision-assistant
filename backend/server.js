const fs = require('fs');
const path = require('path');
const express = require('express');
const compression = require('compression');
const db = require('./db');
const routes = require('./routes');

const app = express();
const PORT = process.env.PORT || 3001;

// The built frontend (`npm run build` in frontend/). In production one
// Express process serves both the API and this static bundle, so the
// browser only ever talks to a single origin (frontend/src/api.js already
// uses relative /api paths). Not present in plain backend development
// (vite serves the frontend and proxies /api here instead), so everything
// below that touches it is conditional on the directory existing.
const FRONTEND_DIST = path.join(__dirname, '..', 'frontend', 'dist');
const hasFrontend = fs.existsSync(path.join(FRONTEND_DIST, 'index.html'));

// Gzip responses: bandwidth counts against most free hosting tiers, and
// the JSON/JS/CSS this app sends compresses well.
app.use(compression());
app.use(express.json());

// Everything the API exposes lives under /api — including this summary,
// which used to be at GET / before that path was needed for the frontend.
app.get('/api', (req, res) => {
  res.json({
    message: 'Hamilton Suburb Decision Assistant API',
    endpoints: {
      health: '/api/health',
      suburbs: '/api/suburbs',
      rentalPriceCheck: '/api/rental-price-check?sa2_code=...&dwelling_type=...&number_of_beds=...',
      rentalPriceCheckBedAvailability: '/api/rental-price-check-bed-availability',
      rentalPriceCheckExamples: '/api/rental-price-check-examples',
      suburbFinder: '/api/suburb-finder?budget=...&destination=...&rent_weight=...&transport_weight=...&distance_weight=...',
      suburbFinderExamples: '/api/suburb-finder-examples',
    },
  });
});

// Confirms the server is up and the db connection + foreign_keys pragma are live.
app.get('/api/health', (req, res) => {
  const { count } = db.prepare('SELECT COUNT(*) AS count FROM suburbs').get();
  const foreignKeysOn = db.pragma('foreign_keys', { simple: true });
  res.json({ status: 'ok', suburbCount: count, foreignKeysOn: Boolean(foreignKeysOn) });
});

app.use('/api', routes);

// An unknown API path is a JSON 404, never the frontend's index.html (which
// the SPA fallback below would otherwise return with a misleading 200).
app.use('/api', (req, res) => {
  res.status(404).json({ error: `Unknown API path: ${req.path}` });
});

if (hasFrontend) {
  app.use(express.static(FRONTEND_DIST, {
    setHeaders: (res, filePath) => {
      // Vite fingerprints everything under /assets (the hash changes with
      // the content), so those can be cached indefinitely. index.html is the
      // one file whose name never changes, so it must be revalidated every
      // time or a redeploy wouldn't reach returning visitors.
      if (filePath.includes(`${path.sep}assets${path.sep}`)) {
        res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
      } else if (filePath.endsWith('index.html')) {
        res.setHeader('Cache-Control', 'no-cache');
      }
    },
  }));

  // Client-side routes (BrowserRouter, e.g. /rental-price-check) don't exist
  // on disk, so a reload or a shared deep link would 404 without this.
  // Requests for a missing *file* (anything with an extension, like a stale
  // /assets/x.js) still 404 rather than returning index.html as JavaScript.
  app.get('*', (req, res, next) => {
    if (path.extname(req.path)) return next();
    res.setHeader('Cache-Control', 'no-cache');
    res.sendFile(path.join(FRONTEND_DIST, 'index.html'));
  });
} else {
  app.get('/', (req, res) => {
    res.status(404).json({
      error: 'Frontend not built. Run `npm run build --prefix frontend`, or use the vite dev server (see README) — the API itself is at /api.',
    });
  });
}

app.listen(PORT, () => {
  console.log(`Listening on http://localhost:${PORT} (${hasFrontend ? 'serving the built frontend and the API' : 'API only — frontend not built'})`);
});
