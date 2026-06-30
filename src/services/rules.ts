import { randomUUID } from 'node:crypto';
import { config } from '../config.js';
import {
  getAlertState,
  getControlState,
  insertAlarm,
  insertReading,
  setAlertState,
  setControlState,
} from '../db.js';
import type {
  AlarmEntry,
  AlertKey,
  AlertState,
  ControlState,
  IngestPayload,
  SensorReading,
  Severity,
} from '../types.js';
import { broadcast } from '../ws.js';
import { dispatchAlert, type AlertContext } from './sms.js';
import { DS18B20_DISCONNECTED_C, THRESHOLDS } from './thresholds.js';

const { nh3: NH3, ph: PH, temp: TEMP } = THRESHOLDS;

/** Refill actuator safety limits (hybrid: the Pi enforces maxRuntimeSec). */
const REFILL = {
  startV: NH3.crit,
  stopV: NH3.warn,
  maxRuntimeSec: 120,
};

function mkAlarm(severity: Severity, source: string, msg: string, nowMs: number): AlarmEntry {
  return {
    id: randomUUID(),
    ts: new Date(nowMs).toISOString(),
    severity,
    source,
    msg,
    acknowledged: false,
  };
}

/** Convert the Pi ingest payload into the 3 frontend-facing readings. */
export function toReadings(p: IngestPayload, ts: string): SensorReading[] {
  return [
    { id: 'nh3', value: p.nh3.voltage, ts, raw: `RAW=${p.nh3.raw}` },
    { id: 'ph', value: p.ph.pH, ts, raw: `V=${p.ph.voltage.toFixed(3)}` },
    { id: 'temp', value: p.waterTemp.tempC, ts, raw: `F=${p.waterTemp.tempF.toFixed(1)}` },
  ];
}

/**
 * A monitored condition. `enter`/`clear` form a hysteresis pair: the condition
 * activates when `enter` is true and only deactivates when `clear` is true.
 * `sms: true` means an activation texts the operator (rationed); warnings and
 * recoveries are dashboard-only.
 */
interface Condition {
  key: string;
  alertKey: AlertKey;
  severity: Severity;
  source: string;
  sms: boolean;
  enter: (p: IngestPayload) => boolean;
  clear: (p: IngestPayload) => boolean;
  onMsg: (p: IngestPayload) => string;
  offMsg?: (p: IngestPayload) => string;
  ctx: (p: IngestPayload) => AlertContext;
}

const phSafe = `${PH.safeLow} - ${PH.safeHigh}`;

const CONDITIONS: Condition[] = [
  // --- Ammonia: the only sensor that drives the refill, and the key alert ---
  {
    key: 'nh3.crit',
    alertKey: 'nh3.crit',
    severity: 'CRIT',
    source: 'NH3',
    sms: true,
    enter: (p) => p.nh3.voltage >= NH3.crit,
    clear: (p) => p.nh3.voltage < NH3.critClear,
    onMsg: (p) => `Ammonia ${p.nh3.voltage.toFixed(2)} V exceeded ${NH3.crit} V`,
    offMsg: (p) => `Ammonia back under control (${p.nh3.voltage.toFixed(2)} V)`,
    ctx: (p) => ({ value: p.nh3.voltage.toFixed(2), unit: 'V', threshold: NH3.crit }),
  },
  {
    key: 'nh3.warn',
    alertKey: 'nh3.warn',
    severity: 'WARN',
    source: 'NH3',
    sms: false, // dashboard only
    enter: (p) => p.nh3.voltage >= NH3.warn && p.nh3.voltage < NH3.crit,
    clear: (p) => p.nh3.voltage < NH3.warnClear || p.nh3.voltage >= NH3.crit,
    onMsg: (p) => `Ammonia ${p.nh3.voltage.toFixed(2)} V approaching ${NH3.crit} V`,
    ctx: (p) => ({ value: p.nh3.voltage.toFixed(2), unit: 'V', threshold: NH3.crit }),
  },
  // --- pH: dangerous on both sides ---
  {
    key: 'ph.crit',
    alertKey: 'ph.crit',
    severity: 'CRIT',
    source: 'pH',
    sms: true,
    enter: (p) => p.ph.pH < PH.safeLow || p.ph.pH > PH.safeHigh,
    clear: (p) => p.ph.pH >= PH.clearLow && p.ph.pH <= PH.clearHigh,
    onMsg: (p) => `pH ${p.ph.pH.toFixed(2)} outside safe range ${phSafe}`,
    offMsg: (p) => `pH back in range (${p.ph.pH.toFixed(2)})`,
    ctx: (p) => ({ value: p.ph.pH.toFixed(2), safe: phSafe }),
  },
  // --- Water temperature ---
  {
    key: 'temp.crit',
    alertKey: 'temp.crit',
    severity: 'CRIT',
    source: 'TEMP',
    sms: true,
    // Ignore the disconnect sentinel here; sensor.offline handles that.
    enter: (p) => p.waterTemp.tempC !== DS18B20_DISCONNECTED_C && p.waterTemp.tempC >= TEMP.critHigh,
    clear: (p) => p.waterTemp.tempC < TEMP.critClear,
    onMsg: (p) => `Water temp ${p.waterTemp.tempC.toFixed(1)} C past ${TEMP.critHigh} C`,
    offMsg: (p) => `Water temp back to safe (${p.waterTemp.tempC.toFixed(1)} C)`,
    ctx: (p) => ({ value: p.waterTemp.tempC.toFixed(1), threshold: TEMP.critHigh }),
  },
  {
    key: 'temp.warn',
    alertKey: 'temp.warn',
    severity: 'WARN',
    source: 'TEMP',
    sms: false, // dashboard only
    enter: (p) => p.waterTemp.tempC !== DS18B20_DISCONNECTED_C && p.waterTemp.tempC < TEMP.warnLow,
    clear: (p) => p.waterTemp.tempC >= TEMP.warnClear,
    onMsg: (p) => `Water temp ${p.waterTemp.tempC.toFixed(1)} C below comfort band`,
    ctx: (p) => ({ value: p.waterTemp.tempC.toFixed(1), safe: `${TEMP.warnLow} - ${TEMP.critHigh} C` }),
  },
  // --- Sensor health ---
  {
    key: 'sensor.offline',
    alertKey: 'sensor.offline',
    severity: 'CRIT',
    source: 'TEMP',
    sms: true,
    enter: (p) => p.waterTemp.tempC === DS18B20_DISCONNECTED_C,
    clear: (p) => p.waterTemp.tempC !== DS18B20_DISCONNECTED_C,
    onMsg: () => `Temp sensor disconnected (returned ${DS18B20_DISCONNECTED_C} C)`,
    offMsg: () => `Temp sensor reconnected`,
    ctx: () => ({ sensor: 'temperature' }),
  },
];

