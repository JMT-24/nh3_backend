import { config } from '../config.js';
import { getAlertConfig, getSmsState, setSmsState } from '../db.js';
import type { AlertKey } from '../types.js';
import { smsProvider } from './providers.js';

/**
 * Send a one-off test message (used by POST /api/alerts/test). Bypasses the
 * master switch / cooldown so you can verify delivery on demand. With no real
 * provider configured, the stub just logs it.
 */
export async function sendTestSms(
  phone: string,
  message?: string,
  senderId?: string,
): Promise<{ provider: string }> {
  const msg = (message ?? '').trim() || 'Hello, this is a test message.';
  await smsProvider.send(phone, msg, { senderId });
  return { provider: smsProvider.name };
}

const PHONE_RE = /^\+?\d[\d\s-]{6,}$/;

export interface AlertContext {
  value?: number | string;
  unit?: string;
  threshold?: number | string;
  safe?: string;
  sensor?: string;
  pond?: string;
  ts?: string;
}

function render(template: string, ctx: AlertContext): string {
  return template.replace(/\{(\w+)\}/g, (_m, key: string) => {
    const v = (ctx as Record<string, unknown>)[key];
    return v === undefined || v === null ? `{${key}}` : String(v);
  });
}

/**
 * Dispatch an SMS alert for a given key, honouring the master switch, cooldown,
 * and recipient list from the saved AlertConfig. Returns how many messages were
 * queued to the provider (0 if disabled / cooling down / no recipients).
 */
export async function dispatchAlert(
  key: AlertKey,
  ctx: AlertContext,
  nowMs: number,
): Promise<number> {
  const cfg = getAlertConfig();
  if (!cfg || !cfg.enabled) return 0;

  // Cooldown + daily cap are persisted (survive a restart).
  const state = getSmsState();

  const last = state.lastSent[key];
  if (last !== undefined && nowMs - last < cfg.cooldownSec * 1000) return 0;

  const template = cfg.templates[key];
  if (!template) return 0;

  const recipients = cfg.recipients.filter(
    (r) => r.enabled && PHONE_RE.test(r.phone.trim()),
  );
  if (recipients.length === 0) return 0;

  // Roll the per-day counter over at UTC midnight.
  const day = new Date(nowMs).toISOString().slice(0, 10);
  if (state.dailyDay !== day) {
    state.dailyDay = day;
    state.dailyCount = 0;
  }
  if (config.smsDailyCap > 0 && state.dailyCount + recipients.length > config.smsDailyCap) {
    console.warn(`[sms] daily cap (${config.smsDailyCap}) reached — skipping ${key}`);
    setSmsState(state); // persist the day rollover even when capped
    return 0;
  }

  const message = render(template, { ts: new Date(nowMs).toISOString(), ...ctx });
  state.lastSent[key] = nowMs;

  let sent = 0;
  await Promise.all(
    recipients.map(async (r) => {
      try {
        await smsProvider.send(r.phone.trim(), message);
        sent += 1;
      } catch (e) {
        console.error(`[sms] failed to ${r.phone}:`, (e as Error).message);
      }
    }),
  );
  state.dailyCount += sent;
  setSmsState(state);
  return sent;
}
