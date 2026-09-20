const path = require('path');
const Database = require('better-sqlite3');

// The database is built by data-pipeline/ and *committed* (data-pipeline/
// output/hamilton.db), so a deploy needs only Node — no Python pipeline or
// raw data. DB_PATH overrides the location (e.g. for tests or a host that
// mounts it elsewhere).
const DB_PATH = process.env.DB_PATH || path.join(__dirname, '..', 'data-pipeline', 'output', 'hamilton.db');

let db;
try {
  db = new Database(DB_PATH, { readonly: true, fileMustExist: true });
} catch (err) {
  // fileMustExist makes a missing database fail loudly instead of silently
  // creating an empty one — but the bare SQLite error doesn't say what to do.
  throw new Error(
    `Cannot open the database at ${DB_PATH} (${err.message}). It is built by data-pipeline/scripts/build_hamilton_db.py and committed to the repo; rebuild it (see the root README) or check DB_PATH.`,
    { cause: err }
  );
}

// SQLite only enforces foreign keys when a connection turns it on explicitly.
db.pragma('foreign_keys = ON');

module.exports = db;
