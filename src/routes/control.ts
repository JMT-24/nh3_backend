import { Router } from 'express';
import { getControlState, setControlState } from '../db.js';
import type { ControlState } from '../types.js';
import { broadcast } from '../ws.js';
import { manualControlSchema } from '../validation.js';

export const controlRouter = Router();

const DEFAULT_STATE: ControlState = {
  mode: 'auto',
  pump: 'off',
  valve: 'closed',
  reason: 'init',
  maxRuntimeSec: 120,
  ts: new Date(0).toISOString(),
};

// GET /api/control/state  — current desired actuator state (frontend + Pi poll).
controlRouter.get('/state', (_req, res) => {
  res.json(getControlState() ?? DEFAULT_STATE);
});

// POST /api/control/manual  — operator override from the dashboard.
// TODO: add operator auth before exposing publicly.
controlRouter.post('/manual', (req, res) => {
  const parsed = manualControlSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'invalid command', details: parsed.error.flatten() });
    return;
  }
  const prev = getControlState() ?? DEFAULT_STATE;
  const body = parsed.data;

  // Switching to 'auto' hands control back to the rules engine on next ingest.
  const next: ControlState = {
    mode: body.mode,
    pump: body.mode === 'manual' ? body.pump ?? prev.pump : 'off',
    valve: body.mode === 'manual' ? body.valve ?? prev.valve : 'closed',
    reason: body.reason ?? (body.mode === 'manual' ? 'Manual override' : 'Returned to auto'),
    maxRuntimeSec: prev.maxRuntimeSec,
    ts: new Date().toISOString(),
  };
  setControlState(next);
  broadcast({ type: 'control', data: next });
  res.json({ ok: true, control: next });
});
