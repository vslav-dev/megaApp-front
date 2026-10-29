export type MetricAggregation = 'avg' | 'max' | 'sum' | 'last';

// Whether a metric's raw samples are always whole numbers (event counts, snapshot
// counts of discrete things) as opposed to a genuinely continuous quantity (ratio,
// duration, money, load average). Combining values never needs this for max/sum/last
// — those preserve integer-ness on their own — but 'avg' produces a fraction as soon
// as the samples don't divide evenly, which reads as a fake artifact for a counter
// (e.g. "70.2 reprices") rather than a real value. See metrics-catalog-metric.ts.
export function aggregateMetricValues(aggregation: MetricAggregation, values: number[], integerValued: boolean): number {
  const first = values[0];
  if (first === undefined) {
    return 0;
  }

  switch (aggregation) {
    case 'max': {
      let max = first;
      for (const value of values.slice(1)) {
        if (value > max) {
          max = value;
        }
      }
      return max;
    }
    case 'sum': {
      let sum = 0;
      for (const value of values) {
        sum += value;
      }
      return sum;
    }
    case 'last':
      return values.at(-1) ?? first;
    case 'avg':
    default: {
      let sum = 0;
      for (const value of values) {
        sum += value;
      }
      const avg = sum / values.length;
      return integerValued ? Math.round(avg) : avg;
    }
  }
}
