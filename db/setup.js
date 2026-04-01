/**
 * db/setup.js — Pure-JS SQLite via sql.js (no Python/build-tools needed)
 * 
 * Usage: call initDb() once at startup (returns Promise), then use getDb() synchronously.
 */
const path = require('path');
const fs = require('fs');

const isVercel = process.env.VERCEL === '1';
const DB_PATH = isVercel ? '/tmp/alfityan.db' : path.join(__dirname, 'alfityan.db');

let _SQL = null;  // sql.js module (loaded once)
let _db = null;  // in-memory Database instance (singleton)

// Save in-memory DB to disk
function flush() {
  if (!_db) return;
  fs.writeFileSync(DB_PATH, Buffer.from(_db.export()));
}

// ─── Async bootstrap (called once at server startup) ──────────────────────────
async function initDb() {
  if (_db) return; // already initialised

  const initSqlJs = require('sql.js');
  _SQL = await initSqlJs({
    locateFile: f => path.join(__dirname, '../node_modules/sql.js/dist/', f)
  });

  if (fs.existsSync(DB_PATH)) {
    _db = new _SQL.Database(fs.readFileSync(DB_PATH));
  } else {
    _db = new _SQL.Database();
  }

  // Create tables
  _db.run(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'admin',
      is_first_login INTEGER NOT NULL DEFAULT 1,
      one_time_code TEXT,
      created_at TEXT DEFAULT (datetime('now','localtime'))
    );
    CREATE TABLE IF NOT EXISTS one_time_codes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      code TEXT UNIQUE NOT NULL,
      assigned_to TEXT,
      used INTEGER NOT NULL DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now','localtime'))
    );
    CREATE TABLE IF NOT EXISTS students (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      nis TEXT UNIQUE NOT NULL,
      class TEXT NOT NULL DEFAULT '8B Ahmad bin Hambal',
      points INTEGER NOT NULL DEFAULT 0,
      avatar_color TEXT DEFAULT '#6366f1',
      created_at TEXT DEFAULT (datetime('now','localtime'))
    );
    CREATE TABLE IF NOT EXISTS assignments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      subject TEXT NOT NULL,
      description TEXT,
      due_date TEXT,
      created_by TEXT,
      created_at TEXT DEFAULT (datetime('now','localtime'))
    );
    CREATE TABLE IF NOT EXISTS grades (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      student_id INTEGER NOT NULL,
      assignment_id INTEGER NOT NULL,
      score REAL NOT NULL,
      points_awarded INTEGER NOT NULL DEFAULT 0,
      graded_by TEXT,
      graded_at TEXT DEFAULT (datetime('now','localtime')),
      FOREIGN KEY (student_id) REFERENCES students(id) ON DELETE CASCADE,
      FOREIGN KEY (assignment_id) REFERENCES assignments(id) ON DELETE CASCADE,
      UNIQUE(student_id, assignment_id)
    );
    CREATE TABLE IF NOT EXISTS chat_messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT NOT NULL,
      message TEXT NOT NULL,
      color TEXT DEFAULT '#6366f1',
      created_at TEXT DEFAULT (datetime('now','localtime'))
    );
    CREATE TABLE IF NOT EXISTS forum_posts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      body TEXT NOT NULL,
      author TEXT NOT NULL,
      category TEXT DEFAULT 'Umum',
      created_at TEXT DEFAULT (datetime('now','localtime'))
    );
    CREATE TABLE IF NOT EXISTS forum_replies (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      post_id INTEGER NOT NULL,
      body TEXT NOT NULL,
      author TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now','localtime')),
      FOREIGN KEY (post_id) REFERENCES forum_posts(id) ON DELETE CASCADE
    );
    CREATE TABLE IF NOT EXISTS gallery (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      filename TEXT NOT NULL,
      caption TEXT,
      uploaded_by TEXT,
      uploaded_at TEXT DEFAULT (datetime('now','localtime'))
    );
    CREATE TABLE IF NOT EXISTS admin_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      admin_username TEXT NOT NULL,
      action TEXT NOT NULL,
      target TEXT,
      detail TEXT,
      created_at TEXT DEFAULT (datetime('now','localtime'))
    );
    CREATE TABLE IF NOT EXISTS app_settings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      is_kisi_mode INTEGER NOT NULL DEFAULT 0
    );
    INSERT OR IGNORE INTO app_settings (id, is_kisi_mode) VALUES (1, 0);
    CREATE TABLE IF NOT EXISTS time_capsules (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      message TEXT NOT NULL,
      unlock_at TEXT,
      is_open INTEGER NOT NULL DEFAULT 0,
      opened_at TEXT,
      created_by TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now','localtime'))
    );
    CREATE TABLE IF NOT EXISTS capsule_entries (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      capsule_id INTEGER NOT NULL,
      author_name TEXT NOT NULL,
      message TEXT NOT NULL,
      image_filename TEXT,
      created_at TEXT DEFAULT (datetime('now','localtime')),
      FOREIGN KEY (capsule_id) REFERENCES time_capsules(id) ON DELETE CASCADE
    );
  `);

  flush();
}

// ─── Synchronous wrapper returned by getDb() ──────────────────────────────────
class DbWrapper {
  pragma(str) {
    try { _db.run('PRAGMA ' + str); } catch (_) { }
    return this;
  }

  exec(sql) {
    _db.run(sql);
    flush();
    return this;
  }

  prepare(sql) {
    return {
      run(...args) {
        const p = args.length === 1 && Array.isArray(args[0]) ? args[0] : args;
        _db.run(sql, p.length ? p : undefined);
        flush();
        return { changes: 1 };
      },
      get(...args) {
        const p = args.length === 1 && Array.isArray(args[0]) ? args[0] : args;
        const res = _db.exec(sql, p.length ? p : undefined);
        if (!res.length || !res[0].values.length) return undefined;
        const obj = {};
        res[0].columns.forEach((c, i) => { obj[c] = res[0].values[0][i]; });
        return obj;
      },
      all(...args) {
        const p = args.length === 1 && Array.isArray(args[0]) ? args[0] : args;
        const res = _db.exec(sql, p.length ? p : undefined);
        if (!res.length) return [];
        const cols = res[0].columns;
        return res[0].values.map(row => {
          const obj = {};
          cols.forEach((c, i) => { obj[c] = row[i]; });
          return obj;
        });
      },
    };
  }

  close() { flush(); /* keep in-memory instance alive */ }
}

function getDb() {
  if (!_db) throw new Error('DB not initialised — await initDb() first');
  return new DbWrapper();
}

// Legacy shim so seed.js still works (seed.js calls setupDatabase then getDb directly)
function setupDatabase() { /* no-op: tables are created in initDb() */ }

module.exports = { initDb, setupDatabase, getDb, DB_PATH };
