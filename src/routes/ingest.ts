import { Router } from 'express';
import { requireApiKey } from '../middleware/auth.js';
import { recordIngest } from '../services/gateway.js';
import { evaluateIngest } from '../services/rules.js';
import { ingestSchema } from '../validation.js';

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
