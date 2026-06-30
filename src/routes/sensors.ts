import { Router } from 'express';
import { latestReadings, sensorHistory } from '../db.js';
import { rangeSchema, sensorIdSchema } from '../validation.js';

export const sensorsRouter = Router();

// GET /api/sensors/latest
sensorsRouter.get('/latest', (_req, res) => {
  res.json(latestReadings());
});

// GET /api/sensors/:id/history?range=1H|6H|24H|7D
sensorsRouter.get('/:id/history', (req, res) => {
  const id = sensorIdSchema.safeParse(req.params.id);
  if (!id.success) {
    res.status(400).json({ error: 'invalid sensor id' });
    return;
  }
  const range = rangeSchema.safeParse(req.query.range ?? '24H');
  if (!range.success) {
    res.status(400).json({ error: 'invalid range' });
    return;
  }
  res.json(sensorHistory(id.data, range.data, Date.now()));
});
