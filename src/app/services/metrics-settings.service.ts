import { computed, Injectable, Signal, WritableSignal } from '@angular/core';
import { NamespaceSettingsStore } from '@app/services/settings/namespace-settings-store';
import { persistedSignal } from '@app/services/settings/persisted-signal';
import { DEFAULT_METRIC_CHART_MODE, MetricChartMode } from '@app/shared/metrics-chart-mode';
import { MAX_SNAP_TOLERANCE_RATIO } from '@app/shared/metrics-series';
import { SeverityThresholds } from '@app/shared/metrics-severity';
import { MetricGranularity } from '@app/shared/types';

export type DashboardMetricSelection = Record<string, Record<string, number>>;
export type DashboardServiceSelection = Record<string, number>;
export type SeverityThresholdsOverrides = Record<string, SeverityThresholds>;
export type ServiceHeaderVisibility = Record<string, boolean>;
export interface ServiceCustomLabel {
  short: string;
  long: string;
}
export type ServiceCustomLabels = Record<string, ServiceCustomLabel>;
export type MetricChartModeOverrides = Record<string, Record<string, MetricChartMode>>;

export const CardLayoutMode = {
  Compact: 'compact',
  Wide: 'wide',
} as const;
export type CardLayoutMode = (typeof CardLayoutMode)[keyof typeof CardLayoutMode];

export const TooltipMode = {
  Nearest: 'nearest',
  Vertical: 'vertical',
} as const;
export type TooltipMode = (typeof TooltipMode)[keyof typeof TooltipMode];

export interface CardSize {
  widthPx: number;
  heightPx: number;
  expandedHeightPx: number;
}

// Server-synced via a batched (explicit-save) namespace store — plan 11's "Save" button flow,
// unchanged, just riding the generic mechanism instead of a bespoke fetch/put pair.
interface StoredMetricsSettings {
  cardSize: CardSize;
  syncCrosshairEnabled: boolean;
  dashboardSelection: DashboardMetricSelection;
  dashboardServiceSelection: DashboardServiceSelection;
  metricChartModeOverrides: MetricChartModeOverrides;
  severityThresholds: SeverityThresholdsOverrides;
  serviceHeaderVisibility: ServiceHeaderVisibility;
  serviceCustomLabels: ServiceCustomLabels;
  // Percent of the value mass the anomaly corridor (Y-axis clamp, see
  // valueCorridor in metrics-series.ts) must keep visible — the only knob left
  // after simplifying this from a per-point Hampel/MAD outlier filter down to
  // a plain display-range trim.
  anomalyCorridorPercent: number;
}

const GRANULARITY_STORAGE_KEY = 'metrics_granularity';
const DEFAULT_GRANULARITY: MetricGranularity = 'minute';
const ACTIVE_CARD_LAYOUT_MODE_STORAGE_KEY = 'metrics_active_card_layout_mode';
const DEFAULT_CARD_LAYOUT_MODE: CardLayoutMode = CardLayoutMode.Compact;
const ACTIVE_TOOLTIP_MODE_STORAGE_KEY = 'metrics_active_tooltip_mode';
const DEFAULT_ACTIVE_TOOLTIP_MODE: TooltipMode = TooltipMode.Nearest;
const FORCE_ZERO_BASELINE_ENABLED_STORAGE_KEY = 'metrics_force_zero_baseline_enabled';
const DEFAULT_FORCE_ZERO_BASELINE_ENABLED = false;
const ANOMALY_CORRIDOR_ENABLED_STORAGE_KEY = 'metrics_anomaly_corridor_enabled';
const DEFAULT_ANOMALY_CORRIDOR_ENABLED = false;
const DEFAULT_ANOMALY_CORRIDOR_PERCENT = 95;
// Extra horizontal gridlines drawn between a chart's Y-axis min/max labels — see
// buildIntermediateYTicks in metrics-series.ts for how their values are chosen.
const Y_TICK_COUNT_CARD_STORAGE_KEY = 'metrics_y_tick_count_card';
const DEFAULT_Y_TICK_COUNT_CARD = 1;
const Y_TICK_COUNT_FULL_WIDTH_STORAGE_KEY = 'metrics_y_tick_count_full_width';
const DEFAULT_Y_TICK_COUNT_FULL_WIDTH = 2;
// How far a tick may drift from its ideal evenly-spaced position, as % of the axis's min..max
// span — see snapYTickValue in metrics-series.ts. Capped at MAX_SNAP_TOLERANCE_RATIO (50%):
// beyond that the drift already reaches the axis's own min/max, so there's nothing more to gain.
const Y_TICK_SNAP_TOLERANCE_PERCENT_STORAGE_KEY = 'metrics_y_tick_snap_tolerance_percent';
const DEFAULT_Y_TICK_SNAP_TOLERANCE_PERCENT = 5;
const MAX_Y_TICK_SNAP_TOLERANCE_PERCENT = MAX_SNAP_TOLERANCE_RATIO * 100;
const DEFAULT_CARD_WIDTH_PX = 304;
const DEFAULT_CARD_HEIGHT_PX = 112;
const DEFAULT_CARD_EXPANDED_HEIGHT_PX = 400;

