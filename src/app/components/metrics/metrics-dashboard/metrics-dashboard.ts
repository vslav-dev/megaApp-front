import {
  AfterViewInit,
  Component,
  computed,
  effect,
  ElementRef,
  inject,
  OnDestroy,
  OnInit,
  Signal,
  signal,
  viewChild,
} from '@angular/core';
import { DeviceInfoService } from '@app/services/device-info.service';
import { MetricCardExpansionService } from '@app/services/metric-card-expansion.service';
import { MetricsHealthService } from '@app/services/metrics-health.service';
import { CardLayoutMode, MetricsSettingsService, TooltipMode } from '@app/services/metrics-settings.service';
import { MetricsService } from '@app/services/metrics.service';
import { TelemetryService } from '@app/services/telemetry.service';
import { ToolbarGroup } from '@app/shared/components/toolbar-group/toolbar-group';
import { FitTextOnOverflowDirective } from '@app/shared/directives/fit-text-on-overflow.directive';
import { formatMetricUnitValue, MetricUnit } from '@app/shared/metric-units';
import { MetricAggregation } from '@app/shared/metrics-aggregation';
import {
  metricAggregation,
  metricColor,
  metricDescription,
  metricIntegerValued,
  metricLabel,
  metricsCatalogKnownNames,
  metricsServiceDefinition,
  metricsServiceDefinitions,
  metricUnit,
} from '@app/shared/metrics-catalog';
import { DEFAULT_METRIC_CHART_MODE, MetricChartMode } from '@app/shared/metrics-chart-mode';
import {
  isSameMetricWindow,
  METRIC_GRANULARITIES,
  METRIC_GRANULARITY_SPECS,
  metricWindowAt,
} from '@app/shared/metrics-granularity';
import {
  buildCollapsedMetricWindow,
  buildSparseBarSeriesFromPoints,
  buildSparseLineSeriesFromPoints,
  filterMetricPointsByWindow,
  metricPointsIndexKey,
  MinuteMetricCollapseCache,
} from '@app/shared/metrics-series';
import { mutedSectionColor, severityColor } from '@app/shared/metrics-severity';
import { clearMetricSyncCrosshair } from '@app/shared/metrics-sync-crosshair';
import {
  COMPOSITE_SERVICE_KEY,
  CompositeMetricDefinition,
  MetricGranularity,
  MetricPoint,
  MetricsScopeEntry,
} from '@app/shared/types';
import { VButton } from '@ui-kit/components/v-button/v-button';
import { VCard } from '@ui-kit/components/v-card/v-card';
import { VCheckbox } from '@ui-kit/components/v-checkbox/v-checkbox';
import { VExpand } from '@ui-kit/components/v-expand/v-expand';
import { IconName, VIcon } from '@ui-kit/components/v-icon/v-icon';
import { VInput } from '@ui-kit/components/v-input/v-input';
import { VToggle, VToggleItem } from '@ui-kit/components/v-toggle/v-toggle';
import { VTooltip } from '@ui-kit/components/v-tooltip/v-tooltip';
import {
  MetricCardGrid,
  MetricChartCardData,
  MetricChartCardSeriesDisplay,
} from '../metric-card-grid/metric-card-grid';

const NOW_TICK_INTERVAL_MS = 30_000;
const STICKY_LABEL_GAP_PX = 8;
const SETTINGS_PANEL_KEY = '__settings__';
const DASHBOARD_PANEL_KEY = '__dashboard__';
const DEFAULT_COMPOSITE_LABEL = 'Составные метрики';
const COLLAPSED_MINUTE_STEP_SECONDS = 5 * 60;

// Hardcoded — was a user-editable list (add/remove sum, per-sum "treat missing as 0"
// checkbox); that settings UI is gone, this is now the fixed set. serviceB always mirrors
// serviceA's metric name (there's only one metric per sum, see compositeCardLive).
const COMPOSITE_METRIC_DEFINITIONS: CompositeMetricDefinition[] = [
  { id: 'free_cash', metricName: 'free_cash', serviceA: 'spread-capture-bot-v3', serviceB: 'spread-capture-bot-v4' },
  {
    id: 'estimated_open_positions_value',
    metricName: 'estimated_open_positions_value',
    serviceA: 'spread-capture-bot-v3',
    serviceB: 'spread-capture-bot-v4',
  },
  {
    id: 'estimated_account_value',
    metricName: 'estimated_account_value',
    serviceA: 'spread-capture-bot-v3',
    serviceB: 'spread-capture-bot-v4',
  },
  {
    id: 'orders_buy',
    metricName: 'orders_buy',
    serviceA: 'spread-capture-bot-v3',
    serviceB: 'spread-capture-bot-v4',
    treatMissingAsZero: true,
  },
  {
    id: 'orders_sell',
    metricName: 'orders_sell',
    serviceA: 'spread-capture-bot-v3',
    serviceB: 'spread-capture-bot-v4',
  },
];

// Step correction for money moved in/out of the account that isn't trading P&L (a withdrawal,
// a deposit) — added to every composite definition it touches (cash and the account value that
// includes it) for every bucket at/after the moment it happened, so the sums keep reading as if
// that transfer never occurred. A withdrawal needs a
// positive delta (compensates the drop), a deposit a negative one. A bucket is a closed period
// [bucket, bucket + step) holding its last value, epoch seconds floor-aligned to the selected
// granularity's step (see metricWindowAt in metrics-granularity.ts). So the adjustment applies
// to every bucket whose period ends after `sinceUnixSeconds` — that includes the hour/day bucket
// the transfer happened in, whose value is already post-transfer. The same threshold works
// unchanged across minute/hour/day.
interface CompositeMetricAdjustment {
  definitionIds: string[];
  sinceUnixSeconds: number;
  delta: number;
  note: string;
}

// Add one entry per real transfer, e.g.:
// { definitionIds: ['free_cash', 'estimated_account_value'], sinceUnixSeconds: 1735689600, delta: 1000, note: 'Вывод $1000, 2025-01-01' }
const COMPOSITE_METRIC_ADJUSTMENTS: CompositeMetricAdjustment[] = [
  // v4 free_cash 2927.07 → 927.05 в минуту 1793180400 (2026-10-28 09:40 UTC); v3 не менялся.
  // estimated_account_value = free_cash + open positions, поэтому падает на ту же сумму.
  {
    definitionIds: ['free_cash', 'estimated_account_value'],
    sinceUnixSeconds: 1793180400,
    delta: 2000,
    note: 'Вывод $2000, 2026-10-28 09:40 UTC',
  },
];

