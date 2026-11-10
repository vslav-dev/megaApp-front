import { MetricsHealthSeverity } from '@app/shared/types';

export interface SeverityThresholds {
  warnAfterSeconds: number;
  errorAfterSeconds: number;
}

export const DEFAULT_SEVERITY_THRESHOLDS: SeverityThresholds = {
  warnAfterSeconds: 150,
  errorAfterSeconds: 300,
};

export function severityDotClass(severity: MetricsHealthSeverity | null): string {
  switch (severity) {
    case 'ok':
      return 'bg-green-500';
    case 'warn':
      return 'bg-yellow-500';
    case 'error':
      return 'bg-red-500';
    default:
      return 'bg-gray-400';
  }
}

export function severityColor(severity: MetricsHealthSeverity | null): string {
  switch (severity) {
    case 'ok':
      return '#22c55e';
    case 'warn':
      return '#eab308';
    case 'error':
      return '#ef4444';
    default:
      return '#9ca3af';
  }
}

// How much of the original color survives the mute — the rest is the theme's surface color.
// Mixing toward the surface (not a mid-tone gray) means turning this down makes the
// result paler/lighter, not darker/muddier — the surface is the lightest thing around it.
const MUTED_SECTION_COLOR_PERCENT = 50;

// Blends a color toward the theme's surface color for unselected section
// tabs — the color must be a literal (not itself `var(--v-color-primary)`,
// see the comment at the dashboard tab's call site for why).
export function mutedSectionColor(color: string): string {
  return `color-mix(in oklab, ${color} ${MUTED_SECTION_COLOR_PERCENT}%, var(--v-color-surface) ${100 - MUTED_SECTION_COLOR_PERCENT}%)`;
}
