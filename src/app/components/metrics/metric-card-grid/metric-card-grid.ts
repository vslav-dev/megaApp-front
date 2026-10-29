import {
  Component,
  computed,
  effect,
  ElementRef,
  inject,
  input,
  OnDestroy,
  OnInit,
  output,
  Signal,
  signal,
} from '@angular/core';
import { MetricCardExpansionService } from '@app/services/metric-card-expansion.service';
import { CardLayoutMode, TooltipMode } from '@app/services/metrics-settings.service';
import { MetricUnit } from '@app/shared/metric-units';
import { MetricChartMode } from '@app/shared/metrics-chart-mode';
import { MetricSeriesPoint } from '@app/shared/metrics-series';
import { MetricGranularity } from '@app/shared/types';
import { fitColumnsToWidth } from '@app/shared/utils';
import { MetricChartCard } from '../metric-chart-card/metric-chart-card';

export interface MetricChartCardSeriesDisplay {
  series: MetricSeriesPoint[];
  // What the Y-axis range and the header's high/low are measured on — always the raw points of
  // the granularity, never the display-collapsed ones, so the fitted 5-minute card and the
  // full-width minute chart of one metric show the same floor and ceiling.
  scalePoints: MetricSeriesPoint[];
  windowStartBucket: number;
  windowEndBucket: number;
  displayStepSeconds: number;
}

export interface MetricChartCardData {
  key: string;
  label: string;
  technicalName: string;
  // Reactive: each of these is its own independent signal (see metrics-dashboard.ts's
  // CardLiveSignals/regularCardLive), so binding to one in a template subscribes to
  // just that card's own data — a data tick for one metric never re-evaluates a
  // binding that reads a different card's signal. See
  // plans/35-metrics-dashboard-viewport-rendering.implementation-plan.md §2.2-§2.3.
  value: Signal<number>;
  displayValue: Signal<string>;
  unit: MetricUnit;
  granularity: Signal<MetricGranularity>;
  color: string;
  chartMode: Signal<MetricChartMode>;
  description: string;
  // Two independently-built series, always both present: the fitted-to-columns
  // display (5-minute buckets) and the full-width display (raw per-minute). Which
  // one a given card shows is a render-time decision (is this card the one
  // expanded by click, or is the whole grid in Wide layout mode) — not a width
  // comparison, since a card's rendered width alone doesn't say which role it's in.
  display: Signal<MetricChartCardSeriesDisplay>;
  fullWidthDisplay: Signal<MetricChartCardSeriesDisplay>;
  isDashboardEnabled: boolean;
  dashboardOrder: number;
}

interface RenderItem {
  card: MetricChartCardData;
  isExpanded: boolean;
}

const EMPTY_KEY_SET: ReadonlySet<string> = new Set();

@Component({
  selector: 'metric-card-grid',
  templateUrl: './metric-card-grid.html',
  imports: [MetricChartCard],
  host: {
    class: 'grid gap-3',
    '[style.grid-template-columns]': 'gridTemplateColumns$$()',
  },
})
export class MetricCardGrid implements OnInit, OnDestroy {
  public readonly cardsInput = input.required<MetricChartCardData[]>();
  public readonly targetWidthPxInput = input.required<number>();
  public readonly heightPxInput = input.required<number>();
  public readonly expandedHeightPxInput = input.required<number>();
  public readonly layoutModeInput = input.required<CardLayoutMode>();
  public readonly syncCrosshairEnabledInput = input<boolean>(false);
  public readonly forceZeroBaselineInput = input<boolean>(false);
  public readonly anomalyCorridorEnabledInput = input<boolean>(false);
  public readonly anomalyCorridorPercentInput = input<number>(95);
  public readonly yTickCountCardInput = input<number>(1);
  public readonly yTickCountFullWidthInput = input<number>(2);
  public readonly yTickSnapTolerancePercentInput = input<number>(5);
  public readonly tooltipModeInput = input<TooltipMode>(TooltipMode.Nearest);
  public readonly isEditModeInput = input<boolean>(false);
  public readonly hideDashboardControlsInput = input<boolean>(false);
  public readonly isSelectionDisabledInput = input<boolean>(false);

  public readonly cardDashboardEnabledChangeOutput = output<{ technicalName: string; enabled: boolean }>();
  public readonly cardDashboardOrderChangeOutput = output<{ technicalName: string; order: number }>();
  public readonly cardChartModeChangeOutput = output<{ technicalName: string; chartMode: MetricChartMode }>();

  private readonly expansionService = inject(MetricCardExpansionService);
  private readonly hostElement = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;
  private readonly containerWidthPx$$ = signal(0);
  private readonly gapPx$$ = signal(0);
  private resizeObserver: ResizeObserver | null = null;

  // How many columns fit this container: in Wide mode always 1 (every card gets its own
  // full-width row, regardless of how much room there is). In Compact mode, delegates to the
  // shared fit-N-columns-to-target-width algorithm (also used by food-screen's diary/stats grid).
  protected readonly columnCount$$ = computed(() => {
    if (this.layoutModeInput() === CardLayoutMode.Wide) return 1;
    return fitColumnsToWidth(this.containerWidthPx$$(), this.targetWidthPxInput(), this.gapPx$$());
  });

