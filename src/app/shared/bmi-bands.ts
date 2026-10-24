// BMI scale shared by the BMI widget (shows the whole 16–45 range) and the weight chart, where the
// outermost categories are open-ended: everything below 18.5 is underweight, everything above 40
// is class III obesity. Category i spans BMI_SCALE[i]..BMI_SCALE[i + 1].
export const BMI_SCALE = [16, 18.5, 25, 30, 35, 40, 45];

interface BmiCategory {
  // Widget segment fill (Tailwind) and chart-canvas fills (hex with alpha baked in so the weight
  // line, points and grid stay readable on top) — both for the same category, kept side by side
  // so a color change is made in one place.
  twBgClasses: string;
  fillLight: string;
  fillDark: string;
}

// Underweight, normal, overweight, obesity I/II/III — aligned with the spans of BMI_SCALE.
export const BMI_CATEGORIES: BmiCategory[] = [
  { twBgClasses: 'bg-yellow-300 dark:bg-amber-500', fillLight: '#fde04738', fillDark: '#f59e0b40' },
  { twBgClasses: 'bg-green-400 dark:bg-green-500', fillLight: '#4ade8038', fillDark: '#22c55e40' },
  { twBgClasses: 'bg-yellow-300 dark:bg-amber-500', fillLight: '#fde04738', fillDark: '#f59e0b40' },
  { twBgClasses: 'bg-red-300 dark:bg-red-500', fillLight: '#fca5a538', fillDark: '#ef444440' },
  { twBgClasses: 'bg-red-500 dark:bg-red-700', fillLight: '#ef444438', fillDark: '#b91c1c40' },
  { twBgClasses: 'bg-red-700 dark:bg-red-900', fillLight: '#b91c1c38', fillDark: '#7f1d1d60' },
];

export interface BmiBand {
  fromKg: number;
  toKg: number;
  color: string;
}

export function bmiToKg(bmi: number, heightCm: number): number {
  const heightMeters = heightCm / 100;
  return bmi * heightMeters * heightMeters;
}

export function buildBmiBands(heightCm: number, isDark: boolean): BmiBand[] {
  const lastIdx = BMI_CATEGORIES.length - 1;

  return BMI_CATEGORIES.map((category, idx) => ({
    fromKg: idx === 0 ? -Infinity : bmiToKg(BMI_SCALE[idx], heightCm),
    toKg: idx === lastIdx ? Infinity : bmiToKg(BMI_SCALE[idx + 1], heightCm),
    color: isDark ? category.fillDark : category.fillLight,
  }));
}
