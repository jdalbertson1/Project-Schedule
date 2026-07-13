// Database adapter.
// - On Railway: set DATABASE_URL (added automatically when you attach a Postgres service) -> uses Postgres.
// - Locally: no DATABASE_URL -> uses a SQLite file (data.db) so you can run `npm start` with zero setup.

const fs = require('fs');
const path = require('path');

const usePg = !!process.env.DATABASE_URL;
let query; // query(sql, params) -> Promise<rows[]>

if (usePg) {
  const { Pool } = require('pg');
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.PGSSL === 'disable' ? false : { rejectUnauthorized: false },
  });
  query = async (sql, params = []) => {
    // convert ? placeholders to $1, $2, ...
    let i = 0;
    const pgSql = sql.replace(/\?/g, () => `$${++i}`);
    const res = await pool.query(pgSql, params);
    return res.rows;
  };
} else {
  const Database = require('better-sqlite3');
  const db = new Database(path.join(__dirname, 'data.db'));
  db.pragma('journal_mode = WAL');
  query = async (sql, params = []) => {
    const stmt = db.prepare(sql);
    if (/^\s*(select|with)/i.test(sql) || /returning/i.test(sql)) {
      return stmt.all(...params);
    }
    stmt.run(...params);
    return [];
  };
}

async function init() {
  const idCol = usePg ? 'id SERIAL PRIMARY KEY' : 'id INTEGER PRIMARY KEY AUTOINCREMENT';
  await query(`CREATE TABLE IF NOT EXISTS tasks (
    ${idCol},
    phase TEXT NOT NULL,
    wbs TEXT NOT NULL,
    title TEXT NOT NULL,
    lead TEXT,
    start_date TEXT,
    deadline TEXT,
    status TEXT,
    pct REAL,
    notes TEXT,
    sort INTEGER NOT NULL
  )`);

  const existing = await query('SELECT COUNT(*) AS n FROM tasks');
  const n = Number(existing[0].n);
  if (n === 0) {
    const seed = JSON.parse(fs.readFileSync(path.join(__dirname, 'seed.json'), 'utf8'));
    for (const r of seed) {
      await query(
        `INSERT INTO tasks (phase, wbs, title, lead, start_date, deadline, status, pct, notes, sort)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [r.phase, r.wbs, r.title, r.lead, r.start_date, r.deadline, r.status, r.pct, r.notes, r.sort]
      );
    }
    console.log(`Seeded ${seed.length} tasks from seed.json`);
  }
}

module.exports = { query, init, usePg };
