import 'dotenv/config';

function required(name: string, fallback?: string): string {
  const v = process.env[name] ?? fallback;
  if (v === undefined || v === '') {
    throw new Error(`Missing required env var: ${name}`);
  }
  return v;
}

export const config = {
  port: Number(process.env.PORT ?? 4000),
  allowedOrigins: (process.env.ALLOWED_ORIGINS ?? 'http://localhost:5173')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean),
  ingestApiKey: required('INGEST_API_KEY', 'change-me-to-a-long-random-string'),
  dbPath: process.env.DB_PATH ?? './data/nh3.db',
  // Optional override: 'unismsapi' | 'unisms' | 'stub'. Blank = auto-detect by key.
  smsProvider: (process.env.SMS_PROVIDER ?? '').toLowerCase(),
  // TEMPORARY: when true, POST /api/alerts/test needs no x-api-key, so a frontend
  // button can trigger it. Keep OFF (default) in production. Local testing only.
  enableTestSmsButton: process.env.ENABLE_TEST_SMS_BUTTON === 'true',
  // Re-text the operator if a critical condition is STILL active this many
  // seconds after the last text. 0 = never re-notify (default; most frugal).
  smsRenotifySec: Math.max(0, Number(process.env.SMS_RENOTIFY_SEC ?? 0)),
  // Hard ceiling on SMS sent per calendar day (cost backstop). 0 = unlimited.
  smsDailyCap: Math.max(0, Number(process.env.SMS_DAILY_CAP ?? 50)),
  // unismsapi.com — the Philippine-focused service (POST + basic auth).
  unismsapi: {
    key: process.env.UNISMSAPI_KEY ?? '',
    sender: process.env.UNISMSAPI_SENDER ?? '',
  },
  // unisms.apistd.com — the China-based aggregator (signature/template based).
  unisms: {
    accessKeyId: process.env.UNISMS_ACCESS_KEY_ID ?? '',
    accessKeySecret: process.env.UNISMS_ACCESS_KEY_SECRET ?? '',
    signature: process.env.UNISMS_SIGNATURE ?? 'UniSMS',
    templateId: process.env.UNISMS_TEMPLATE_ID ?? '',
  },
} as const;
