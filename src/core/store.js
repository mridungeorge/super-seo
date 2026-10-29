// History store, backed by node:sqlite (Node 24's built-in driver).

import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';

export function openDb(dbPath) {
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  const db = new DatabaseSync(dbPath);
  db.exec(`
    PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS snapshots (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      domain TEXT NOT NULL,
      captured_at TEXT NOT NULL,
      as_of TEXT,
      window TEXT,
      geography TEXT,
      source TEXT,
      payload_json TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS metrics (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      domain TEXT NOT NULL,
      captured_at TEXT NOT NULL,
      as_of TEXT,
      source TEXT,
      field TEXT NOT NULL,
      value_num REAL,
      value_text TEXT,
      unit TEXT,
      geography TEXT,
      window TEXT
    );
    CREATE TABLE IF NOT EXISTS deltas (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      domain TEXT NOT NULL,
      metric TEXT NOT NULL,
      from_value REAL,
      to_value REAL,
      delta_pct REAL,
      computed_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS runs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      started_at TEXT NOT NULL,
      finished_at TEXT,
      command TEXT,
      domains_json TEXT,
      status TEXT,
      notes TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_metrics_domain ON metrics(domain, field, captured_at);
    CREATE INDEX IF NOT EXISTS idx_snapshots_domain ON snapshots(domain, captured_at);
  `);
  return db;
}

/**
 * Record one snapshot. `metrics` maps a field name to a number, a string, or {value, unit}.
 * `payload` is kept as JSON for anything that does not fit a single metric.
 */
export function recordSnapshot(dbPath, domain, metrics, payload = {}) {
  const db = openDb(dbPath);
  const capturedAt = new Date().toISOString();
  db.prepare('INSERT INTO snapshots (domain, captured_at, as_of, window, geography, source, payload_json) VALUES (?,?,?,?,?,?,?)').run(domain, capturedAt, capturedAt.slice(0, 10), 'point', 'WORLD', 'own', JSON.stringify({ metrics, ...payload }));
  const insert = db.prepare('INSERT INTO metrics (domain, captured_at, as_of, source, field, value_num, value_text, unit, geography, window) VALUES (?,?,?,?,?,?,?,?,?,?)');
  for (const [field, raw] of Object.entries(metrics)) {
    const m = raw && typeof raw === 'object' ? raw : { value: raw };
    if (m.value === null || m.value === undefined) continue;
    const isNum = typeof m.value === 'number' && isFinite(m.value);
    insert.run(domain, capturedAt, capturedAt.slice(0, 10), 'own', field, isNum ? m.value : null, isNum ? null : String(m.value), m.unit ?? null, 'WORLD', 'point');
  }
  db.close?.();
  return capturedAt;
}

export function metricHistory(dbPath, domain, field, { months = 12 } = {}) {
  const db = openDb(dbPath);
  const rows = db
    .prepare(
      `SELECT captured_at, as_of, source, value_num, value_text, unit FROM metrics
       WHERE domain = ? AND field = ? ORDER BY captured_at ASC`,
    )
    .all(domain, field);
  db.close?.();
  const cutoff = Date.now() - months * 31 * 24 * 3600 * 1000;
  return rows.filter((r) => new Date(r.captured_at).getTime() >= cutoff);
}

export function snapshots(dbPath, domain, limit = 50) {
  const db = openDb(dbPath);
  const rows = db
    .prepare('SELECT id, captured_at, as_of, window, geography FROM snapshots WHERE domain = ? ORDER BY captured_at DESC LIMIT ?')
    .all(domain, limit);
  db.close?.();
  return rows;
}

export function recordRun(dbPath, { command, domains = [], status = 'ok', notes = null }) {
  const db = openDb(dbPath);
  db.prepare('INSERT INTO runs (started_at, finished_at, command, domains_json, status, notes) VALUES (?,?,?,?,?,?)').run(
    new Date().toISOString(),
    new Date().toISOString(),
    command,
    JSON.stringify(domains),
    status,
    notes,
  );
  db.close?.();
}
