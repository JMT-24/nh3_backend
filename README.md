# nh3-backend

Cloud backend for the **aquarium automatic refill system**. It ingests sensor
frames from a Raspberry Pi, stores history, raises alarms, sends SMS alerts via
**UniSMS**, and drives the relay (water pump + solenoid valve) for automatic
ammonia dilution — using a **hybrid** control model where the Pi keeps a local
safety fallback but normally obeys commands from the cloud.

```
Pi (sensors + relay)  ──POST /api/ingest (x-api-key)──▶  Cloud (this)  ◀──HTTP/WS──  React dashboard
        ▲                                                  │ Express + SQLite
        └────────────── command (desired actuator state) ──┘ rules engine + UniSMS
```

## Stack

- **Express** REST API (mirrors the frontend's `src/api.ts` contract exactly)
- **better-sqlite3** for readings / alarms / config (single file under `./data`)
- **ws** WebSocket at `/ws` for live push to the dashboard
- **zod** request validation · **unisms** SMS · **helmet** + CORS

## Setup

```bash
npm install
cp .env.example .env      # then edit .env (set INGEST_API_KEY, UniSMS keys)
npm run dev               # tsx watch, hot-reload
# or: npm run build && npm start
```

Without UniSMS credentials the SMS layer runs a **stub** that logs messages
instead of sending — so you can develop the whole flow before wiring real SMS.

## Environment

| Var | Purpose |
|---|---|
| `PORT` | HTTP port (default 4000) |
| `ALLOWED_ORIGINS` | comma-separated CORS allowlist (frontend URLs) |
| `INGEST_API_KEY` | shared secret the Pi sends as `x-api-key` |
| `DB_PATH` | SQLite file path (default `./data/nh3.db`) |
| `UNISMS_ACCESS_KEY_ID` / `UNISMS_ACCESS_KEY_SECRET` | UniSMS credentials (blank → stub) |
| `UNISMS_SIGNATURE` / `UNISMS_TEMPLATE_ID` | UniSMS sender signature / optional template |

## API

### Frontend-facing (consumed by `nh3-web_monitoring`)
| Method | Path | |
|---|---|---|
| GET | `/api/sensors/latest` | latest NH₃/pH/temp readings |
| GET | `/api/sensors/:id/history?range=1H\|6H\|24H\|7D` | time-series |
| GET | `/api/alarms` | alarm log (latest 200) |
| POST | `/api/alarms/:id/ack`, `/api/alarms/ack-all` | acknowledge |
| GET | `/api/gateway/status` | Pi connectivity/health |
| GET·PUT | `/api/alerts/config` | SMS recipients + templates |
| GET | `/api/control/state` | current desired actuator state |
| POST | `/api/control/manual` | operator override (TODO: add auth) |

### Pi-facing (require `x-api-key`)
| Method | Path | |
|---|---|---|
| POST | `/api/ingest` | sensor frame; response echoes the desired `command` |

### WebSocket
Connect to `/ws`; receive `{type: 'readings'|'alarm'|'control'|'gateway', data}`.

## Ingest payload (Pi → cloud)

```jsonc
{
  "nh3":      { "raw": 640, "voltage": 0.62 },
  "ph":       { "voltage": 2.52, "pH": 7.2 },
  "waterTemp":{ "tempC": 27.8, "tempF": 82.0 },
  "actuators":{ "pump": "off", "valve": "closed" },   // optional: Pi's applied state
  "gateway":  { "fw": "0.4.1", "heapPct": 38, "ip": "..." } // optional
}
```

Response:
```jsonc
{ "ok": true, "command": { "mode": "auto", "pump": "on", "valve": "open",
                           "reason": "Auto-dilute: NH3 0.62 V", "maxRuntimeSec": 120, "ts": "..." } }
```

## Control logic (refill)

- **Trigger:** ammonia (NH₃ voltage). Start diluting at `≥ 0.50 V`, stop once back
  under `0.40 V` (hysteresis). Thresholds in `src/services/thresholds.ts`.
- **Hybrid safety:** every command carries `maxRuntimeSec`; the **Pi must force
  the pump/valve off** if it doesn't get a fresh command within that window.
- **Manual override:** `POST /api/control/manual {mode:'manual', pump, valve}`
  pins the actuators; `{mode:'auto'}` hands control back to the rules engine.

## Project layout

```
src/
  index.ts            entry — express app, routes, WebSocket
  config.ts           env loading
  db.ts               sqlite schema + accessors (+ first-run seed)
  types.ts            shared API + ingest/control contracts
  validation.ts       zod schemas
  ws.ts               WebSocket broadcast
  middleware/auth.ts  x-api-key guard
  routes/             sensors, alarms, gateway, alerts, ingest, control
  services/
    rules.ts          evaluate ingest → alarms + refill decision
    thresholds.ts     alarm/refill thresholds (from frontend gauge zones)
    sms.ts            dispatch + cooldown + template render
    providers.ts      UniSMS adapter (+ logging stub)
    gateway.ts        connectivity/health tracker
```
