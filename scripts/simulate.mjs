/**
 * Pi simulator — posts sample sensor frames to the backend so you can watch the
 * dashboard react (ammonia ramps across the threshold → alarms + auto-refill).
 *
 * Usage:  node scripts/simulate.mjs
 * Env:    PORT (default 4000), INGEST_API_KEY (default matches .env.example),
 *         SIM_INTERVAL_MS (default 2000)
 */
const PORT = process.env.PORT ?? 4000;
const BASE = process.env.SIM_BASE ?? `http://localhost:${PORT}`;
const API_KEY = process.env.INGEST_API_KEY ?? 'change-me-to-a-long-random-string';
const INTERVAL = Number(process.env.SIM_INTERVAL_MS ?? 2000);

let t = 0;

function frame() {
  // NH3 voltage: triangle wave 0.34 -> 0.58 -> 0.34 so it crosses warn(0.40)/crit(0.50).
  const phase = (t % 40) / 40; // 0..1 over 40 steps
  const tri = phase < 0.5 ? phase * 2 : (1 - phase) * 2; // 0..1..0
  const nh3V = +(0.34 + tri * 0.24).toFixed(3);
  const nh3Raw = Math.round(nh3V * 1023);

  // pH wobbles around 7.2; occasionally dips toward the low edge.
  const pH = +(7.2 + Math.sin(t / 5) * 0.25).toFixed(2);
  const phVoltage = +(2.5 - (pH - 7) * 0.18).toFixed(3);

  // Water temp drifts 27–29 °C.
  const tempC = +(28 + Math.sin(t / 8) * 1.1).toFixed(1);
  const tempF = +((tempC * 9) / 5 + 32).toFixed(1);

  return {
    nh3: { raw: nh3Raw, voltage: nh3V },
    ph: { voltage: phVoltage, pH },
    waterTemp: { tempC, tempF },
    gateway: { fw: 'sim-0.1', heapPct: 42, ip: '127.0.0.1' },
  };
}

async function tick() {
  const body = frame();
  try {
    const res = await fetch(`${BASE}/api/ingest`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': API_KEY },
      body: JSON.stringify(body),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      console.error(`[sim] HTTP ${res.status}`, json);
    } else {
      const cmd = json.command ?? {};
      console.log(
        `[sim] NH3=${body.nh3.voltage}V pH=${body.ph.pH} T=${body.waterTemp.tempC}°C ` +
          `→ pump=${cmd.pump} valve=${cmd.valve}`,
      );
    }
  } catch (e) {
    console.error('[sim] request failed — is the backend running?', e.message);
  }
  t += 1;
}

console.log(`[sim] posting to ${BASE}/api/ingest every ${INTERVAL}ms (Ctrl+C to stop)`);
tick();
setInterval(tick, INTERVAL);
