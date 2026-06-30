import type { GatewayStatus, IngestPayload } from '../types.js';
import { SENSOR_OFFLINE_AFTER_SEC } from './thresholds.js';

/** In-memory connectivity/health state for the Pi gateway, updated on each ingest. */
let state = {
  ip: '—',
  fw: 'unknown',
  heapPct: 0,
  lastRxMs: 0,
  rxCount: 0,
  bootMs: Date.now(),
};

export function recordIngest(p: IngestPayload, nowMs: number): void {
  state.lastRxMs = nowMs;
  state.rxCount += 1;
  if (p.gateway?.ip) state.ip = p.gateway.ip;
  if (p.gateway?.fw) state.fw = p.gateway.fw;
  if (typeof p.gateway?.heapPct === 'number') state.heapPct = p.gateway.heapPct;
}

export function gatewayStatus(nowMs: number): GatewayStatus {
  const lastRxSec = state.lastRxMs ? Math.round((nowMs - state.lastRxMs) / 1000) : 9999;
  const connected = state.lastRxMs > 0 && lastRxSec < SENSOR_OFFLINE_AFTER_SEC;
  const uptimeMin = (nowMs - state.bootMs) / 60000;
  return {
    ip: state.ip,
    connected,
    uptimePct: connected ? 100 : 0,
    pktLossPct: 0,
    heapPct: state.heapPct,
    lastRxSec,
    fw: state.fw,
  };
}