// The 5-minute view exists only to declutter a compact card, not to change what a
// metric means (that's still decided by its own `aggregation` for hour/day rollup
// and the full-width raw view) — so every metric collapses by averaging, which is
// gap-robust (a bucket with fewer raw points still yields a representative value,
// no separate handling needed for a still-filling or gap-shortened bucket) and
// smooths one-off spikes instead of amplifying them. The one exception is `max`
// metrics (e.g. CPU peak) — averaging would hide the peak the metric exists to show.
function collapsedDisplayAggregation(aggregation: MetricAggregation): MetricAggregation {
  return aggregation === 'max' ? 'max' : 'avg';
}

interface MetricGroupData {
  id: string;
  label: string;
  cards: MetricChartCardData[];
}

interface DashboardRowData extends MetricGroupData {
  shortLabel: string;
}

interface MetricsServiceOption {
  service: string;
}

// The reactive half of one card — everything that depends on live series data
// (or per-metric settings like chart mode) rather than static catalog/settings
// structure. Cached per card key (see cardLiveSignalsCache) so a data tick only
// invalidates the handful of computeds for the series that actually changed,
// never the whole dashboard. See
// plans/35-metrics-dashboard-viewport-rendering.implementation-plan.md §2.2.
interface CardLiveSignals {
  chartMode: Signal<MetricChartMode>;
  value: Signal<number>;
  displayValue: Signal<string>;
  display: Signal<MetricChartCardSeriesDisplay>;
  fullWidthDisplay: Signal<MetricChartCardSeriesDisplay>;
}

@Component({
  selector: 'metrics-dashboard',
  templateUrl: './metrics-dashboard.html',
  styleUrl: './metrics-dashboard.css',
  imports: [
    VButton,
    VCard,
    VCheckbox,
    VExpand,
    VInput,
    VIcon,
    VToggle,
    VTooltip,
    ToolbarGroup,
    MetricCardGrid,
    FitTextOnOverflowDirective,
  ],
})
export class MetricsDashboard implements OnInit, AfterViewInit, OnDestroy {
  protected readonly metricsService = inject(MetricsService);
  protected readonly metricsHealthService = inject(MetricsHealthService);
  protected readonly deviceInfoService = inject(DeviceInfoService);
  protected readonly metricCardExpansionService = inject(MetricCardExpansionService);
  protected readonly Icon = IconName;
  protected readonly CardLayoutMode = CardLayoutMode;
  protected readonly TooltipMode = TooltipMode;
  protected readonly settingsPanelKey = SETTINGS_PANEL_KEY;
  protected readonly dashboardPanelKey = DASHBOARD_PANEL_KEY;
  protected readonly compositeServiceKey = COMPOSITE_SERVICE_KEY;

  private readonly metricsSettingsService = inject(MetricsSettingsService);
  private readonly telemetry = inject(TelemetryService);

  private readonly now$$ = signal(Date.now());
  protected readonly targetWidthPx$$ = computed(() => this.metricsSettingsService.cardSize$$().widthPx);
  protected readonly heightPx$$ = computed(() => this.metricsSettingsService.cardSize$$().heightPx);
  protected readonly expandedHeightPx$$ = computed(() => this.metricsSettingsService.cardSize$$().expandedHeightPx);
  protected readonly cardLayoutMode$$ = this.metricsSettingsService.cardLayoutMode$$;
  protected readonly activeTooltipMode$$ = this.metricsSettingsService.activeTooltipMode$$;
  protected readonly granularityToggleItems: VToggleItem[] = METRIC_GRANULARITIES.map((granularity) => ({
    id: granularity,
    label: this.granularityLabel(granularity),
  }));
  protected readonly selectedGranularity$$ = this.metricsSettingsService.granularity$$;

  // The one time axis every card on the dashboard shares — a function of the selected
  // granularity and the ticking clock only, never of any card's data. The clock ticks twice as
  // often as the smallest step, so `equal` keeps the window (and everything computed from it)
  // from re-firing on ticks that don't move a boundary.
  private readonly metricWindow$$ = computed(
    () => metricWindowAt(this.selectedGranularity$$(), Math.floor(this.now$$() / 1000)),
    { equal: isSameMetricWindow },
  );
  protected readonly syncCrosshairEnabled$$ = this.metricsSettingsService.syncCrosshairEnabled$$;
  protected readonly forceZeroBaselineEnabled$$ = this.metricsSettingsService.forceZeroBaselineEnabled$$;
  protected readonly anomalyCorridorEnabled$$ = this.metricsSettingsService.anomalyCorridorEnabled$$;
  protected readonly anomalyCorridorPercent$$ = this.metricsSettingsService.anomalyCorridorPercent$$;
  protected readonly yTickCountCard$$ = this.metricsSettingsService.yTickCountCard$$;
  protected readonly yTickCountFullWidth$$ = this.metricsSettingsService.yTickCountFullWidth$$;
  protected readonly yTickSnapTolerancePercent$$ = this.metricsSettingsService.yTickSnapTolerancePercent$$;
  protected readonly dashboardSelection$$ = this.metricsSettingsService.dashboardSelection$$;
  protected readonly dashboardServiceSelection$$ = this.metricsSettingsService.dashboardServiceSelection$$;
  protected readonly isSavingSettings$$ = this.metricsSettingsService.isSaving$$;
  protected readonly hasUnsavedSettings$$ = this.metricsSettingsService.isDirty$$;
  private nowTickIntervalId: ReturnType<typeof setInterval> | null = null;
  private readonly minuteMetricCollapseCache = new MinuteMetricCollapseCache();
  private readonly isPageScrolled$$ = signal(window.scrollY > 0);
  private readonly onWindowScroll = () => this.isPageScrolled$$.set(window.scrollY > 0);