const DEFAULT_CARD_SIZE: CardSize = {
  widthPx: DEFAULT_CARD_WIDTH_PX,
  heightPx: DEFAULT_CARD_HEIGHT_PX,
  expandedHeightPx: DEFAULT_CARD_EXPANDED_HEIGHT_PX,
};

const DEFAULTS: StoredMetricsSettings = {
  cardSize: DEFAULT_CARD_SIZE,
  syncCrosshairEnabled: false,
  dashboardSelection: {},
  dashboardServiceSelection: {},
  metricChartModeOverrides: {},
  severityThresholds: {},
  serviceHeaderVisibility: {},
  serviceCustomLabels: {},
  anomalyCorridorPercent: DEFAULT_ANOMALY_CORRIDOR_PERCENT,
};

@Injectable({
  providedIn: 'root',
})
export class MetricsSettingsService {
  private readonly store = new NamespaceSettingsStore<StoredMetricsSettings>('metrics', DEFAULTS);

  public readonly cardSize$$: Signal<CardSize> = computed(() => this.store.value$$().cardSize);
  public readonly syncCrosshairEnabled$$: Signal<boolean> = computed(() => this.store.value$$().syncCrosshairEnabled);
  public readonly anomalyCorridorPercent$$: Signal<number> = computed(
    () => this.store.value$$().anomalyCorridorPercent,
  );
  public readonly dashboardSelection$$: Signal<DashboardMetricSelection> = computed(
    () => this.store.value$$().dashboardSelection,
  );
  public readonly dashboardServiceSelection$$: Signal<DashboardServiceSelection> = computed(
    () => this.store.value$$().dashboardServiceSelection,
  );
  public readonly metricChartModeOverrides$$: Signal<MetricChartModeOverrides> = computed(
    () => this.store.value$$().metricChartModeOverrides,
  );
  public readonly severityThresholdOverrides$$: Signal<SeverityThresholdsOverrides> = computed(
    () => this.store.value$$().severityThresholds,
  );
  public readonly serviceHeaderVisibility$$: Signal<ServiceHeaderVisibility> = computed(
    () => this.store.value$$().serviceHeaderVisibility,
  );
  public readonly serviceCustomLabels$$: Signal<ServiceCustomLabels> = computed(
    () => this.store.value$$().serviceCustomLabels,
  );
  public readonly isSaving$$: WritableSignal<boolean> = this.store.isSaving$$;
  public readonly isDirty$$: Signal<boolean> = this.store.isDirty$$;

  // Device-local, never synced — unchanged from before this refactor, just riding the shared
  // persistedSignal primitive instead of hand-rolled "signal + write to localStorage" wiring.
  public readonly cardLayoutMode$$: WritableSignal<CardLayoutMode> = persistedSignal(
    ACTIVE_CARD_LAYOUT_MODE_STORAGE_KEY,
    DEFAULT_CARD_LAYOUT_MODE,
  );
  public readonly activeTooltipMode$$: WritableSignal<TooltipMode> = persistedSignal(
    ACTIVE_TOOLTIP_MODE_STORAGE_KEY,
    DEFAULT_ACTIVE_TOOLTIP_MODE,
  );
  public readonly granularity$$: WritableSignal<MetricGranularity> = persistedSignal(
    GRANULARITY_STORAGE_KEY,
    DEFAULT_GRANULARITY,
  );
  public readonly forceZeroBaselineEnabled$$: WritableSignal<boolean> = persistedSignal(
    FORCE_ZERO_BASELINE_ENABLED_STORAGE_KEY,
    DEFAULT_FORCE_ZERO_BASELINE_ENABLED,
  );
  public readonly anomalyCorridorEnabled$$: WritableSignal<boolean> = persistedSignal(
    ANOMALY_CORRIDOR_ENABLED_STORAGE_KEY,
    DEFAULT_ANOMALY_CORRIDOR_ENABLED,
  );
  public readonly yTickCountCard$$: WritableSignal<number> = persistedSignal(
    Y_TICK_COUNT_CARD_STORAGE_KEY,
    DEFAULT_Y_TICK_COUNT_CARD,
  );
  public readonly yTickCountFullWidth$$: WritableSignal<number> = persistedSignal(
    Y_TICK_COUNT_FULL_WIDTH_STORAGE_KEY,
    DEFAULT_Y_TICK_COUNT_FULL_WIDTH,
  );
  public readonly yTickSnapTolerancePercent$$: WritableSignal<number> = persistedSignal(
    Y_TICK_SNAP_TOLERANCE_PERCENT_STORAGE_KEY,
    DEFAULT_Y_TICK_SNAP_TOLERANCE_PERCENT,
  );