export interface EvalResult {
  readings: SensorReading[];
  alarms: AlarmEntry[];
  control: ControlState;
}

/**
 * Persist a fresh ingest frame, then run the edge-triggered condition machine:
 * an alarm is logged (and, for critical conditions, an SMS sent) only on the
 * transition into a state — never on every frame. Recoveries log to the
 * dashboard but never text. Finally compute the desired refill actuator state.
 */
export async function evaluateIngest(p: IngestPayload, nowMs: number): Promise<EvalResult> {
  const ts = new Date(nowMs).toISOString();
  const readings = toReadings(p, ts);
  for (const r of readings) insertReading(r);

  const state: AlertState = getAlertState();
  const alarms: AlarmEntry[] = [];

  for (const c of CONDITIONS) {
    const prev = state[c.key];
    const wasActive = prev?.active ?? false;
    const nowActive = wasActive ? !c.clear(p) : c.enter(p);

    if (nowActive && !wasActive) {
      // Rising edge: log + (maybe) text once.
      const a = mkAlarm(c.severity, c.source, c.onMsg(p), nowMs);
      alarms.push(a);
      insertAlarm(a);
      let lastSmsTs = prev?.lastSmsTs;
      if (c.sms) {
        const sent = await dispatchAlert(c.alertKey, c.ctx(p), nowMs);
        if (sent > 0) lastSmsTs = nowMs;
      }
      state[c.key] = { active: true, since: ts, lastSmsTs };
    } else if (nowActive && wasActive) {
      // Still active: optional re-notify for a long-running critical condition.
      if (
        c.sms &&
        config.smsRenotifySec > 0 &&
        (!prev?.lastSmsTs || nowMs - prev.lastSmsTs >= config.smsRenotifySec * 1000)
      ) {
        const sent = await dispatchAlert(c.alertKey, c.ctx(p), nowMs);
        state[c.key] = { active: true, since: prev?.since ?? ts, lastSmsTs: sent > 0 ? nowMs : prev?.lastSmsTs };
      }
    } else if (!nowActive && wasActive) {
      // Falling edge: log recovery to the dashboard only (no SMS).
      if (c.offMsg) {
        const a = mkAlarm('OK', c.source, c.offMsg(p), nowMs);
        alarms.push(a);
        insertAlarm(a);
      }
      state[c.key] = { active: false, since: ts };
    }
  }

  setAlertState(state);

  const control = updateControl(p, nowMs, ts, alarms);

  // Live push to dashboards.
  broadcast({ type: 'readings', data: readings });
  if (alarms.length) broadcast({ type: 'alarm', data: alarms });
  broadcast({ type: 'control', data: control });

  return { readings, alarms, control };
}

/** Automatic ammonia-dilution control (skipped under manual override). */
function updateControl(
  p: IngestPayload,
  nowMs: number,
  ts: string,
  alarms: AlarmEntry[],
): ControlState {
  const prev = getControlState();
  if (prev?.mode === 'manual') return prev;

  const nh3 = p.nh3.voltage;
  const refilling = prev?.pump === 'on';
  const shouldRefill = refilling ? nh3 > REFILL.stopV : nh3 >= REFILL.startV;

  const control: ControlState = {
    mode: 'auto',
    pump: shouldRefill ? 'on' : 'off',
    valve: shouldRefill ? 'open' : 'closed',
    reason: shouldRefill ? `Auto-dilute: NH3 ${nh3.toFixed(2)} V` : `Nominal: NH3 ${nh3.toFixed(2)} V`,
    maxRuntimeSec: REFILL.maxRuntimeSec,
    ts,
  };

  const changed = !prev || prev.pump !== control.pump || prev.valve !== control.valve;
  setControlState(control);
  if (changed) {
    // Dashboard-only note; the ammonia SMS already covers the operator alert.
    if (control.pump === 'on') {
      const a = mkAlarm('WARN', 'CTRL', `Refill started — diluting (NH3 ${nh3.toFixed(2)} V)`, nowMs);
      alarms.push(a);
      insertAlarm(a);
    } else if (prev?.pump === 'on') {
      const a = mkAlarm('OK', 'CTRL', `Refill stopped — NH3 back to ${nh3.toFixed(2)} V`, nowMs);
      alarms.push(a);
      insertAlarm(a);
    }
  }
  return control;
}