  protected readonly stickyBarClasses$$ = computed(() => {
    if (!this.deviceInfoService.isDesktopScreen$$()) return '';
    return this.isPageScrolled$$()
      ? 'sticky top-0 z-10 shadow-[0_10px_15px_-10px_rgba(0,0,0,0.3)]'
      : 'sticky top-0 z-10';
  });

  // Real measured height, not a guessed constant — the header bar wraps to more
  // than one line once enough services are visible, and a hardcoded offset would
  // silently drift out of sync with that. Only matters where the header is
  // actually sticky (desktop, see stickyBarClasses$$ above) — on mobile the
  // header scrolls away normally, so row/group labels below it never need to
  // dodge it and can stick starting right at the viewport top.
  private readonly stickyHeaderElem = viewChild<ElementRef<HTMLElement>>('stickyHeaderElem');
  private readonly stickyHeaderHeightPx$$ = signal(0);
  private stickyHeaderResizeObserver: ResizeObserver | null = null;
  // A few px of breathing room below the sticky point (header's bottom edge, or
  // the viewport top on mobile where the header isn't sticky) — without it the
  // label sits flush against that edge, which reads as visually "stuck to" it.
  protected readonly stickyLabelTopPx$$ = computed(
    () => (this.deviceInfoService.isDesktopScreen$$() ? this.stickyHeaderHeightPx$$() : 0) + STICKY_LABEL_GAP_PX,
  );

  // Which panel is expanded is transient UI state, not persisted anywhere (see
  // metrics-settings.service.ts) — every page load opens on the Dashboard panel.
  private readonly expandedPanel$$ = signal<string>(DASHBOARD_PANEL_KEY);
  private readonly isSettingsPanelExpanded$$ = signal(false);

  // Transient — every page load opens with cards in their normal display mode.
  protected readonly isCardEditMode$$ = signal(false);

  protected readonly serviceOptions$$ = computed<MetricsServiceOption[]>(() => {
    const discoveredServices = new Set<string>();
    for (const definition of metricsServiceDefinitions()) {
      discoveredServices.add(definition.service);
    }
    for (const service of this.metricsHealthService.services$$()) {
      discoveredServices.add(service.service);
    }
    for (const service of this.metricsService.knownServices$$()) {
      discoveredServices.add(service);
    }

    // Sorted by the raw technical service key, never by the (editable) display
    // label — sorting by the label would reorder this list on every keystroke
    // while typing a custom name in the settings panel below, kicking focus out
    // of the input mid-edit.
    return Array.from(discoveredServices)
      .sort((left, right) => left.localeCompare(right))
      .map((service) => ({ service }));
  });

  // Separate from serviceOptions$$ on purpose: settings panels (dashboard metric
  // picker, severity thresholds) must keep listing every known service so a
  // header-hidden service can still be reconfigured or re-shown. Only the header
  // tab bar and its expanded body use this filtered list.
  protected readonly visibleServiceOptions$$ = computed<MetricsServiceOption[]>(() =>
    this.serviceOptions$$().filter((option) => this.isServiceVisibleInHeader(option.service)),
  );

  // Header tab order follows the same order set for the dashboard cards
  // (dashboardServiceSelection$$), composite included — services without a
  // dashboard order keep their original (alphabetical) relative position, after
  // the ordered ones. Kept separate from serviceOptions$$/visibleServiceOptions$$,
  // which stay alphabetical, since those also drive the Settings panel's service
  // list, and reordering it while its own order input is being typed into would
  // kick focus out mid-edit.
  protected readonly headerEntries$$ = computed<{ service: string; isComposite: boolean }[]>(() => {
    const entries: { service: string; isComposite: boolean }[] = [];
    if (this.isServiceVisibleInHeader(this.compositeServiceKey)) {
      entries.push({ service: this.compositeServiceKey, isComposite: true });
    }
    for (const option of this.visibleServiceOptions$$()) {
      entries.push({ service: option.service, isComposite: false });
    }

    const orderMap = this.dashboardServiceSelection$$();
    return entries
      .map((entry, index) => ({ entry, index, order: orderMap[entry.service] }))
      .sort((left, right) => {
        if (left.order !== undefined && right.order !== undefined) return left.order - right.order;
        if (left.order !== undefined) return -1;
        if (right.order !== undefined) return 1;
        return left.index - right.index;
      })
      .map(({ entry }) => entry);
  });

  // Per-card cache of the reactive half of a card's data (CardLiveSignals) — keyed by
  // metricPointsIndexKey(service, name) for regular cards, or a composite-identity
  // string for composite ones (see compositeCardLive). Persists across structural
  // rebuilds (dashboard selection edits, granularity/settings changes) so the
  // underlying computeds — and their memoized values — survive those rebuilds intact;
  // only a card whose own identity actually changes gets a fresh entry. Never
  // explicitly pruned, same lifetime policy as MetricsService's own series buffers
  // (see plans/33 §2.1) — a metric removed from the dashboard just stops being read,
  // its cache entry sits unused and harmless.
  private readonly cardLiveSignalsCache = new Map<string, CardLiveSignals>();

  // Builds the data-dependent fields of one (service, metricName) card from
  // MetricsService.seriesFor(...) — this is the fine-grained reactivity boundary: each
  // of these is its own computed(), so a merge touching one metric only invalidates
  // this metric's own computeds, not every card on the page. See plan §2.2-§2.3.
  private regularCardLive(
    service: string,
    name: string,
    aggregation: MetricAggregation,
    integerValued: boolean,
  ): CardLiveSignals {
    const cacheKey = metricPointsIndexKey(service, name);
    const cached = this.cardLiveSignalsCache.get(cacheKey);
    if (cached) return cached;

    const chartMode = computed(() => this.metricsSettingsService.metricChartMode(service, name));
    const points = computed(() => this.metricsService.seriesFor(service, name, this.selectedGranularity$$())());
    const entry = this.buildCardLive(
      cacheKey,
      points,
      chartMode,
      metricUnit(service, name),
      aggregation,
      integerValued,
    );
    this.cardLiveSignalsCache.set(cacheKey, entry);
    return entry;
  }

