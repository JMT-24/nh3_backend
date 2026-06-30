import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { config } from './config.js';
import { hydrateInto, mirror, mongoEnabled } from './db.mongo.js';
import type {
  AlarmEntry,
  AlertConfig,
  AlertState,
  ControlState,
  SensorHistoryPoint,
  SensorId,
  SensorReading,
  SmsState,
} from './types.js';

// Ensure the parent dir exists (e.g. ./data) before opening the file.
mkdirSync(dirname(config.dbPath), { recursive: true });

export const db = new Database(config.dbPath);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS readings (
    id      INTEGER PRIMARY KEY AUTOINCREMENT,
    sensor  TEXT    NOT NULL,           -- 'nh3' | 'ph' | 'temp'
    value   REAL    NOT NULL,
    raw     TEXT,
    ts      TEXT    NOT NULL            -- ISO 8601
  );
  CREATE INDEX IF NOT EXISTS idx_readings_sensor_ts ON readings (sensor, ts);

  CREATE TABLE IF NOT EXISTS alarms (
    id           TEXT    PRIMARY KEY,
    ts           TEXT    NOT NULL,
    severity     TEXT    NOT NULL,
    source       TEXT    NOT NULL,
    msg          TEXT    NOT NULL,
    acknowledged INTEGER NOT NULL DEFAULT 0
  );
  CREATE INDEX IF NOT EXISTS idx_alarms_ts ON alarms (ts);

  -- Single-row tables (id = 1) for current config / control / gateway state.
  CREATE TABLE IF NOT EXISTS kv (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
`);

// ---------- readings ----------

const insertReadingStmt = db.prepare(
  `INSERT INTO readings (sensor, value, raw, ts) VALUES (@sensor, @value, @raw, @ts)`,
);

function insertReadingLocal(r: SensorReading): void {
  insertReadingStmt.run({ sensor: r.id, value: r.value, raw: r.raw ?? null, ts: r.ts });
}

export function insertReading(r: SensorReading): void {
  insertReadingLocal(r);
  mirror.reading(r);
}

const latestReadingStmt = db.prepare(
  `SELECT sensor, value, raw, ts FROM readings WHERE sensor = ? ORDER BY ts DESC, id DESC LIMIT 1`,
);

export function latestReadings(): SensorReading[] {
  const ids: SensorId[] = ['nh3', 'ph', 'temp'];
  const out: SensorReading[] = [];
  for (const id of ids) {
    const row = latestReadingStmt.get(id) as
      | { sensor: SensorId; value: number; raw: string | null; ts: string }
      | undefined;
    if (row) out.push({ id: row.sensor, value: row.value, raw: row.raw ?? undefined, ts: row.ts });
  }
  return out;
}

const RANGE_MS: Record<string, number> = {
  '1H': 60 * 60 * 1000,
  '6H': 6 * 60 * 60 * 1000,
  '24H': 24 * 60 * 60 * 1000,
  '7D': 7 * 24 * 60 * 60 * 1000,
};

const historyStmt = db.prepare(
  `SELECT value, ts FROM readings WHERE sensor = ? AND ts >= ? ORDER BY ts ASC`,
);

export function sensorHistory(
  id: SensorId,
  range: string,
  nowMs: number,
): SensorHistoryPoint[] {
  const span = RANGE_MS[range] ?? RANGE_MS['24H']!;
  const since = new Date(nowMs - span).toISOString();
  const rows = historyStmt.all(id, since) as { value: number; ts: string }[];
  return rows.map((r) => ({ ts: r.ts, value: r.value }));
}

// ---------- alarms ----------

const insertAlarmStmt = db.prepare(
  `INSERT OR IGNORE INTO alarms (id, ts, severity, source, msg, acknowledged)
   VALUES (@id, @ts, @severity, @source, @msg, @acknowledged)`,
);

function insertAlarmLocal(a: AlarmEntry): void {
  insertAlarmStmt.run({ ...a, acknowledged: a.acknowledged ? 1 : 0 });
}

export function insertAlarm(a: AlarmEntry): void {
  insertAlarmLocal(a);
  mirror.alarm({ ...a });
}

const listAlarmsStmt = db.prepare(
  `SELECT id, ts, severity, source, msg, acknowledged FROM alarms ORDER BY ts DESC LIMIT 200`,
);

export function listAlarms(): AlarmEntry[] {
  const rows = listAlarmsStmt.all() as (Omit<AlarmEntry, 'acknowledged'> & { acknowledged: number })[];
  return rows.map((r) => ({ ...r, acknowledged: Boolean(r.acknowledged) }));
}

const ackAlarmStmt = db.prepare(`UPDATE alarms SET acknowledged = 1 WHERE id = ?`);
export function ackAlarm(id: string): boolean {
  const changed = ackAlarmStmt.run(id).changes > 0;
  if (changed) mirror.ack(id);
  return changed;
}

const ackAllAlarmsStmt = db.prepare(`UPDATE alarms SET acknowledged = 1 WHERE acknowledged = 0`);
export function ackAllAlarms(): number {
  const n = ackAllAlarmsStmt.run().changes;
  if (n > 0) mirror.ackAll();
  return n;
}

// ---------- kv (config / control / gateway) ----------

const getKvStmt = db.prepare(`SELECT value FROM kv WHERE key = ?`);
const setKvStmt = db.prepare(
  `INSERT INTO kv (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
);

export function getKv<T>(key: string, fallback: T): T {
  const row = getKvStmt.get(key) as { value: string } | undefined;
  if (!row) return fallback;
  try {
    return JSON.parse(row.value) as T;
  } catch {
    return fallback;
  }
}

function setKvLocal(key: string, valueStr: string): void {
  setKvStmt.run(key, valueStr);
}

export function setKv<T>(key: string, value: T): void {
  const valueStr = JSON.stringify(value);
  setKvLocal(key, valueStr);
  mirror.kv(key, valueStr);
}

export const KV = {
  alertConfig: 'alertConfig',
  controlState: 'controlState',
  alertState: 'alertState',
  smsState: 'smsState',
} as const;

export function getAlertConfig(): AlertConfig | null {
  return getKv<AlertConfig | null>(KV.alertConfig, null);
}

export function setAlertConfig(cfg: AlertConfig): void {
  setKv(KV.alertConfig, cfg);
}

export function getControlState(): ControlState | null {
  return getKv<ControlState | null>(KV.controlState, null);
}

export function setControlState(state: ControlState): void {
  setKv(KV.controlState, state);
}

export function getAlertState(): AlertState {
  return getKv<AlertState>(KV.alertState, {});
}

export function setAlertState(state: AlertState): void {
  setKv(KV.alertState, state);
}

export function getSmsState(): SmsState {
  return getKv<SmsState>(KV.smsState, { lastSent: {}, dailyDay: '', dailyCount: 0 });
}

export function setSmsState(state: SmsState): void {
  setKv(KV.smsState, state);
}

// ---------- first-run seed ----------

const DEFAULT_ALERT_CONFIG: AlertConfig = {
  enabled: true,
  cooldownSec: 300,
  recipients: [],
  // Natural, sentence-case wording — avoids the SMS spam filter. Only the
  // critical + sensor-offline templates are actually sent (see services/rules.ts);
  // the warn ones show on the dashboard only.
  templates: {
    'nh3.warn': 'Ammonia in the tank is rising and getting close to the safe limit (now {value} V).',
    'nh3.crit':
      'Ammonia in the tank has passed the safe limit (now {value} V). The system has started adding fresh water to bring it down. Please check the tank when you can.',
    'ph.warn': 'The water pH is drifting from the safe range (now {value}, safe range {safe}).',
    'ph.crit':
      'The water pH is outside the safe range (now {value}, safe range {safe}). Please check the tank when you can.',
    'temp.warn': 'The water temperature is below the comfort range (now {value} C).',
    'temp.crit':
      'The water temperature is above the safe limit (now {value} C). Please check the tank and aerator when you can.',
    'sensor.offline':
      'The {sensor} sensor has stopped responding. Please check the wiring when you have a moment.',
  },
};

function hasReadings(): boolean {
  return db.prepare('SELECT 1 FROM readings LIMIT 1').get() !== undefined;
}

function seedIfNeeded(): void {
  if (getAlertConfig() === null) setAlertConfig(DEFAULT_ALERT_CONFIG);
}

if (mongoEnabled) {
  // Rehydrate the local SQLite from Atlas FIRST (raw writers don't re-mirror),
  // then seed defaults only if Mongo had no config either. Best-effort on boot.
  void hydrateInto({
    hasReadings,
    insertReadingRaw: (r) => insertReadingLocal(r as SensorReading),
    insertAlarmRaw: insertAlarmLocal,
    setKvRaw: setKvLocal,
  }).then(seedIfNeeded);
} else {
  seedIfNeeded();
}
