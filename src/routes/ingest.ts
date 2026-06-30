import { Router } from 'express';
import { insertReading } from '../db.js';
import { requireApiKey } from '../middleware/auth.js';
import { recordIngest } from '../services/gateway.js';
import { evaluateIngest, toReadings } from '../services/rules.js';
import { ingestBatchSchema, ingestSchema } from '../validation.js';

export const ingestRouter = Router();

/**
 * POST /api/ingest  (Pi -> Cloud, requires x-api-key)
 *
 * The Pi posts a sensor frame; we persist + evaluate it and echo back the
 * desired actuator state so the Pi can reconcile in the same round-trip.
 */
ingestRouter.post('/', requireApiKey, async (req, res) => {
  const parsed = ingestSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'invalid payload', details: parsed.error.flatten() });
    return;
  }
  const now = Date.now();
  recordIngest(parsed.data, now);
  const result = await evaluateIngest(parsed.data, now);
  res.json({ ok: true, command: result.control });
});

/**
 * POST /api/ingest/batch  (Pi -> Cloud, requires x-api-key)
 *
 * Backfill of frames the Pi buffered locally during an internet outage. These
 * are HISTORY: we persist the readings (so the charts fill in) but deliberately
 * skip the rules engine, control loop, SMS, and live broadcast — acting on
 * stale ammonia values could fire the pump or text the operator after the fact.
 */
ingestRouter.post('/batch', requireApiKey, (req, res) => {
  const parsed = ingestBatchSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'invalid payload', details: parsed.error.flatten() });
    return;
  }
  let stored = 0;
  for (const frame of parsed.data.frames) {
    for (const r of toReadings(frame, frame.ts)) {
      insertReading(r);
      stored++;
    }
  }
  res.json({ ok: true, stored });
});
