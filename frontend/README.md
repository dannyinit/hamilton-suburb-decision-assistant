# Frontend

React frontend for the Hamilton Suburb Decision Assistant, built with
[Vite](https://vite.dev/). Talks to the Express API in [../backend/](../backend/).

## Tech stack

- **React** (JS/JSX, no TypeScript) — per the project proposal
- **Vite** for the dev server and build — chosen over Create React App, which is
  effectively unmaintained
- Plain CSS, no component/design library — basic styling only at this stage

## Project structure

```
frontend/
├── index.html            # Vite entry HTML
├── vite.config.js         # dev server config, incl. the /api proxy (see below)
├── src/
│   ├── main.jsx            # React entry point
│   ├── App.jsx              # top-level component
│   ├── App.css, index.css   # basic styling
└── README.md
```

## Setup

1. `cd frontend`
2. `npm install`
3. `npm run dev`
4. Open the URL Vite prints (typically `http://localhost:5173`)

**Prerequisite:** the backend must be running separately on port 3001 (`npm start`
in `backend/`) — see [../backend/README.md](../backend/README.md). The frontend
does not start or manage the backend process.

## Connecting to the backend

The frontend calls the API with relative paths, e.g. `fetch('/api/health')`. In
dev, Vite's `server.proxy` config (in `vite.config.js`) forwards any `/api/*`
request to `http://localhost:3001`, so the browser only ever talks to the Vite
dev server on one origin — no CORS setup needed on the backend.

This proxy is dev-only. It won't exist for a production build (`npm run build`
serves static files with no backend attached) — deployment will need either a
real backend base URL baked into the frontend, or a reverse proxy set up on
whatever host serves both. Out of scope for now; noted here so it isn't
forgotten later.

## Current status

Step 1 (this commit): project scaffold + backend connectivity check only. `App.jsx`
calls `/api/health` on load and renders the raw response, to prove the dev
server → proxy → backend chain works end to end before any real screens are
built.

Not yet built: the Rental Price Check form/results screen, Suburb Finder
screens, routing between them, and any real styling system.