  // Identity includes every field that changes what this card actually shows, not just
  // its id — editing a composite definition's services/metric/treatMissingAsZero must
  // land on a fresh cache entry, not silently keep evaluating stale closures over the
  // old serviceA/serviceB. The old entry is simply never read again (same "never
  // explicitly pruned" policy as the cache overall).
  private compositeCardLive(
    definition: CompositeMetricDefinition,
    aggregation: MetricAggregation,
    integerValued: boolean,
  ): CardLiveSignals {
    const cacheKey = `composite:${definition.id}:${definition.serviceA}:${definition.serviceB}:${definition.metricName}:${definition.treatMissingAsZero}`;
    const cached = this.cardLiveSignalsCache.get(cacheKey);
    if (cached) return cached;

    const adjustments = COMPOSITE_METRIC_ADJUSTMENTS.filter(
      (adjustment) => adjustment.definitionIds.includes(definition.id),
    );
    const chartMode = computed(() =>
      this.metricsSettingsService.metricChartMode(definition.serviceA, definition.metricName),
    );
    // Combines two independent series (A + B) at matching buckets, then applies any step
    // corrections for money transfers at/after their own moment (see COMPOSITE_METRIC_ADJUSTMENTS).
    const points = computed<MetricPoint[]>(() => {
      const granularity = this.selectedGranularity$$();
      const { stepSeconds } = METRIC_GRANULARITY_SPECS[granularity];
      const pointsA = this.metricsService.seriesFor(definition.serviceA, definition.metricName, granularity)();
      const pointsB = this.metricsService.seriesFor(definition.serviceB, definition.metricName, granularity)();
      const valuesA = new Map(pointsA.map((point) => [point.bucket, point.value]));
      const valuesB = new Map(pointsB.map((point) => [point.bucket, point.value]));
      const buckets = definition.treatMissingAsZero
        ? new Set([...valuesA.keys(), ...valuesB.keys()])
        : new Set(Array.from(valuesA.keys()).filter((bucket) => valuesB.has(bucket)));
      return Array.from(buckets)
        .sort((left, right) => left - right)
        .map((bucket) => {
          const adjustment = adjustments.reduce(
            (sum, entry) => (bucket + stepSeconds > entry.sinceUnixSeconds ? sum + entry.delta : sum),
            0,
          );
          return {
            service: COMPOSITE_SERVICE_KEY,
            name: definition.id,
            granularity,
            bucket,
            value: (valuesA.get(bucket) ?? 0) + (valuesB.get(bucket) ?? 0) + adjustment,
          };
        });
    });
    const entry = this.buildCardLive(
      cacheKey,
      points,
      chartMode,
      metricUnit(definition.serviceA, definition.metricName),
      aggregation,
      integerValued,
    );
    this.cardLiveSignalsCache.set(cacheKey, entry);
    return entry;
  }

  // The pipeline shared by regular and composite cards: raw points → only those inside the
  // shared time window → (collapsed for the compact minute view) → series. The header value
  // and the chart both derive from the same windowed points, so they can never disagree
  // about what counts as "in the window" — a series whose points all predate it reads as
  // empty, same as one that never had data.
  private buildCardLive(
    cacheKey: string,
    points: Signal<MetricPoint[]>,
    chartMode: Signal<MetricChartMode>,
    unit: MetricUnit,
    aggregation: MetricAggregation,
    integerValued: boolean,
  ): CardLiveSignals {
    const windowedPoints = computed(() => {
      const window = this.metricWindow$$();
      return filterMetricPointsByWindow(points(), window.startBucket, window.endBucket);
    });
    const value = computed(() => windowedPoints().at(-1)?.value ?? 0);
    const displayValue = computed(() => formatMetricUnitValue(unit, value()));
    // Collapsing only applies to the fitted-to-columns minute view — see
    // collapsedDisplayAggregation's own comment for why 5-minute collapsing exists at all.
    const display = computed(() =>
      this.buildSeriesDisplayFor(
        cacheKey,
        windowedPoints(),
        aggregation,
        integerValued,
        chartMode(),
        this.selectedGranularity$$() === 'minute',
      ),
    );
    const fullWidthDisplay = computed(() => {
      if (this.selectedGranularity$$() !== 'minute') return display();
      return this.buildSeriesDisplayFor(cacheKey, windowedPoints(), aggregation, integerValued, chartMode(), false);
    });

    return { chartMode, value, displayValue, display, fullWidthDisplay };
  }

  // windowedPoints are already inside the shared window; collapsing keeps them inside the
  // (5-minute-aligned) collapsed window too, since aligning a bucket down never leaves the
  // aligned-down window.
  private buildSeriesDisplayFor(
    collapseCacheKey: string,
    windowedPoints: MetricPoint[],
    aggregation: MetricAggregation,
    integerValued: boolean,
    chartMode: MetricChartMode,
    useCollapsed: boolean,
  ): MetricChartCardSeriesDisplay {
    const window = this.metricWindow$$();
    const stepSeconds = METRIC_GRANULARITY_SPECS[this.selectedGranularity$$()].stepSeconds;
    const displayWindow = useCollapsed ? buildCollapsedMetricWindow(window, COLLAPSED_MINUTE_STEP_SECONDS) : window;
    const displayStepSeconds = useCollapsed ? COLLAPSED_MINUTE_STEP_SECONDS : stepSeconds;
    const displayPoints = useCollapsed
      ? this.minuteMetricCollapseCache.collapse(
          collapseCacheKey,
          windowedPoints,
          collapsedDisplayAggregation(aggregation),
          integerValued,
          COLLAPSED_MINUTE_STEP_SECONDS,
        )
      : windowedPoints;
    const series =
      chartMode === 'bar'
        ? buildSparseBarSeriesFromPoints(displayPoints)
        : buildSparseLineSeriesFromPoints(displayPoints, displayStepSeconds);
    return {
      series,
      scalePoints: windowedPoints,
      windowStartBucket: displayWindow.startBucket,
      windowEndBucket: displayWindow.endBucket,
      displayStepSeconds,
    };
  }

