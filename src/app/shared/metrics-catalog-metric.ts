import { MetricColor } from '@app/shared/metric-colors';
import { MetricUnit } from '@app/shared/metric-units';
import { MetricAggregation } from '@app/shared/metrics-aggregation';

export interface MetricConfig {
  name: string;
  label: string;
  description: string;
  aggregation: MetricAggregation;
  // Сырые значения метрики всегда целые (счётчики событий/снэпшотов), в отличие от
  // непрерывных величин (ratio/durationMs/money/load average). Единственное место,
  // где это имеет значение — усреднение: 5-минутное схлопывание карточек усредняет
  // вообще все метрики (см. metrics-dashboard.ts, collapsedDisplayAggregation), и
  // для целой по природе метрики результат обязан остаться целым, иначе на графике
  // появляется значение вроде "70.2 репрайса", которого на самом деле не бывает.
  integerValued: boolean;
  unit: MetricUnit;
  color: MetricColor;
  // Метрика когда-то собиралась под этим именем, бэк её больше не шлёт. Запись
  // остаётся в каталоге (не удаляется), чтобы её label/description продолжали
  // резолвиться для любых точек, оставшихся в ретеншене, и рендерится в
  // отдельной синтетической группе Removed вместо своей штатной группы.
  removed: boolean;
  // Свободная подсказка "теперь смотри X" / "замены нет" для тултипа в Removed.
  removedNote?: string;
}

export interface MetricsGroupDefinition {
  id: string;
  label: string;
  metrics: MetricConfig[];
}

export interface MetricsServiceDefinition {
  service: string;
  groups: MetricsGroupDefinition[];
}

interface MetricOptions {
  aggregation: MetricAggregation;
  description: string;
  label?: string;
  // Default false — most metrics either aren't averaged at all (max/sum/last keep
  // integer-ness on their own) or are genuinely continuous. Set true only for
  // metrics whose raw samples are always whole numbers.
  integerValued?: boolean;
  unit?: MetricUnit;
  color?: MetricColor;
  removed?: boolean;
  removedNote?: string;
}

export const DEFAULT_METRIC_COLOR: MetricColor = MetricColor.Default;

const RATIO_SUFFIX = /_ratio(_avg|_max)?$/; // *_ratio[_avg|_max] -> доля 0..1
const BYTES_SUFFIX = /_bytes$/; // *_bytes -> байты
const MS_SUFFIX = /_ms$/; // *_ms -> миллисекунды

function inferUnitFromSuffix(name: string): MetricUnit {
  if (RATIO_SUFFIX.test(name)) return 'ratio';
  if (BYTES_SUFFIX.test(name)) return 'bytes';
  if (MS_SUFFIX.test(name)) return 'durationMs';
  return 'count';
}

export function metric(name: string, options: MetricOptions): MetricConfig {
  return {
    name,
    label: options.label ?? name,
    description: options.description,
    aggregation: options.aggregation,
    integerValued: options.integerValued ?? false,
    unit: options.unit ?? inferUnitFromSuffix(name),
    color: options.color ?? DEFAULT_METRIC_COLOR,
    removed: options.removed ?? false,
    removedNote: options.removedNote,
  };
}
