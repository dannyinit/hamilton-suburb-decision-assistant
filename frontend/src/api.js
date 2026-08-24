// Thin fetch helpers for the backend API. Relative paths only — the /api
// prefix is forwarded to the backend by Vite's dev proxy (vite.config.js),
// so these work unchanged in dev without any CORS setup.
const API_BASE = '/api';

// GET /api/suburbs -> { suburbs: [{ sa2_code, sa2_name }, ...] }
// See backend/routes/suburbs.js.
export async function getSuburbs() {
  const res = await fetch(`${API_BASE}/suburbs`);
  if (!res.ok) {
    throw new Error(`Could not load the suburb list (status ${res.status}).`);
  }
  const data = await res.json();
  return data.suburbs;
}

// GET /api/rental-price-check-bed-availability
// -> { [sa2_code]: { [dwelling_type]: [number_of_beds, ...] } }
// See backend/routes/rentalPriceCheck.js. A suburb/dwelling type combo with
// no exact bed-count rows is simply absent from the response.
export async function getBedAvailability() {
  const res = await fetch(`${API_BASE}/rental-price-check-bed-availability`);
  if (!res.ok) {
    throw new Error(`Could not load bedroom availability (status ${res.status}).`);
  }
  return res.json();
}

// GET /api/rental-price-check?sa2_code=...&dwelling_type=...&number_of_beds=...&rent=...
// See backend/routes/rentalPriceCheck.js. `params` values that are '' or
// undefined are omitted from the query string entirely, matching the
// backend's own "omitted means any/none" handling for number_of_beds and
// rent — sending an empty string instead would behave differently for
// rent (Number('') is 0, a valid comparison value, not "no rent given").
export async function getRentalPriceCheck(params) {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== '') {
      query.set(key, value);
    }
  }

  const res = await fetch(`${API_BASE}/rental-price-check?${query}`);
  const data = await res.json().catch(() => null);

  if (!res.ok) {
    const message = data?.error || `Request failed (status ${res.status}).`;
    throw new Error(message);
  }

  return data;
}

// GET /api/suburb-finder?budget=...&destination=...&rent_weight=...&transport_weight=...&distance_weight=...
// See backend/routes/suburbFinder.js. Same "omit empty/undefined params"
// rule as getRentalPriceCheck — important here specifically for
// `destination`: omitting the key entirely means "no destination" (distance
// excluded from scoring), which is different from sending an empty or
// unrecognised value (both rejected with 400 by the backend).
//
// Optional `{ signal }` (an AbortController's signal) lets a caller cancel
// this request — used by the weight sliders' live re-ranking, where a new
// drag position should supersede a still-in-flight request for an older
// one rather than let both resolve and risk the older one winning the
// race. An aborted request rejects with an AbortError, which callers can
// check for (`err.name === 'AbortError'`) and treat as "superseded", not
// a real failure.
export async function getSuburbFinder(params, { signal } = {}) {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== '') {
      query.set(key, value);
    }
  }

  const res = await fetch(`${API_BASE}/suburb-finder?${query}`, { signal });
  const data = await res.json().catch(() => null);

  if (!res.ok) {
    const message = data?.error || `Request failed (status ${res.status}).`;
    throw new Error(message);
  }

  return data;
}
