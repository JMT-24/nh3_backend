import type { NextFunction, Request, Response } from 'express';
import { Router } from 'express';
import { config } from '../config.js';
import { getAlertConfig, setAlertConfig } from '../db.js';
import { requireApiKey } from '../middleware/auth.js';
import { sendTestSms } from '../services/sms.js';
import { alertConfigSchema } from '../validation.js';

export const alertsRouter = Router();

const PHONE_RE = /^\+?\d[\d\s-]{6,}$/;

// The test-SMS endpoint normally needs the x-api-key. When the (default-off)
// ENABLE_TEST_SMS_BUTTON flag is set, we skip it so a temporary frontend button
// can call it without exposing the secret in the browser.
function testSmsAuth(req: Request, res: Response, next: NextFunction): void {
  if (config.enableTestSmsButton) {
    next();
    return;
  }
  requireApiKey(req, res, next);
}

// POST /api/alerts/test  — send a one-off test SMS.
alertsRouter.post('/test', testSmsAuth, async (req, res) => {
  const phone = String(req.body?.phone ?? '').trim();
  if (!PHONE_RE.test(phone)) {
    res.status(400).json({ ok: false, error: 'invalid phone' });
    return;
  }
  const content = req.body?.content ? String(req.body.content) : undefined;
  const senderId = req.body?.senderId ? String(req.body.senderId).trim() : undefined;
  try {
    const r = await sendTestSms(phone, content, senderId);
    res.json({ ok: true, provider: r.provider, to: phone });
  } catch (e) {
    res.status(502).json({ ok: false, error: (e as Error).message });
  }
});

// GET /api/alerts/config
alertsRouter.get('/config', (_req, res) => {
  res.json(getAlertConfig());
});

// PUT /api/alerts/config
alertsRouter.put('/config', (req, res) => {
  const parsed = alertConfigSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'invalid config', details: parsed.error.flatten() });
    return;
  }
  setAlertConfig(parsed.data);
  res.json({ ok: true });
});
