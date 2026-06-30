import { Router } from 'express';
import { ackAlarm, ackAllAlarms, listAlarms } from '../db.js';

export const alarmsRouter = Router();

// GET /api/alarms
alarmsRouter.get('/', (_req, res) => {
  res.json(listAlarms());
});

// POST /api/alarms/ack-all  (declared before :id so it isn't captured as an id)
alarmsRouter.post('/ack-all', (_req, res) => {
  const changed = ackAllAlarms();
  res.json({ ok: true, changed });
});

// POST /api/alarms/:id/ack
alarmsRouter.post('/:id/ack', (req, res) => {
  const ok = ackAlarm(req.params.id);
  res.status(ok ? 200 : 404).json({ ok });
});
