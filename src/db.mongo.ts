/**
 * Durable MongoDB mirror (DORMANT until MONGODB_URI is set).
 *
 * Architecture: SQLite stays the fast, synchronous local working set. Every
 * write is also queued here and flushed to MongoDB Atlas in the background, and
 * on boot an EMPTY SQLite is rehydrated from Mongo. That makes the cloud store
 * survive a Railway redeploy (ephemeral disk) without turning the whole data
 * layer async.
 *
 * `mongodb` is imported DYNAMICALLY so the backend still builds and runs with
 * the package uninstalled and the feature off. To enable:
 *     npm i mongodb            # add the driver
 *     MONGODB_URI=...          # in .env
 */

import { config } from './config.js';

export const mongoEnabled = config.mongoUri !== '';

type Op =
  | { kind: 'reading'; doc: Record<string, unknown> }
  | { kind: 'alarm'; doc: Record<string, unknown> & { id: string } }
  | { kind: 'ack'; id: string }
  | { kind: 'ackAll' }
  | { kind: 'kv'; key: string; value: string };

const queue: Op[] = [];

// Loosely typed to avoid a hard compile-time dependency on @types/mongodb.
let collections: { readings: any; alarms: any; kv: any } | null = null;
let connecting = false;

async function connect(): Promise<void> {
  if (collections || connecting || !mongoEnabled) return;
  connecting = true;
  try {
    // Non-literal specifier so tsc doesn't require 'mongodb' to be installed
    // when the feature is off; resolved at runtime once you `npm i mongodb`.
    const driver = 'mongodb';
    const { MongoClient } = await import(driver);
    const client = new MongoClient(config.mongoUri);
    await client.connect();
    const dbh = client.db(config.mongoDb);
    collections = { readings: dbh.collection('readings'), alarms: dbh.collection('alarms'), kv: dbh.collection('kv') };
    console.log(`[mongo] connected (db: ${config.mongoDb}) — mirroring enabled`);
    void flush();
  } catch (e) {
    console.error('[mongo] connect failed — staying on local SQLite only:', e);
    // Leave disabled; queued ops simply never flush this run.
  } finally {
    connecting = false;
  }
}

async function flush(): Promise<void> {
  if (!collections) return;
  while (queue.length) {
    const op = queue.shift()!;
    try {
      if (op.kind === 'reading') await collections.readings.insertOne(op.doc);
      else if (op.kind === 'alarm') await collections.alarms.updateOne({ _id: op.doc.id }, { $set: op.doc }, { upsert: true });
      else if (op.kind === 'ack') await collections.alarms.updateOne({ _id: op.id }, { $set: { acknowledged: true } });
      else if (op.kind === 'ackAll') await collections.alarms.updateMany({ acknowledged: false }, { $set: { acknowledged: true } });
      else if (op.kind === 'kv') await collections.kv.updateOne({ _id: op.key }, { $set: { value: op.value } }, { upsert: true });
    } catch (e) {
      console.error('[mongo] flush op failed (dropping):', op.kind, e);
    }
  }
}

function enqueue(op: Op): void {
  if (!mongoEnabled) return;
  queue.push(op);
  if (collections) void flush();
  else void connect();
}

// ---- mirror hooks called by db.ts after each successful local write ----
export const mirror = {
  reading: (r: { id: string; value: number; raw?: string; ts: string }) =>
    enqueue({ kind: 'reading', doc: { sensor: r.id, value: r.value, raw: r.raw ?? null, ts: r.ts } }),
  alarm: (a: Record<string, unknown> & { id: string }) => enqueue({ kind: 'alarm', doc: a }),
  ack: (id: string) => enqueue({ kind: 'ack', id }),
  ackAll: () => enqueue({ kind: 'ackAll' }),
  kv: (key: string, value: string) => enqueue({ kind: 'kv', key, value }),
};

/**
 * Boot-time rehydration. If SQLite has no readings yet (fresh disk) and Mongo
 * has data, copy it down via the supplied RAW writers (which must NOT re-mirror).
 */
export async function hydrateInto(h: {
  hasReadings: () => boolean;
  insertReadingRaw: (r: { id: string; value: number; raw?: string; ts: string }) => void;
  insertAlarmRaw: (a: any) => void;
  setKvRaw: (key: string, value: string) => void;
}): Promise<void> {
  if (!mongoEnabled) return;
  await connect();
  if (!collections) return;
  try {
    if (h.hasReadings()) {
      console.log('[mongo] local SQLite already has readings — skipping rehydrate');
    } else {
      const readings = await collections.readings.find({}).sort({ ts: 1 }).toArray();
      for (const d of readings) h.insertReadingRaw({ id: d.sensor, value: d.value, raw: d.raw ?? undefined, ts: d.ts });
      const alarms = await collections.alarms.find({}).toArray();
      for (const a of alarms) h.insertAlarmRaw({ id: a.id, ts: a.ts, severity: a.severity, source: a.source, msg: a.msg, acknowledged: !!a.acknowledged });
      console.log(`[mongo] rehydrated ${readings.length} readings + ${alarms.length} alarms from Atlas`);
    }
    const kv = await collections.kv.find({}).toArray();
    for (const row of kv) h.setKvRaw(row._id, row.value);
  } catch (e) {
    console.error('[mongo] rehydrate failed:', e);
  }
}