  // Structural fields only rebuild on catalog/settings changes (dashboard selection
  // edit, granularity toggle) — never on a data tick, since this never reads
  // seriesFor()/points() itself, only hands out signal references built by
  // regularCardLive. The template invoking card.value()/card.display() etc. is what
  // actually subscribes to data, independently per card.
  private regularCardData(service: string, name: string, dashboardOrder: number | undefined): MetricChartCardData {
    const aggregation = metricAggregation(service, name);
    const integerValued = metricIntegerValued(service, name);
    const live = this.regularCardLive(service, name, aggregation, integerValued);
    return {
      key: metricPointsIndexKey(service, name),
      label: metricLabel(service, name),
      technicalName: name,
      value: live.value,
      displayValue: live.displayValue,
      unit: metricUnit(service, name),
      granularity: this.selectedGranularity$$,
      color: metricColor(service, name),
      chartMode: live.chartMode,
      description: metricDescription(service, name),
      display: live.display,
      fullWidthDisplay: live.fullWidthDisplay,
      isDashboardEnabled: dashboardOrder !== undefined,
      dashboardOrder: dashboardOrder ?? 0,
    };
  }

  private compositeCardData(definition: CompositeMetricDefinition): MetricChartCardData | null {
    // metricName/serviceA/serviceB are non-nullable in the type, but the composite
    // settings panel lets a definition sit with one of them still blank mid-edit —
    // this is a runtime emptiness guard, not a type narrowing (see buildCompositeCard,
    // the code this replaces, for the same check).
    if (!definition.metricName || !definition.serviceA || !definition.serviceB) return null;
    const aggregation = metricAggregation(definition.serviceA, definition.metricName);
    const integerValued = metricIntegerValued(definition.serviceA, definition.metricName);
    const live = this.compositeCardLive(definition, aggregation, integerValued);
    return {
      key: metricPointsIndexKey(COMPOSITE_SERVICE_KEY, definition.id),
      label: `Σ ${metricLabel(definition.serviceA, definition.metricName)}`,
      technicalName: definition.metricName,
      value: live.value,
      displayValue: live.displayValue,
      unit: metricUnit(definition.serviceA, definition.metricName),
      granularity: this.selectedGranularity$$,
      color: metricColor(definition.serviceA, definition.metricName),
      chartMode: live.chartMode,
      description: `Сумма «${definition.metricName}»: ${definition.serviceA} + ${definition.serviceB}`,
      display: live.display,
      fullWidthDisplay: live.fullWidthDisplay,
      // No per-card dashboard toggle for composite metrics — the whole section is one
      // on/off switch (Show in dashboard, above), so every defined sum is always part of it.
      isDashboardEnabled: true,
      dashboardOrder: 0,
    };
  }

  private compositeCards(): MetricChartCardData[] {
    return COMPOSITE_METRIC_DEFINITIONS.map((definition) => this.compositeCardData(definition)).filter(
      (card): card is MetricChartCardData => card !== null,
    );
  }

  // Only the currently-expanded single-service settings panel needs its full catalog
  // built — narrowed from the old serviceMetricsData$$, which built every service's
  // full catalog groups on every recompute regardless of which (if any) panel was
  // actually open. See plans/33 §4 (this was deferred there) and plans/35 §2.2.
  protected readonly expandedServiceGroups$$ = computed<MetricGroupData[]>(() => {
    const service = this.expandedPanel$$();
    const definition = metricsServiceDefinition(service);
    const dashboardSelection = this.dashboardSelection$$()[service] ?? {};
    const buildCard = (name: string) => this.regularCardData(service, name, dashboardSelection[name]);

    // filter(cards.length > 0) на конце: если группа каталога целиком состоит из
    // removed-метрик (как синтетическая группа "Removed" в самом каталоге), после
    // вычитки removed-карточек в неё нечего класть — не рисуем пустую полосу.
    const groups = (definition?.groups ?? [])
      .map((group) => ({
        id: group.id,
        label: group.label,
        cards: group.metrics.filter((config) => !config.removed).map((config) => buildCard(config.name)),
      }))
      .filter((group) => group.cards.length > 0);

    // Метрики, явно помеченные в каталоге как removed (бэк их когда-то слал под
    // этим именем, но перестал) — каталогу известны, просто отправлены в архив.
    const removedNames = (definition?.groups ?? []).flatMap((group) =>
      group.metrics.filter((config) => config.removed).map((config) => config.name),
    );
    if (removedNames.length > 0) {
      groups.push({ id: 'removed', label: 'Removed', cards: removedNames.map(buildCard) });
    }
    return groups;
  });

  protected readonly compositeGroups$$ = computed<MetricGroupData[]>(() => {
    if (this.expandedPanel$$() !== COMPOSITE_SERVICE_KEY) return [];
    return [{ id: 'composite', label: DEFAULT_COMPOSITE_LABEL, cards: this.compositeCards() }];
  });

  // Every dashboard-selected metric across every service — genuinely wide by design
  // (a dashboard-wide overview), unlike expandedServiceGroups$$ above. Narrowing this
  // further isn't the win it looks like (see plans/33 §4's original rejection); what
  // actually matters is that this computed itself never reads seriesFor()/points(), so
  // it only rebuilds on dashboard-selection/settings edits, never on a data tick — see
  // regularCardData's comment.
  protected readonly dashboardCardsByService$$ = computed<Map<string, MetricChartCardData[]>>(() => {
    const dashboardSelection = this.dashboardSelection$$();
    const result = new Map<string, MetricChartCardData[]>();
    for (const [service, selection] of Object.entries(dashboardSelection)) {
      const selectedMetrics = Object.entries(selection).sort(
        ([leftName, leftOrder], [rightName, rightOrder]) => leftOrder - rightOrder || leftName.localeCompare(rightName),
      );
      if (selectedMetrics.length === 0) continue;
      result.set(
        service,
        selectedMetrics.map(([name, order]) => this.regularCardData(service, name, order)),
      );
    }
    return result;
  });

