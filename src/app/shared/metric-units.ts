import { groupNumberText } from './number-format';

export type MetricUnit = 'ratio' | 'bytes' | 'durationMs' | 'humanDuration' | 'money' | 'count';

const BYTE_UNIT_SUFFIXES = ['B', 'KiB', 'MiB', 'GiB', 'TiB'];

function formatBytesValue(value: number): string {
  let current = value;
  let unitIndex = 0;
  while (Math.abs(current) >= 1024 && unitIndex < BYTE_UNIT_SUFFIXES.length - 1) {
    current /= 1024;
    unitIndex++;
  }
  return `${current.toFixed(current >= 10 || unitIndex === 0 ? 0 : 1)} ${BYTE_UNIT_SUFFIXES[unitIndex]}`;
}

// Below this, milliseconds are the readable unit ("320 мс"). At/above it, a bare
// "500 мс" reads worse than "0.5 с" — switch to seconds (one decimal place).
const DURATION_MS_TO_SECONDS_THRESHOLD_MS = 500;
// At/above this many seconds, "1 мин 1 с" reads better than "61 с".
const DURATION_SECONDS_TO_MINUTES_THRESHOLD_S = 60;

function formatDurationMsValue(valueMs: number): string {
  const sign = valueMs < 0 ? '-' : '';
  const abs = Math.abs(valueMs);

  if (abs < DURATION_MS_TO_SECONDS_THRESHOLD_MS) {
    return `${sign}${Math.round(abs)} мс`;
  }

  const seconds = Math.round(abs / 100) / 10;
  if (seconds < DURATION_SECONDS_TO_MINUTES_THRESHOLD_S) {
    return `${sign}${Number.isInteger(seconds) ? seconds : seconds.toFixed(1)} с`;
  }

  const totalSeconds = Math.round(abs / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const remainderSeconds = totalSeconds % 60;
  return remainderSeconds > 0 ? `${sign}${minutes} м ${remainderSeconds} с` : `${sign}${minutes} м`;
}

function formatHumanDurationValue(valueSeconds: number): string {
  const totalSeconds = Math.max(0, Math.floor(valueSeconds));
  const days = Math.floor(totalSeconds / 86400);
  const hours = Math.floor((totalSeconds % 86400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

function formatCountValue(value: number): string {
  const text = Number.isInteger(value) ? value.toString() : (Math.round(value * 10) / 10).toFixed(1);
  return groupNumberText(text);
}

function formatMoneyValue(value: number): string {
  return `$${groupNumberText((Math.round(value * 100) / 100).toFixed(2))}`;
}

export function formatMetricUnitValue(unit: MetricUnit, value: number): string {
  if (!Number.isFinite(value)) return '0';
  switch (unit) {
    case 'ratio':
      return `${(value * 100).toFixed(1)}%`;
    case 'bytes':
      return formatBytesValue(value);
    case 'durationMs':
      return formatDurationMsValue(value);
    case 'humanDuration':
      return formatHumanDurationValue(value);
    case 'money':
      return formatMoneyValue(value);
    case 'count':
    default:
      return formatCountValue(value);
  }
}
