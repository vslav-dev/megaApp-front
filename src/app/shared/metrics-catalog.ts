import { MetricUnit } from '@app/shared/metric-units';
import { MetricAggregation } from '@app/shared/metrics-aggregation';
import { DEFAULT_METRIC_COLOR, MetricConfig, MetricsServiceDefinition } from '@app/shared/metrics-catalog-metric';
import { CYCLE_BOOKS_FETCHER_BOT_METRICS_DEFINITION } from '@app/shared/metrics-catalog.cycle-books-fetcher-bot';
import { HARDWARE_METRICS_DEFINITION } from '@app/shared/metrics-catalog.hardware';
import { LIVE_BOOKS_FETCHER_BOT_METRICS_DEFINITION } from '@app/shared/metrics-catalog.live-books-fetcher-bot';
import { MEGAAPP_METRICS_DEFINITION } from '@app/shared/metrics-catalog.megaapp';
import { MM_BOT_METRICS_DEFINITION } from '@app/shared/metrics-catalog.mm-bot';
import { SOZVON_KONSPEKT_METRICS_DEFINITION } from '@app/shared/metrics-catalog.sozvon-konspekt';
import { SPREAD_CAPTURE_BOT_METRICS_DEFINITION } from '@app/shared/metrics-catalog.spread-capture-bot';
import { SPREAD_CAPTURE_BOT_V4_METRICS_DEFINITION } from '@app/shared/metrics-catalog.spread-capture-bot-v4';
import { TG_TRANSCRIBER_BOT_METRICS_DEFINITION } from '@app/shared/metrics-catalog.tg-transcriber-bot';

export type { MetricsGroupDefinition, MetricsServiceDefinition } from '@app/shared/metrics-catalog-metric';

const UNCATALOGUED_DEFAULTS = {
  aggregation: 'avg' as MetricAggregation,
  integerValued: true,
  unit: 'count' as MetricUnit,
  color: DEFAULT_METRIC_COLOR,
  description: 'Метрика ещё не описана в каталоге — показано значение по умолчанию.',
};

interface ResolvedCatalog {
  definition: MetricsServiceDefinition;
  byName: ReadonlyMap<string, MetricConfig>;
}

function buildCatalog(definition: MetricsServiceDefinition): ResolvedCatalog {
  const byName = new Map<string, MetricConfig>();
  for (const group of definition.groups) {
    for (const config of group.metrics) {
      if (byName.has(config.name)) {
        throw new Error(`Duplicate metric name "${config.name}" in service "${definition.service}"`);
      }
      byName.set(config.name, config);
    }
  }
  return { definition, byName };
}

const STATIC_CATALOGS: ResolvedCatalog[] = [
  buildCatalog(SPREAD_CAPTURE_BOT_METRICS_DEFINITION),
  buildCatalog(SPREAD_CAPTURE_BOT_V4_METRICS_DEFINITION),
  buildCatalog(MM_BOT_METRICS_DEFINITION),
  buildCatalog(MEGAAPP_METRICS_DEFINITION),
  buildCatalog(SOZVON_KONSPEKT_METRICS_DEFINITION),
  buildCatalog(CYCLE_BOOKS_FETCHER_BOT_METRICS_DEFINITION),
  buildCatalog(LIVE_BOOKS_FETCHER_BOT_METRICS_DEFINITION),
  buildCatalog(TG_TRANSCRIBER_BOT_METRICS_DEFINITION),
];

const STATIC_CATALOG_BY_SERVICE = new Map<string, ResolvedCatalog>(
  STATIC_CATALOGS.map((catalog) => [catalog.definition.service, catalog]),
);

const HARDWARE_CATALOG = buildCatalog(HARDWARE_METRICS_DEFINITION);
const HARDWARE_SERVICE_PREFIX = 'hardware:';

const METRICS_SERVICE_VARIANTS: Record<string, { baseService: string }> = {
  'megaapp-test': { baseService: 'megaapp' },
};

function isHardwareService(service: string): boolean {
  return service.startsWith(HARDWARE_SERVICE_PREFIX);
}

function resolveCatalog(service: string): ResolvedCatalog | null {
  const direct = STATIC_CATALOG_BY_SERVICE.get(service);
  if (direct) return direct;
  if (isHardwareService(service)) return HARDWARE_CATALOG;

  const variant = METRICS_SERVICE_VARIANTS[service];
  if (variant) return STATIC_CATALOG_BY_SERVICE.get(variant.baseService) ?? null;

  return null;
}

export function metricsServiceDefinition(service: string | null | undefined): MetricsServiceDefinition | null {
  if (!service) return null;
  const catalog = resolveCatalog(service);
  if (!catalog) return null;
  if (service === catalog.definition.service) return catalog.definition;
  // Динамический hardware-хост или megaapp-test-вариант — те же группы/метрики, другой service.
  return { ...catalog.definition, service };
}

export function metricsServiceDefinitions(): MetricsServiceDefinition[] {
  return STATIC_CATALOGS.map((catalog) => catalog.definition);
}

export function metricsCatalogKnownNames(service: string): ReadonlySet<string> {
  const catalog = resolveCatalog(service);
  return catalog ? new Set(catalog.byName.keys()) : new Set();
}

function lookupMetric(service: string, name: string): MetricConfig | null {
  return resolveCatalog(service)?.byName.get(name) ?? null;
}

export function metricLabel(service: string, name: string): string {
  return lookupMetric(service, name)?.label ?? name;
}

export function metricDescription(service: string, name: string): string {
  const config = lookupMetric(service, name);
  if (!config) return UNCATALOGUED_DEFAULTS.description;
  if (!config.removed) return config.description;
  const note = config.removedNote ?? 'замены нет';
  return `${config.description}\n\nМетрика удалена, больше не собирается. ${note}.`;
}

export function metricAggregation(service: string, name: string): MetricAggregation {
  return lookupMetric(service, name)?.aggregation ?? UNCATALOGUED_DEFAULTS.aggregation;
}

export function metricIntegerValued(service: string, name: string): boolean {
  return lookupMetric(service, name)?.integerValued ?? UNCATALOGUED_DEFAULTS.integerValued;
}

export function metricUnit(service: string, name: string): MetricUnit {
  return lookupMetric(service, name)?.unit ?? UNCATALOGUED_DEFAULTS.unit;
}

export function metricColor(service: string, name: string): string {
  return lookupMetric(service, name)?.color ?? UNCATALOGUED_DEFAULTS.color;
}