  protected readonly dashboardRows$$ = computed<DashboardRowData[]>(() => {
    const cardsByService = this.dashboardCardsByService$$();
    const serviceSelection = this.dashboardServiceSelection$$();
    const rows: { id: string; label: string; shortLabel: string; order: number; cards: MetricChartCardData[] }[] = [];
    for (const option of this.serviceOptions$$()) {
      const order = serviceSelection[option.service];
      if (order === undefined) continue;
      const cards = cardsByService.get(option.service) ?? [];
      if (cards.length === 0) continue;
      rows.push({
        id: option.service,
        label: this.resolvedServiceLabel(option.service),
        shortLabel: this.resolvedServiceShortLabel(option.service),
        order,
        cards,
      });
    }
    const compositeOrder = serviceSelection[COMPOSITE_SERVICE_KEY];
    const compositeCards = this.compositeCards();
    if (compositeOrder !== undefined && compositeCards.length > 0) {
      rows.push({
        id: COMPOSITE_SERVICE_KEY,
        label: this.resolvedServiceLabel(COMPOSITE_SERVICE_KEY),
        shortLabel: this.resolvedServiceShortLabel(COMPOSITE_SERVICE_KEY),
        order: compositeOrder,
        cards: compositeCards,
      });
    }
    rows.sort((left, right) => left.order - right.order || left.label.localeCompare(right.label));
    return rows.map(({ id, label, shortLabel, cards }) => ({ id, label, shortLabel, cards }));
  });

  // Structural-layer probe only — counts cards, not points, since dashboardCardsByService$$
  // never reads series data itself (see its own comment). Per-series update cost is
  // covered by MetricsService's own metrics.realtime_batch/history_refresh telemetry.
  private readonly dashboardModelProbe = effect(() => {
    const startedAt = performance.now();
    const rows = this.dashboardRows$$();
    const cards = rows.reduce((total, row) => total + row.cards.length, 0);
    this.telemetry.record('metrics.dashboard_model', performance.now() - startedAt, {
      services: rows.length,
      cards,
      points: this.metricsService.totalBufferedPointCount(),
    });
  });

  // Which (service, metricName) pairs the currently open panel actually shows —
  // the request/subscription contract is always this explicit list, never a
  // whole-service wildcard. See plans/32-metrics-mobile-custom-only-mode.implementation-plan.md §4.1.
  private readonly metricsScope$$ = computed<MetricsScopeEntry[]>(() => {
    const panel = this.resolvedExpandedPanel();
    if (panel === DASHBOARD_PANEL_KEY) return this.dashboardScopeEntries();
    if (panel === COMPOSITE_SERVICE_KEY) return this.compositeScopeEntries();
    const metricNames = Array.from(metricsCatalogKnownNames(panel));
    return metricNames.length > 0 ? [{ service: panel, metricNames }] : [];
  });

  // The one place that pushes scope changes into MetricsService — reacts to
  // every panel/selection change that metricsScope$$ depends on, so there is
  // no separate call site to keep in sync by hand.
  private readonly scopeSyncEffect = effect(() => {
    this.metricsService.setScope(this.metricsScope$$());
  });

  public ngOnInit(): void {
    const startedAt = performance.now();
    this.nowTickIntervalId = setInterval(() => this.now$$.set(Date.now()), NOW_TICK_INTERVAL_MS);
    window.addEventListener('scroll', this.onWindowScroll, { passive: true });
    void this.telemetry.recordAfterPaint('metrics.dashboard_ready', startedAt, {
      granularity: this.selectedGranularity$$(),
    });
  }

  public ngAfterViewInit(): void {
    const headerElement = this.stickyHeaderElem()?.nativeElement;
    if (!headerElement) return;
    this.stickyHeaderHeightPx$$.set(headerElement.offsetHeight);
    this.stickyHeaderResizeObserver = new ResizeObserver(([entry]) => {
      this.stickyHeaderHeightPx$$.set(entry.borderBoxSize?.[0]?.blockSize ?? headerElement.offsetHeight);
    });
    this.stickyHeaderResizeObserver.observe(headerElement);
  }

  public ngOnDestroy(): void {
    this.metricsService.unsubscribe();
    if (this.nowTickIntervalId !== null) {
      clearInterval(this.nowTickIntervalId);
    }
    window.removeEventListener('scroll', this.onWindowScroll);
    this.stickyHeaderResizeObserver?.disconnect();
    this.stickyHeaderResizeObserver = null;
  }

  protected resolvedServiceLabel(service: string): string {
    const long = this.metricsSettingsService.serviceCustomLabels$$()[service]?.long?.trim();
    if (long) return long;
    return service === COMPOSITE_SERVICE_KEY ? DEFAULT_COMPOSITE_LABEL : service;
  }

  // Compact form shown by default on the top header buttons — expands to the full
  // resolvedServiceLabel() on hover (see the .header-label-* rules in the stylesheet).
  protected resolvedServiceShortLabel(service: string): string {
    const short = this.metricsSettingsService.serviceCustomLabels$$()[service]?.short?.trim();
    return short || this.resolvedServiceLabel(service);
  }

  // When short and long resolve to the same text, skip the hover-swap markup entirely —
  // crossfading identical text onto itself is a pointless flicker, not an animation.
  protected hasHoverExpandableServiceLabel(service: string): boolean {
    return this.resolvedServiceShortLabel(service) !== this.resolvedServiceLabel(service);
  }

  protected serviceColor(service: string): string {
    const severity =
      this.metricsHealthService.services$$().find((entry) => entry.service === service)?.severity ?? null;
    return severityColor(severity);
  }

  // Only the selected section button keeps its full severity/primary color —
  // the rest get muted toward the theme's muted-text gray so the active tab stands out.
  protected sectionButtonColor(service: string): string {
    const color = this.serviceColor(service);
    return this.isServiceExpanded(service) ? color : mutedSectionColor(color);
  }

  protected granularityLabel(granularity: MetricGranularity): string {
    switch (granularity) {
      case 'hour':
        return 'H';
      case 'day':
        return 'D';
      default:
        return 'M';
    }
  }

  protected selectGranularity(granularity: MetricGranularity): void {
    const startedAt = performance.now();
    const previous = this.selectedGranularity$$();
    clearMetricSyncCrosshair();
    this.metricsSettingsService.setGranularity(granularity);
    void this.telemetry.recordAfterPaint('metrics.granularity_change', startedAt, {
      from: previous,
      to: granularity,
    });
  }

  protected granularityToggleValue(): string[] {
    return [this.selectedGranularity$$()];
  }

  // v-toggle deselects to [] when the already-active item is clicked again — ignore
  // that instead of clearing the granularity, since exactly one must stay selected.
  protected onGranularityToggleChange(value: string[]): void {
    const next = value[0] as MetricGranularity | undefined;
    if (!next) return;
    this.selectGranularity(next);
  }

