/**
 * Shared API types.
 *
 * The GET shapes here mirror the frontend's `src/api.ts` contract exactly, so the
 * dashboard consumes this backend with no changes. The ingest + control shapes are
 * the Pi <-> cloud contract.
 */

export type SensorId = 'nh3' | 'ph' | 'temp';

// ---- Frontend-facing read models (must match nh3-web_monitoring/src/api.ts) ----

export interface SensorReading {
  id: SensorId;
  value: number;
  ts: string; // ISO 8601
  raw?: string;
}

export interface SensorHistoryPoint {
  ts: string;
  value: number;
}

export type Severity = 'INFO' | 'WARN' | 'CRIT' | 'OK';

export interface AlarmEntry {
  id: string;
  ts: string;
  severity: Severity;
  source: string;
  msg: string;
  acknowledged: boolean;
}

export interface GatewayStatus {
  ip: string;
  connected: boolean;
  uptimePct: number;
  pktLossPct: number;
  heapPct: number;
  lastRxSec: number;
  fw: string;
}

export interface Recipient {
  id: string;
  name: string;
  phone: string;
  enabled: boolean;
}

export type AlertKey =
  | 'nh3.warn'
  | 'nh3.crit'
  | 'ph.warn'
  | 'ph.crit'
  | 'temp.warn'
  | 'temp.crit'
  | 'sensor.offline';

export interface AlertConfig {
  enabled: boolean;
  cooldownSec: number;
  recipients: Recipient[];
  templates: Record<AlertKey, string>;
}

// ---- Pi -> Cloud ingest contract ----
// Mirrors nh3-web_monitoring/src/types/sensors.ts (the Pi's sensor payload),
// plus the actuator state the Pi reports back for the hybrid control loop.

export interface IngestPayload {
  nh3: { raw: number; voltage: number; timestamp?: string };
  ph: { voltage: number; pH: number; timestamp?: string };
  waterTemp: { tempC: number; tempF: number; timestamp?: string };
  /** Actuator state the Pi currently has applied (for reconciliation). */
  actuators?: Partial<ActuatorState>;
  /** Pi metadata for the gateway status panel. */
  gateway?: { fw?: string; heapPct?: number; ip?: string };
}

/**
 * Per-condition alarm state, persisted so SMS is edge-triggered (fires once on
 * entry, not every frame) and survives a backend restart.
 */
export type AlertState = Record<
  string,
  { active: boolean; since: string; lastSmsTs?: number }
>;

/**
 * Persisted SMS rationing state so the per-key cooldown and the per-day cap
 * survive a backend restart (previously these lived only in memory).
 */
export interface SmsState {
  lastSent: Partial<Record<AlertKey, number>>;
  dailyDay: string; // ISO date (YYYY-MM-DD)
  dailyCount: number;
}

// ---- Cloud -> Pi control contract (hybrid model) ----

export interface ActuatorState {
  pump: 'on' | 'off';
  valve: 'open' | 'closed';
}

export type ControlMode = 'auto' | 'manual';

/** The desired actuator state the cloud wants the Pi to apply. */
export interface ControlState extends ActuatorState {
  mode: ControlMode;
  reason: string;
  /**
   * Safety: the Pi must NOT keep the pump/valve active longer than this many
   * seconds without a fresh command. The Pi enforces this locally (fallback).
   */
  maxRuntimeSec: number;
  ts: string;
}