  public setCardWidthPx(value: number): void {
    this.updateCardSize({ widthPx: value });
  }

  public setCardHeightPx(value: number): void {
    this.updateCardSize({ heightPx: value });
  }

  public setCardExpandedHeightPx(value: number): void {
    this.updateCardSize({ expandedHeightPx: value });
  }

  public setCardLayoutMode(mode: CardLayoutMode): void {
    this.cardLayoutMode$$.set(mode);
  }

  public cycleCardLayoutMode(): void {
    this.setCardLayoutMode(
      this.cardLayoutMode$$() === CardLayoutMode.Compact ? CardLayoutMode.Wide : CardLayoutMode.Compact,
    );
  }

  public setActiveTooltipMode(mode: TooltipMode): void {
    this.activeTooltipMode$$.set(mode);
  }

  public cycleActiveTooltipMode(): void {
    this.setActiveTooltipMode(
      this.activeTooltipMode$$() === TooltipMode.Nearest ? TooltipMode.Vertical : TooltipMode.Nearest,
    );
  }

  public setGranularity(value: MetricGranularity): void {
    this.granularity$$.set(value);
  }

  public setSyncCrosshairEnabled(value: boolean): void {
    this.store.stage('syncCrosshairEnabled', value);
  }

  public setForceZeroBaselineEnabled(value: boolean): void {
    this.forceZeroBaselineEnabled$$.set(value);
  }

  public setAnomalyCorridorEnabled(value: boolean): void {
    this.anomalyCorridorEnabled$$.set(value);
  }

  public setAnomalyCorridorPercent(value: number): void {
    this.store.stage('anomalyCorridorPercent', value);
  }

  public setYTickCountCard(value: number): void {
    this.yTickCountCard$$.set(value);
  }

  public setYTickCountFullWidth(value: number): void {
    this.yTickCountFullWidth$$.set(value);
  }

  public setYTickSnapTolerancePercent(value: number): void {
    const clamped = Math.min(value, MAX_Y_TICK_SNAP_TOLERANCE_PERCENT);
    // Skips the write once already at the ceiling — holding the input's increment key past 50%
    // would otherwise keep re-triggering every visible chart's tick recompute for no visual change.
    if (clamped === this.yTickSnapTolerancePercent$$()) return;
    this.yTickSnapTolerancePercent$$.set(clamped);
  }

  public setDashboardSelection(value: DashboardMetricSelection): void {
    this.store.stage('dashboardSelection', value);
  }

  public setDashboardServiceSelection(value: DashboardServiceSelection): void {
    this.store.stage('dashboardServiceSelection', value);
  }

  public setMetricChartModeOverrides(value: MetricChartModeOverrides): void {
    this.store.stage('metricChartModeOverrides', value);
  }

  public metricChartMode(service: string, name: string): MetricChartMode {
    return this.metricChartModeOverrides$$()[service]?.[name] ?? DEFAULT_METRIC_CHART_MODE;
  }

  public setSeverityThresholdOverrides(value: SeverityThresholdsOverrides): void {
    this.store.stage('severityThresholds', value);
  }

  public setServiceHeaderVisibility(value: ServiceHeaderVisibility): void {
    this.store.stage('serviceHeaderVisibility', value);
  }

  public setServiceCustomLabels(value: ServiceCustomLabels): void {
    this.store.stage('serviceCustomLabels', value);
  }

  public setServiceCustomLabel(service: string, patch: Partial<ServiceCustomLabel>): void {
    const current = this.serviceCustomLabels$$();
    const existing = current[service];
    const merged: ServiceCustomLabel = { short: existing?.short ?? '', long: existing?.long ?? '', ...patch };

    const next = { ...current };
    if (merged.short.trim() || merged.long.trim()) {
      next[service] = merged;
    } else {
      delete next[service];
    }
    this.setServiceCustomLabels(next);
  }

  public async saveNow(): Promise<void> {
    return this.store.saveNow();
  }

  private updateCardSize(patch: Partial<CardSize>): void {
    this.store.stage('cardSize', { ...this.cardSize$$(), ...patch });
  }
}
