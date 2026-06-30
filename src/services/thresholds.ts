/**
 * Default alarm thresholds, derived from the frontend gauge zones
 * (nh3-web_monitoring/src/pages/DashboardPage.tsx).
 *
 * NH3 is read as a voltage (MQ137); higher voltage == more ammonia.
 * pH and temp have both a low and high danger side.
 */
// `*Clear` values are the hysteresis deadband: once a condition is active it
// stays active until the reading recovers past the clear point, so a value
// hovering at the threshold can't flap and re-send SMS.
export const THRESHOLDS = {
  nh3: {
    unit: 'V',
    warn: 0.4, // approaching
    warnClear: 0.38,
    crit: 0.5, // exceed -> refill/dilute
    critClear: 0.47,
  },
  ph: {
    unit: 'pH',
    safeLow: 6.5,
    safeHigh: 8.5,
    clearLow: 6.6, // must climb back to here to clear a low-pH alarm
    clearHigh: 8.4, // must fall back to here to clear a high-pH alarm
  },
  temp: {
    unit: 'C',
    warnLow: 24, // below comfort band
    warnClear: 24.5,
    critHigh: 32, // overheating
    critClear: 31.5,
  },
} as const;

/** How long (seconds) a sensor can be silent before we raise sensor.offline. */
export const SENSOR_OFFLINE_AFTER_SEC = 120;

/** DS18B20 disconnect sentinel (matches the frontend constant). */
export const DS18B20_DISCONNECTED_C = -127;