  protected isServiceExpanded(service: string): boolean {
    if (service === SETTINGS_PANEL_KEY) {
      return this.isSettingsPanelExpanded$$();
    }
    return service === this.resolvedExpandedPanel();
  }

  protected toggleServiceExpanded(service: string): void {
    const startedAt = performance.now();
    if (service === SETTINGS_PANEL_KEY) {
      this.isSettingsPanelExpanded$$.update((value) => !value);
      void this.telemetry.recordAfterPaint('metrics.panel_change', startedAt, { panel: 'settings' });
      return;
    }

    // Mobile is locked to the Dashboard panel — the header doesn't render service
    // tabs to trigger this (see the template), this guard just makes the lock
    // hold regardless of the call site.
    if (this.deviceInfoService.isMobileScreen$$() && service !== DASHBOARD_PANEL_KEY) {
      return;
    }

    if (service === this.resolvedExpandedPanel()) {
      return;
    }

    clearMetricSyncCrosshair();
    this.expandedPanel$$.set(service);
    void this.telemetry.recordAfterPaint('metrics.panel_change', startedAt, { panel: service });
  }

  protected onCardWidthChange(value: string): void {
    const widthPx = Number(value);
    if (!Number.isFinite(widthPx) || widthPx <= 0) return;
    this.metricsSettingsService.setCardWidthPx(widthPx);
  }

  protected onCardHeightChange(value: string): void {
    const heightPx = Number(value);
    if (!Number.isFinite(heightPx) || heightPx <= 0) return;
    this.metricsSettingsService.setCardHeightPx(heightPx);
  }

  protected onCardExpandedHeightChange(value: string): void {
    const expandedHeightPx = Number(value);
    if (!Number.isFinite(expandedHeightPx) || expandedHeightPx <= 0) return;
    this.metricsSettingsService.setCardExpandedHeightPx(expandedHeightPx);
  }

  protected cycleCardLayoutMode(): void {
    const startedAt = performance.now();
    this.metricsSettingsService.cycleCardLayoutMode();
    void this.telemetry.recordAfterPaint('metrics.layout_change', startedAt, { kind: 'card_layout' });
  }

  protected cycleTooltipMode(): void {
    this.metricsSettingsService.cycleActiveTooltipMode();
  }

  protected onSyncCrosshairEnabledChange(value: boolean): void {
    this.metricsSettingsService.setSyncCrosshairEnabled(value);
    if (!value) {
      clearMetricSyncCrosshair();
    }
  }

  protected toggleForceZeroBaseline(): void {
    this.metricsSettingsService.setForceZeroBaselineEnabled(!this.forceZeroBaselineEnabled$$());
  }

  protected toggleAnomalyCorridorEnabled(): void {
    const startedAt = performance.now();
    this.metricsSettingsService.setAnomalyCorridorEnabled(!this.anomalyCorridorEnabled$$());
    void this.telemetry.recordAfterPaint('metrics.data_shape_change', startedAt, { kind: 'anomaly_corridor' });
  }

  protected onAnomalyCorridorPercentChange(rawValue: string): void {
    const value = Number(rawValue);
    if (!Number.isFinite(value) || value <= 0 || value > 100) return;
    this.metricsSettingsService.setAnomalyCorridorPercent(value);
  }

  protected onYTickCountCardChange(rawValue: string): void {
    const value = Number(rawValue);
    if (!Number.isInteger(value) || value < 0) return;
    this.metricsSettingsService.setYTickCountCard(value);
  }

  protected onYTickCountFullWidthChange(rawValue: string): void {
    const value = Number(rawValue);
    if (!Number.isInteger(value) || value < 0) return;
    this.metricsSettingsService.setYTickCountFullWidth(value);
  }

  protected onYTickSnapTolerancePercentChange(rawValue: string): void {
    const value = Number(rawValue);
    if (!Number.isFinite(value) || value <= 0) return;
    // Upper clamp (50%) lives in MetricsSettingsService — it's the same ceiling
    // the rounding search itself is built around, not just input sanitization.
    this.metricsSettingsService.setYTickSnapTolerancePercent(value);
  }

  protected saveSettings(): void {
    void this.metricsSettingsService.saveNow();
  }

  protected clearMetricsCache(): void {
    this.metricsService.clearCache();
  }

  protected forceRefreshMetrics(): void {
    this.metricsService.forceRefresh();
  }

  protected warnAfterSeconds(service: string): number {
    return this.metricsHealthService.severityThresholds(service).warnAfterSeconds;
  }

  protected errorAfterSeconds(service: string): number {
    return this.metricsHealthService.severityThresholds(service).errorAfterSeconds;
  }

  protected setWarnAfterSeconds(service: string, rawValue: string): void {
    const value = Number(rawValue);
    if (!Number.isFinite(value) || value < 0) return;
    const current = this.metricsHealthService.severityThresholds(service);
    this.metricsHealthService.setSeverityThresholds(service, { ...current, warnAfterSeconds: value });
  }

  protected setErrorAfterSeconds(service: string, rawValue: string): void {
    const value = Number(rawValue);
    if (!Number.isFinite(value) || value < 0) return;
    const current = this.metricsHealthService.severityThresholds(service);
    this.metricsHealthService.setSeverityThresholds(service, { ...current, errorAfterSeconds: value });
  }

  protected toggleDashboardMetric(service: string, name: string, enabled: boolean): void {
    const current = this.dashboardSelection$$();
    const serviceSelection = { ...current[service] };
    if (enabled) {
      serviceSelection[name] = this.nextDashboardOrder(service);
    } else {
      delete serviceSelection[name];
    }

    const next = { ...current };
    if (Object.keys(serviceSelection).length > 0) {
      next[service] = serviceSelection;
    } else {
      delete next[service];
    }
    this.metricsSettingsService.setDashboardSelection(next);

    if (enabled) {
      this.ensureDashboardServiceEnabled(service);
    }
  }

  protected setDashboardMetricOrder(service: string, name: string, order: number): void {
    const current = this.dashboardSelection$$();
    if (current[service]?.[name] === undefined) return;

    this.metricsSettingsService.setDashboardSelection({
      ...current,
      [service]: { ...current[service], [name]: order },
    });
  }