  // Column tracks are rendered as native CSS grid columns rather than a per-card
  // JS-computed pixel width — the browser then resizes them synchronously with
  // the container on every reflow, with no JS/ResizeObserver round-trip in the
  // way. Only the discrete column count (columnCount$$, changed rarely) goes
  // through JS; the continuous in-between resizing is entirely native.
  // minmax(0, 1fr) instead of a bare 1fr guards against a track being forced
  // wider than its share by a card's own content (e.g. the chart canvas).
  protected readonly gridTemplateColumns$$ = computed(() => `repeat(${this.columnCount$$()}, minmax(0, 1fr))`);

  // Expanding only makes sense with at least two columns — with one column, the
  // "expanded" copy would be identical to the row card it sits under.
  protected readonly canExpand$$ = computed(() => this.columnCount$$() >= 2);

  // The single source of truth for "which of this grid's own cards are
  // expanded right now" — empty whenever expanding isn't possible, so callers
  // never need to re-check canExpand$$ themselves. Filtered down from the
  // service's page-wide set to this grid's own cards, since a card key
  // belongs to exactly one grid.
  protected readonly selectedKeys$$ = computed<ReadonlySet<string>>(() => {
    if (!this.canExpand$$()) return EMPTY_KEY_SET;
    const ownKeys = new Set(this.cardsInput().map((card) => card.key));
    const expanded = new Set<string>();
    for (const key of this.expansionService.expandedKeys$$()) {
      if (ownKeys.has(key)) expanded.add(key);
    }
    return expanded;
  });

  // Once this grid drops below 2 columns, expanding stops being meaningful here —
  // forget this grid's own expanded cards (other grids' expanded cards are untouched).
  private readonly resetExpandedOnDisableEffect = effect(() => {
    if (this.canExpand$$()) return;
    this.expansionService.collapseKeys(this.cardsInput().map((card) => card.key));
  });

  // Every expanded card is inserted right after the last card of the row that
  // contains it, in the row's own left-to-right order — so clicking several
  // cards in the same row stacks their large charts, in that order, directly
  // under the row, regardless of how many columns fit at the current width.
  protected readonly renderItems$$ = computed<RenderItem[]>(() => {
    const cards = this.cardsInput();
    const expandedKeys = this.selectedKeys$$();
    if (expandedKeys.size === 0) {
      return cards.map((card) => ({ card, isExpanded: false }));
    }

    const columns = this.columnCount$$();
    const items: RenderItem[] = [];
    for (let index = 0; index < cards.length; index++) {
      items.push({ card: cards[index], isExpanded: false });

      const isRowEnd = (index + 1) % columns === 0 || index === cards.length - 1;
      if (!isRowEnd) continue;

      const rowStart = index - (index % columns);
      for (let rowCardIndex = rowStart; rowCardIndex <= index; rowCardIndex++) {
        if (expandedKeys.has(cards[rowCardIndex].key)) {
          items.push({ card: cards[rowCardIndex], isExpanded: true });
        }
      }
    }
    return items;
  });

  public ngOnInit(): void {
    this.gapPx$$.set(parseFloat(getComputedStyle(this.hostElement).columnGap) || 0);
    // ResizeObserver's first callback is async (next frame at the earliest), so on a
    // fresh mount containerWidthPx$$ would otherwise sit at its 0 default for that
    // frame — fitColumnsToWidth(0, ...) returns 1, so the grid briefly renders as a
    // single full-width column before snapping to the real column count. Reading the
    // width synchronously here (forces a layout, but only once, on init) closes that gap.
    this.containerWidthPx$$.set(this.hostElement.getBoundingClientRect().width);
    this.resizeObserver = new ResizeObserver(([entry]) => {
      this.containerWidthPx$$.set(entry.contentRect.width);
    });
    this.resizeObserver.observe(this.hostElement);
  }

  public ngOnDestroy(): void {
    this.resizeObserver?.disconnect();
    this.resizeObserver = null;
  }

  protected trackRenderItem(item: RenderItem): string {
    return item.isExpanded ? `expanded:${item.card.key}` : item.card.key;
  }

  // Full-width role covers both the card expanded by click and, in Wide mode,
  // every normal card — a normal Compact-mode card that happens to land on one
  // column (e.g. a narrow phone screen) still keeps the fitted (5-minute) display,
  // since it's the layout mode and click state that decide the role, not the
  // pixel width a card happens to render at.
  protected isFullWidthRole(item: RenderItem): boolean {
    return item.isExpanded || this.layoutModeInput() === CardLayoutMode.Wide;
  }

  protected cardDisplay(item: RenderItem): MetricChartCardSeriesDisplay {
    return this.isFullWidthRole(item) ? item.card.fullWidthDisplay() : item.card.display();
  }

  protected cardHeightPx(item: RenderItem): number {
    return this.isFullWidthRole(item) ? this.expandedHeightPxInput() : this.heightPxInput();
  }

  // The expanded card spans every column (its own full-width row); normal cards
  // take the single column the grid auto-places them into.
  protected cardGridColumn(item: RenderItem): string | null {
    return item.isExpanded ? '1 / -1' : null;
  }

  protected onCardToggle(key: string): void {
    if (!this.canExpand$$()) return;
    this.expansionService.toggle(key);
  }

  protected onCardDashboardEnabledChange(technicalName: string, enabled: boolean): void {
    this.cardDashboardEnabledChangeOutput.emit({ technicalName, enabled });
  }

  protected onCardDashboardOrderChange(technicalName: string, order: number): void {
    this.cardDashboardOrderChangeOutput.emit({ technicalName, order });
  }

  protected onCardChartModeChange(technicalName: string, chartMode: MetricChartMode): void {
    this.cardChartModeChangeOutput.emit({ technicalName, chartMode });
  }
}
