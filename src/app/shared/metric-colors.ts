// Tailwind palette hex values reused across every metrics-catalog.*.ts file — a
// single source of truth so the same shade always means the same named color, and
// a typo in a hex string turns into a compile error instead of a silently-wrong one.
export const MetricColor = {
  Red600: '#dc2626',
  Red500: '#ef4444',
  Orange600: '#ea580c',
  Amber700: '#b45309',
  Amber600: '#d97706',
  Amber500: '#f59e0b',
  Amber400: '#fbbf24',
  Pink600: '#db2777',
  Pink500: '#ec4899',
  Violet600: '#7c3aed',
  Violet400: '#a78bfa',
  Blue600: '#2563eb',
  Blue400: '#60a5fa',
  Cyan700: '#0e7490',
  Cyan600: '#0891b2',
  Teal700: '#0f766e',
  Teal500: '#14b8a6',
  Green600: '#16a34a',
  Lime600: '#65a30d',
  Lime500: '#84cc16',
  Slate500: '#64748b',
  // Fallback shade for metrics that don't set a color explicitly — not part of the
  // Tailwind palette above, kept distinct so it visually reads as "uncategorized".
  Default: '#578f92',
} as const;

export type MetricColor = (typeof MetricColor)[keyof typeof MetricColor];