  protected setMetricChartMode(service: string, name: string, mode: MetricChartMode): void {
    const current = this.metricsSettingsService.metricChartModeOverrides$$();
    const serviceOverrides = { ...current[service] };
    if (mode === DEFAULT_METRIC_CHART_MODE) {
      delete serviceOverrides[name];
    } else {
      serviceOverrides[name] = mode;
    }

    const next = { ...current };
    if (Object.keys(serviceOverrides).length > 0) {
      next[service] = serviceOverrides;
    } else {
      delete next[service];
    }
    this.metricsSettingsService.setMetricChartModeOverrides(next);
  }

  protected toggleCardEditMode(): void {
    this.isCardEditMode$$.update((value) => !value);
  }

  protected isDashboardServiceEnabled(service: string): boolean {
    return this.dashboardServiceSelection$$()[service] !== undefined;
  }

  protected dashboardServiceOrder(service: string): number {
    return this.dashboardServiceSelection$$()[service] ?? 0;
  }

  protected toggleDashboardService(service: string, enabled: boolean): void {
    if (enabled) {
      this.ensureDashboardServiceEnabled(service);
      return;
    }

    const next = { ...this.dashboardServiceSelection$$() };
    delete next[service];
    this.metricsSettingsService.setDashboardServiceSelection(next);
  }

  protected setDashboardServiceOrder(service: string, rawValue: string): void {
    const order = Number(rawValue);
    if (!Number.isFinite(order)) return;

    const current = this.dashboardServiceSelection$$();
    if (current[service] === undefined) return;

    this.metricsSettingsService.setDashboardServiceSelection({ ...current, [service]: order });
  }

  // Sparse map: only explicit false (hidden) is stored, so a service is visible
  // by default the moment it's discovered, with nothing to migrate for old settings.
  protected isServiceVisibleInHeader(service: string): boolean {
    return this.metricsSettingsService.serviceHeaderVisibility$$()[service] !== false;
  }

  protected toggleServiceVisibleInHeader(service: string, visible: boolean): void {
    const current = this.metricsSettingsService.serviceHeaderVisibility$$();
    const next = { ...current };
    if (visible) {
      delete next[service];
    } else {
      next[service] = false;
    }
    this.metricsSettingsService.setServiceHeaderVisibility(next);
  }

  protected serviceCustomLabelShort(service: string): string {
    return this.metricsSettingsService.serviceCustomLabels$$()[service]?.short ?? '';
  }

  protected serviceCustomLabelLong(service: string): string {
    return this.metricsSettingsService.serviceCustomLabels$$()[service]?.long ?? '';
  }

  protected setServiceCustomLabelShort(service: string, value: string): void {
    this.metricsSettingsService.setServiceCustomLabel(service, { short: value });
  }

  protected setServiceCustomLabelLong(service: string, value: string): void {
    this.metricsSettingsService.setServiceCustomLabel(service, { long: value });
  }

  private nextDashboardOrder(service: string): number {
    const orders = Object.values(this.dashboardSelection$$()[service] ?? {});
    return orders.length > 0 ? Math.max(...orders) + 1 : 1;
  }

  private nextDashboardServiceOrder(): number {
    const orders = Object.values(this.dashboardServiceSelection$$());
    return orders.length > 0 ? Math.max(...orders) + 1 : 1;
  }

  private ensureDashboardServiceEnabled(service: string): void {
    const current = this.dashboardServiceSelection$$();
    if (current[service] !== undefined) return;
    this.metricsSettingsService.setDashboardServiceSelection({
      ...current,
      [service]: this.nextDashboardServiceOrder(),
    });
  }

  // Falls back to the Dashboard panel (not "first visible service") the moment the
  // expanded service is hidden from the header — Dashboard is the primary view now.
  // On mobile it's the ONLY panel — switching to a service panel is locked out
  // entirely (see toggleServiceExpanded), so this always wins regardless of
  // whatever expandedPanel$$ was left holding (e.g. from a resize).
  private resolvedExpandedPanel(): string {
    if (this.deviceInfoService.isMobileScreen$$()) {
      return DASHBOARD_PANEL_KEY;
    }

    const current = this.expandedPanel$$();
    if (current === DASHBOARD_PANEL_KEY) {
      return current;
    }
    if (current === COMPOSITE_SERVICE_KEY) {
      return this.isServiceVisibleInHeader(COMPOSITE_SERVICE_KEY) ? current : DASHBOARD_PANEL_KEY;
    }
    if (this.visibleServiceOptions$$().some((option) => option.service === current)) {
      return current;
    }
    return DASHBOARD_PANEL_KEY;
  }

  // Union of every metric COMPOSITE_METRIC_DEFINITIONS references — the same set
  // whether reached via the Dashboard rows or the standalone composite panel,
  // since composite cards have no per-card dashboard toggle (see the comment
  // on isDashboardEnabled in buildCompositeCard above).
  private compositeScopeEntries(): MetricsScopeEntry[] {
    const namesByService = new Map<string, Set<string>>();
    for (const definition of COMPOSITE_METRIC_DEFINITIONS) {
      if (!definition.metricName || !definition.serviceA || !definition.serviceB) continue;
      for (const service of [definition.serviceA, definition.serviceB]) {
        const names = namesByService.get(service) ?? new Set<string>();
        names.add(definition.metricName);
        namesByService.set(service, names);
      }
    }
    return Array.from(namesByService, ([service, names]) => ({ service, metricNames: Array.from(names) }));
  }

  private dashboardScopeEntries(): MetricsScopeEntry[] {
    const namesByService = new Map<string, Set<string>>();
    const addNames = (service: string, names: Iterable<string>): void => {
      const set = namesByService.get(service) ?? new Set<string>();
      for (const name of names) set.add(name);
      namesByService.set(service, set);
    };

    for (const [service, selection] of Object.entries(this.dashboardSelection$$())) {
      if (!this.isDashboardServiceEnabled(service)) continue;
      addNames(service, Object.keys(selection));
    }
    for (const entry of this.compositeScopeEntries()) {
      addNames(entry.service, entry.metricNames);
    }
    return Array.from(namesByService, ([service, names]) => ({ service, metricNames: Array.from(names) }));
  }
}
