const path = require("path");
const sqlite3 = require("sqlite3").verbose();

function openDb(dbPath) {
  const resolved = path.resolve(dbPath);
  const db = new sqlite3.Database(resolved);

  const run = (sql, params = []) =>
    new Promise((resolve, reject) => {
      db.run(sql, params, function onRun(err) {
        if (err) return reject(err);
        resolve(this);
      });
    });

  const get = (sql, params = []) =>
    new Promise((resolve, reject) => {
      db.get(sql, params, (err, row) => {
        if (err) return reject(err);
        resolve(row);
      });
    });

  const all = (sql, params = []) =>
    new Promise((resolve, reject) => {
      db.all(sql, params, (err, rows) => {
        if (err) return reject(err);
        resolve(rows);
      });
    });

  return { db, run, get, all };
}

async function initDb(dbApi) {
  await dbApi.run("PRAGMA foreign_keys = ON;");

  await dbApi.run(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      telegram_id TEXT UNIQUE NOT NULL,
      first_name TEXT,
      username TEXT,
      pro_until DATETIME NULL,
      created_at DATETIME NOT NULL DEFAULT (datetime('now'))
    );
  `);

  await dbApi.run(`
    CREATE TABLE IF NOT EXISTS promo_requests (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      telegram_id TEXT NOT NULL,
      status TEXT NOT NULL CHECK(status IN ('pending','approved','rejected')),
      screenshot_file_id TEXT,
      created_at DATETIME NOT NULL DEFAULT (datetime('now'))
    );
  `);

  await dbApi.run(`
    CREATE TABLE IF NOT EXISTS promo_codes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      code TEXT UNIQUE NOT NULL,
      telegram_id TEXT NOT NULL,
      activated INTEGER NOT NULL DEFAULT 0,
      expires_at DATETIME NULL,
      created_at DATETIME NOT NULL DEFAULT (datetime('now'))
    );
  `);

  await dbApi.run(`
    CREATE TABLE IF NOT EXISTS test_progress (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      telegram_id TEXT NOT NULL,
      ticket_id TEXT NOT NULL,
      answers TEXT NOT NULL,
      completed INTEGER NOT NULL DEFAULT 0,
      score INTEGER NOT NULL DEFAULT 0,
      updated_at DATETIME NOT NULL DEFAULT (datetime('now')),
      UNIQUE(telegram_id, ticket_id)
    );
  `);
}

module.exports = { openDb, initDb };

