# Frontend

React frontend for the Hamilton Suburb Decision Assistant, built with
[Vite](https://vite.dev/). Talks to the Express API in [../backend/](../backend/).

## Tech stack

- **React** (JS/JSX, no TypeScript) — per the project proposal
- **Vite** for the dev server and build — chosen over Create React App, which is
  effectively unmaintained
- **React Router** for the three pages (Suburb Finder, Rental Price Check, About)
- Plain CSS, no component/design library
- **oxlint** for linting (`npm run lint`, configured in `.oxlintrc.json`)

## Features

- **Suburb Finder** (`/suburb-finder`, the default page): enter a weekly budget and an
  optional destination, get a ranked list of suburbs with an overall score, an
  expandable per-criterion score breakdown, a budget check, and a list of excluded
  suburbs with the reason each was left out.
- **Weight sliders with live re-ranking**: dragging the rent, transport or distance
  slider re-ranks the results as you drag. Requests are throttled and any request
  still in flight is cancelled when a newer one starts, so an older response can
  never overwrite a newer one. A "Live ranking" checkbox turns this off.
- **Rental Price Check** (`/rental-price-check`): pick a suburb, dwelling type and
  number of bedrooms, optionally enter a weekly rent, and see the median and typical
  range, a Below market / Fair / Above market label, and a rent breakdown by dwelling
  type and bedrooms. Warnings flag old data and small samples, and a note explains
  that the data does not record furnishing or ensuites. Each suburb in Suburb Finder
  links here with the suburb and dwelling type pre-filled.
- **About** (`/about`): what the app does, how to use it, and its data sources.
- A **Data sources** footer on every page credits each dataset, as its licence requires.

## Project structure

```
frontend/
├── index.html                       # Vite entry HTML
├── vite.config.js                   # dev server config, incl. the /api proxy (see below)
├── .oxlintrc.json                   # linter config
├── public/
│   └── favicon.svg
├── src/
│   ├── main.jsx                     # React entry point and route definitions
│   ├── App.jsx                      # layout: app title, nav bar, current page, footer
│   ├── App.css, index.css           # styling
│   ├── api.js                       # fetch helpers for the backend API
│   ├── throttle.js                  # leading + trailing throttle for live re-ranking
│   ├── rentalCheckOptions.js        # dwelling type and bedroom options
│   ├── suburbFinderOptions.js       # the four destinations
│   └── components/
│       ├── NavBar.jsx               # links to the three pages
│       ├── SuburbFinder.jsx         # Suburb Finder page: state, requests, live re-ranking
│       ├── SuburbFinderForm.jsx     # budget, destination, weight sliders
│       ├── SuburbFinderResults.jsx  # ranked list, score breakdown, excluded suburbs
│       ├── RentalPriceCheck.jsx     # Rental Price Check page: state and requests
│       ├── RentalPriceCheckForm.jsx # suburb, dwelling type, bedrooms, rent
│       ├── RentalPriceCheckResult.jsx # result card and rent breakdown table
│       ├── About.jsx                # About page
│       └── DataSources.jsx          # data sources footer
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

This proxy is dev-only. In production, `npm run build` writes the app to
`frontend/dist`, and the Express server serves it alongside the API from one
origin, so the same relative paths keep working (see the root
[README](../README.md)).
