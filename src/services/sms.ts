import { config } from '../config.js';
import { getAlertConfig } from '../db.js';
import type { AlertKey } from '../types.js';
import { smsProvider } from './providers.js';

/** Rolling per-day SMS counter (cost backstop). */
const dailyCount = { day: '', count: 0 };

function underDailyCap(nowMs: number, need: number): boolean {
  if (config.smsDailyCap === 0) return true;
  const day = new Date(nowMs).toISOString().slice(0, 10);
  if (dailyCount.day !== day) {
    dailyCount.day = day;
    dailyCount.count = 0;
  }
  return dailyCount.count + need <= config.smsDailyCap;
}

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

/** Last-sent timestamp (ms) per alert key, for cooldown enforcement. */
const lastSent = new Map<AlertKey, number>();

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

  const last = lastSent.get(key);
  if (last !== undefined && nowMs - last < cfg.cooldownSec * 1000) return 0;

  const template = cfg.templates[key];
  if (!template) return 0;

  const recipients = cfg.recipients.filter(
    (r) => r.enabled && PHONE_RE.test(r.phone.trim()),
  );
  if (recipients.length === 0) return 0;

  if (!underDailyCap(nowMs, recipients.length)) {
    console.warn(`[sms] daily cap (${config.smsDailyCap}) reached — skipping ${key}`);
    return 0;
  }

  const message = render(template, { ts: new Date(nowMs).toISOString(), ...ctx });
  lastSent.set(key, nowMs);

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
  dailyCount.count += sent;
  return sent;
}
