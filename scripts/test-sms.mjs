/**
 * Send a test SMS through the running backend.
 *
 * Usage:  node scripts/test-sms.mjs +639XXXXXXXXX
 * Env:    PORT (default 4000), INGEST_API_KEY (default matches .env.example)
 *
 * In stub mode this just logs on the server (free). With a real provider key in
 * .env, it actually sends to the given number.
 */
const phone = process.argv[2] ?? process.env.TEST_PHONE;
if (!phone) {
  console.error('Usage: node scripts/test-sms.mjs +639XXXXXXXXX');
  process.exit(1);
}

const PORT = process.env.PORT ?? 4000;
const KEY = process.env.INGEST_API_KEY ?? 'change-me-to-a-long-random-string';

const res = await fetch(`http://localhost:${PORT}/api/alerts/test`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', 'x-api-key': KEY, Connection: 'close' },
  body: JSON.stringify({ phone }),
});

const text = await res.text();
console.log(`HTTP ${res.status}: ${text}`);
// Set the exit code and let the process drain naturally — calling process.exit()
// here can trip a libuv assertion on Windows while fetch's socket is closing.
process.exitCode = res.ok ? 0 : 1;
