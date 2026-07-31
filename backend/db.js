const path = require('path');
const Database = require('better-sqlite3');

const DB_PATH = path.join(__dirname, '..', 'data-pipeline', 'output', 'hamilton.db');

const db = new Database(DB_PATH, { readonly: true, fileMustExist: true });

// SQLite only enforces foreign keys when a connection turns it on explicitly.
db.pragma('foreign_keys = ON');

module.exports = db;
