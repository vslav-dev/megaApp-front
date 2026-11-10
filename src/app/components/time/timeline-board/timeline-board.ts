import { NgTemplateOutlet } from '@angular/common';
import {
  Component,
  DestroyRef,
  ElementRef,
  Injector,
  afterNextRender,
  computed,
  effect,
  inject,
  input,
  signal,
  viewChild,
} from '@angular/core';
import { TimeCatalogueService } from '@app/services/time/time-catalogue.service';
import { TimeDisplayPrefsService } from '@app/services/time/time-display-prefs.service';
import { isConfirmedEntry, TimeDayLanes, TimeEntriesService } from '@app/services/time/time-entries.service';
import { ActivityKind, CategoryOption, TimeEntry, TimeTrack } from '@app/shared/time-types';
import { parseIsoParts } from '@app/shared/utils';
import { computeTooltipPosition } from '@ui-kit/components/v-tooltip/tooltip-position';
import { VTopLayerDirective } from '@ui-kit/directives/top-layer.directive';
import {
  StructuredActivityPicker,
  StructuredActivitySelection,
} from '@app/components/time/structured-activity-picker/structured-activity-picker';
import { SegmentLabel } from './segment-label/segment-label';

const MINUTES_PER_DAY = 1440;
const MIN_DURATION_MINUTES = 10;
const DEFAULT_DURATION_MINUTES = 60;
const INITIAL_VISIBLE_DAYS = 45;
const OLDER_DAYS_BATCH = 30;
const LOAD_OLDER_SCROLL_TOP_PX = 240;
// Must match .day-row's border-bottom (1px) and --row-gap (--unit-2 = 8px, 0 in compact mode).
const ROW_BORDER_PX = 1;
const ROW_GAP_PX = 8;
const VIRTUALIZATION_BUFFER_PX = 800;
const HOUR_TICKS = [0, 3, 6, 9, 12, 15, 18, 21, 24] as const;
const GRID_LINE_HOURS = Array.from({ length: 23 }, (_, i) => i + 1);
const SHORT_SEGMENT_MINUTES = 120;

interface SegmentGridLine {
  hour: number;
  leftPct: number;
  major: boolean;
}

interface Segment {
  entry: TimeEntry;
  startMinute: number;
  endMinute: number;
  isTrueStart: boolean;
  isTrueEnd: boolean;
  startClock: string;
  endClock: string;
  durationLabel: string;
  label: string;
  color: string;
  gridLines: SegmentGridLine[];
}

interface ActiveAdjustment {
  entryId: number;
  entry: TimeEntry;
  track: TimeTrack;
  startAbs: number;
  endAbs: number;
}

interface PreviewSlot {
  dayIso: string;
  track: TimeTrack;
  leftPct: number;
  widthPct: number;
}

type PickerState =
  | { mode: 'create'; dayIso: string; track: TimeTrack; startMinute: number; endMinute: number; x: number; y: number }
  | { mode: 'edit'; entryId: number; x: number; y: number };

interface DayLabel {
  weekday: string;
  month: string;
  day: string;
  year: string;
}

interface HoveredSegment {
  text: string;
  triggerRect: DOMRect;
}

@Component({
  selector: 'timeline-board',
  templateUrl: './timeline-board.html',
  styleUrl: './timeline-board.scss',
  imports: [NgTemplateOutlet, SegmentLabel, StructuredActivityPicker, VTopLayerDirective],
})
export class TimelineBoard {
  public readonly snapMinutesInput = input<number>(15);

  protected readonly Track = TimeTrack;
  protected readonly hourTicks = HOUR_TICKS;
  protected readonly gridLineHours = GRID_LINE_HOURS;

  private readonly timelineScrollElem = viewChild<ElementRef<HTMLDivElement>>('timelineScrollElem');
  private readonly tooltipPanelElem = viewChild<ElementRef<HTMLDivElement>>('tooltipPanelElem');
  private readonly injector = inject(Injector);
  private readonly destroyRef = inject(DestroyRef);
  private readonly timeEntriesService = inject(TimeEntriesService);
  private readonly timeCatalogueService = inject(TimeCatalogueService);
  protected readonly timeDisplayPrefsService = inject(TimeDisplayPrefsService);

  // Single shared tooltip for the whole board instead of one v-tooltip component
  // per segment — hundreds of segments used to mean hundreds of components, each
  // with its own document:click listener and top-layer popover.
  protected readonly hoveredSegment$$ = signal<HoveredSegment | null>(null);
  protected readonly tooltipPlacement$$ = signal<'top' | 'bottom'>('top');
  protected readonly isTooltipPositioned$$ = signal(false);
  protected readonly tooltipTopPx$$ = signal(0);
  protected readonly tooltipLeftPx$$ = signal(0);

  protected readonly isLoaded$$ = computed(() => this.timeEntriesService.isLoaded$$());
  private readonly todayDayNumber = this.dayIsoToDayNumber(this.todayIso());
  // Renders one day beyond today so a late-evening entry (e.g. started 23:00) can be
  // dragged/resized past midnight into a visible "tomorrow" lane.
  private readonly lastVisibleDayNumber = this.todayDayNumber + 1;
  private readonly currentYear = new Date().getFullYear();
  protected readonly visibleStartDayNumber$$ = signal(this.lastVisibleDayNumber - INITIAL_VISIBLE_DAYS + 1);

  protected readonly days$$ = computed<string[]>(() => {
    const days: string[] = [];
    for (let dayNumber = this.visibleStartDayNumber$$(); dayNumber <= this.lastVisibleDayNumber; dayNumber++) {
      days.push(this.dayNumberToDayIso(dayNumber));
    }
    return days;
  });

  // Windowed rendering: only day-rows within the viewport (+ buffer) actually mount —
  // days$$() can grow into the hundreds as older days load, but the DOM must not.
  protected readonly scrollTop$$ = signal(0);
  private readonly scrollContainerHeightPx$$ = signal(600);
  private readonly setupContainerResizeObserver = afterNextRender(() => {
    const scrollEl = this.timelineScrollElem()?.nativeElement;
    if (!scrollEl) return;
    this.scrollContainerHeightPx$$.set(scrollEl.clientHeight);
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (entry) this.scrollContainerHeightPx$$.set(entry.contentRect.height);
    });
    observer.observe(scrollEl);
    this.destroyRef.onDestroy(() => observer.disconnect());
  });

  // Native passive listener instead of an Angular (scroll) template binding — a
  // template binding marks the view dirty on every single scroll event.
  // rAF-coalescing caps the signal writes that drive the view to once per frame.
  private readonly setupScrollListener = afterNextRender(() => {
    const scrollEl = this.timelineScrollElem()?.nativeElement;
    if (!scrollEl) return;

    let pendingScrollTop: number | null = null;
    let rafScheduled = false;
    const flushScroll = () => {
      rafScheduled = false;
      if (pendingScrollTop === null) return;
      const scrollTop = pendingScrollTop;
      pendingScrollTop = null;
      this.handleScrollTop(scrollEl, scrollTop);
    };

    const onScroll = () => {
      pendingScrollTop = scrollEl.scrollTop;
      if (!rafScheduled) {
        rafScheduled = true;
        requestAnimationFrame(flushScroll);
      }
    };

    scrollEl.addEventListener('scroll', onScroll, { passive: true });
    this.destroyRef.onDestroy(() => scrollEl.removeEventListener('scroll', onScroll));
  });

  private readonly rowHeightPx$$ = computed(() => {
    const gap = this.timeDisplayPrefsService.compactMode$$() ? 0 : ROW_GAP_PX;
    return (
      this.timeDisplayPrefsService.primaryHeightPx$$() +
      this.timeDisplayPrefsService.secondaryHeightPx$$() +
      ROW_BORDER_PX +
      gap
    );
  });

  private readonly visibleRowRange$$ = computed(() => {
    const rowHeight = this.rowHeightPx$$();
    const total = this.days$$().length;
    const scrollTop = this.scrollTop$$();
    const viewport = this.scrollContainerHeightPx$$();
    const startIndex = Math.max(0, Math.floor((scrollTop - VIRTUALIZATION_BUFFER_PX) / rowHeight));
    const endIndex = Math.min(total, Math.ceil((scrollTop + viewport + VIRTUALIZATION_BUFFER_PX) / rowHeight));
    return { startIndex, endIndex };
  });

  protected readonly visibleDays$$ = computed(() => {
    const { startIndex, endIndex } = this.visibleRowRange$$();
    return this.days$$().slice(startIndex, endIndex);
  });

  protected readonly paddingTopPx$$ = computed(() => this.visibleRowRange$$().startIndex * this.rowHeightPx$$());

  protected readonly paddingBottomPx$$ = computed(() => {
    const { endIndex } = this.visibleRowRange$$();
    return (this.days$$().length - endIndex) * this.rowHeightPx$$();
  });

  protected readonly shouldShowYearColumn$$ = computed(() => {
    const startYear = new Date(this.visibleStartDayNumber$$() * 86_400_000).getFullYear();
    return startYear !== this.currentYear;
  });

  protected readonly activeAdjustment$$ = signal<ActiveAdjustment | null>(null);
  protected readonly previewSlot$$ = signal<PreviewSlot | null>(null);
  protected readonly pickerState$$ = signal<PickerState | null>(null);
  protected readonly isInitialScrollReady$$ = signal(false);

  private hasScrolledToInitialBottom = false;
  private isPrependingDays = false;
  private readonly initialBottomScrollEffect$$ = effect(() => {
    if (!this.isLoaded$$() || this.hasScrolledToInitialBottom) return;
    this.scrollToBottomAfterRender();
  });

  protected isWeekend(dayIso: string): boolean {
    const [year, month, day] = parseIsoParts(dayIso);
    const weekday = new Date(year, month - 1, day).getDay();
    return weekday === 0 || weekday === 6;
  }

  protected dayLabel(dayIso: string): DayLabel {
    const [year, month, day] = parseIsoParts(dayIso);
    const date = new Date(year, month - 1, day);
    return {
      weekday: date.toLocaleDateString('en-US', { weekday: 'short' }),
      month: date.toLocaleDateString('en-US', { month: 'short' }),
      day: String(day),
      year: String(year),
    };
  }

  protected hourLeftPct(hour: number): number {
    return (hour / 24) * 100;
  }

  protected isMajorGridHour(hour: number): boolean {
    return hour % 3 === 0;
  }

  // Base segments (label/color/gridLines precomputed) keyed by "dayIso:track" —
  // depends only on entries + catalogue, NOT on activeAdjustment$$/pickerState$$/
  // hoveredSegment$$. Those change often (every drag pointermove, every picker
  // open/close) and used to force a full label/color/gridline recompute across
  // every visible segment on each such change — this decouples the two.
  private readonly segmentsBaseByDayTrack$$ = computed<Map<string, Segment[]>>(() => {
    const index = this.timeEntriesService.entriesByDay$$();
    const activityKindById = this.timeCatalogueService.activityKindById$$();
    const optionById = this.timeCatalogueService.optionById$$();
    const areaGroupId = this.timeCatalogueService.areaGroupId$$();

    // A day contributes segments to itself and, for entries crossing midnight,
    // to the following day too — so the map must cover both for every loaded day.
    const relevantDays = new Set<string>();
    for (const dayIso of index.keys()) {
      relevantDays.add(dayIso);
      relevantDays.add(this.dayNumberToDayIso(this.dayIsoToDayNumber(dayIso) + 1));
    }

    const map = new Map<string, Segment[]>();
    for (const dayIso of relevantDays) {
      for (const track of [TimeTrack.Primary, TimeTrack.Secondary] as const) {
        map.set(
          this.dayTrackKey(dayIso, track),
          this.buildDaySegmentsBase(dayIso, track, index, activityKindById, optionById, areaGroupId),
        );
      }
    }
    return map;
  });

  private buildDaySegmentsBase(
    dayIso: string,
    track: TimeTrack,
    index: Map<string, TimeDayLanes>,
    activityKindById: Map<number, ActivityKind>,
    optionById: Map<number, CategoryOption>,
    areaGroupId: number | null,
  ): Segment[] {
    const segments: Segment[] = [];

    const ownLanes = index.get(dayIso);
    for (const entry of ownLanes?.[track] ?? []) {
      const crossesMidnight = entry.endAt.slice(0, 10) !== dayIso;
      const startMinute = this.minutesOfDay(entry.startAt);
      const endMinute = crossesMidnight ? MINUTES_PER_DAY : this.minutesOfDay(entry.endAt);
      segments.push({
        entry,
        startMinute,
        endMinute,
        isTrueStart: true,
        isTrueEnd: !crossesMidnight,
        startClock: this.formatClock(entry.startAt),
        endClock: this.formatClock(entry.endAt),
        durationLabel: this.durationLabel(this.toAbsoluteMinutes(entry.startAt), this.toAbsoluteMinutes(entry.endAt)),
        label: this.computeSegmentLabel(entry, activityKindById, optionById),
        color: this.computeSegmentColor(entry, optionById, areaGroupId),
        gridLines: this.buildGridLines(startMinute, endMinute),
      });
    }

    const previousDayIso = this.dayNumberToDayIso(this.dayIsoToDayNumber(dayIso) - 1);
    const previousLanes = index.get(previousDayIso);
    for (const entry of previousLanes?.[track] ?? []) {
      if (entry.endAt.slice(0, 10) !== dayIso) continue;
      const endMinute = this.minutesOfDay(entry.endAt);
      segments.push({
        entry,
        startMinute: 0,
        endMinute,
        isTrueStart: false,
        isTrueEnd: true,
        startClock: this.formatClock(entry.startAt),
        endClock: this.formatClock(entry.endAt),
        durationLabel: this.durationLabel(this.toAbsoluteMinutes(entry.startAt), this.toAbsoluteMinutes(entry.endAt)),
        label: this.computeSegmentLabel(entry, activityKindById, optionById),
        color: this.computeSegmentColor(entry, optionById, areaGroupId),
        gridLines: this.buildGridLines(0, endMinute),
      });
    }

    return segments.sort((a, b) => a.startMinute - b.startMinute);
  }

  private dayTrackKey(dayIso: string, track: TimeTrack): string {
    return `${dayIso}:${track}`;
  }

  // Hour grid lines that fall strictly inside a segment's own span, in
  // percentages local to the segment's box — lets the grid line render in
  // white on top of the segment while the shared full-lane lines underneath
  // stay their usual muted gray on the empty canvas.
  private buildGridLines(startMinute: number, endMinute: number): SegmentGridLine[] {
    const duration = endMinute - startMinute;
    return this.gridLineHours
      .filter((hour) => hour * 60 > startMinute && hour * 60 < endMinute)
      .map((hour) => ({
        hour,
        leftPct: ((hour * 60 - startMinute) / duration) * 100,
        major: this.isMajorGridHour(hour),
      }));
  }

  // Thin per-render assembly: base segments come straight out of the memoized
  // map above (O(1) lookup); only the one actively-dragged segment (if any) is
  // rebuilt fresh here, since its start/end genuinely change every pointermove.
  protected segmentsFor(dayIso: string, track: TimeTrack): Segment[] {
    const base = this.segmentsBaseByDayTrack$$().get(this.dayTrackKey(dayIso, track)) ?? [];
    const adjustment = this.activeAdjustment$$();
    if (!adjustment || adjustment.track !== track) return base;

    const withoutDragged = base.filter((segment) => segment.entry.id !== adjustment.entryId);
    const dayAbsBase = this.dayIsoToDayNumber(dayIso) * MINUTES_PER_DAY;
    const segStart = Math.max(adjustment.startAbs, dayAbsBase);
    const segEnd = Math.min(adjustment.endAbs, dayAbsBase + MINUTES_PER_DAY);
    if (segStart >= segEnd) return withoutDragged;

    const overlay = this.buildAdjustmentSegment(adjustment, dayAbsBase, segStart, segEnd);
    return [...withoutDragged, overlay].sort((a, b) => a.startMinute - b.startMinute);
  }

  private buildAdjustmentSegment(
    adjustment: ActiveAdjustment,
    dayAbsBase: number,
    segStart: number,
    segEnd: number,
  ): Segment {
    const entry = adjustment.entry;
    const startMinute = segStart - dayAbsBase;
    const endMinute = segEnd - dayAbsBase;
    return {
      entry,
      startMinute,
      endMinute,
      isTrueStart: segStart === adjustment.startAbs,
      isTrueEnd: segEnd === adjustment.endAbs,
      startClock: this.clockFromAbsMinutes(adjustment.startAbs),
      endClock: this.clockFromAbsMinutes(adjustment.endAbs),
      durationLabel: this.durationLabel(adjustment.startAbs, adjustment.endAbs),
      label: this.computeSegmentLabel(
        entry,
        this.timeCatalogueService.activityKindById$$(),
        this.timeCatalogueService.optionById$$(),
      ),
      color: this.computeSegmentColor(
        entry,
        this.timeCatalogueService.optionById$$(),
        this.timeCatalogueService.areaGroupId$$(),
      ),
      gridLines: this.buildGridLines(startMinute, endMinute),
    };
  }

  protected segmentStyle(segment: Segment): Record<string, string> {
    return {
      left: `${(segment.startMinute / MINUTES_PER_DAY) * 100}%`,
      width: `${((segment.endMinute - segment.startMinute) / MINUTES_PER_DAY) * 100}%`,
    };
  }

  protected isShortSegment(segment: Segment): boolean {
    return segment.endMinute - segment.startMinute < SHORT_SEGMENT_MINUTES;
  }

  // Secondary segments look "lighter" via an alpha-blended background rather
  // than element opacity — opacity would cascade to descendants (including
  // the tooltip's fixed-position panel), making the tooltip translucent too.
  protected segmentBackground(segment: Segment, secondary: boolean): string {
    return secondary ? `color-mix(in oklab, ${segment.color} 75%, transparent)` : segment.color;
  }

  // Segment label: kind name, plus a short list of selected option names —
  // `.seg-name` already has CSS text-overflow ellipsis, so when space is
  // tight the tail (options) is clipped and only the kind stays visible,
  // matching "если места мало, показывать только kind" without extra logic.
  private computeSegmentLabel(
    entry: TimeEntry,
    activityKindById: Map<number, ActivityKind>,
    optionById: Map<number, CategoryOption>,
  ): string {
    const kindName = activityKindById.get(entry.activityKindId)?.name ?? '…';
    const optionNames = entry.options
      .map((option) => optionById.get(option.optionId)?.name)
      .filter((name): name is string => !!name);
    return optionNames.length > 0 ? `${kindName} · ${optionNames.join(', ')}` : kindName;
  }

  // Tooltip text: same content the fully-expanded segment label shows
  // (disclosure level 3) — kind, options, duration, start–end — regardless
  // of how little of it actually fits inside the segment box itself.
  protected segmentTooltipText(segment: Segment): string {
    const arrowL = segment.isTrueStart ? '' : '◂ ';
    const arrowR = segment.isTrueEnd ? '' : ' ▸';
    return `${arrowL}${segment.label} · ${segment.durationLabel} · ${segment.startClock}–${segment.endClock}${arrowR}`;
  }

  // Color priority: selected option of the kind='area' group, else the first
  // selected option that has a color, else a neutral fallback.
  private computeSegmentColor(
    entry: TimeEntry,
    optionById: Map<number, CategoryOption>,
    areaGroupId: number | null,
  ): string {
    if (areaGroupId !== null) {
      const areaSelection = entry.options.find((option) => option.groupId === areaGroupId);
      const areaColor = areaSelection ? optionById.get(areaSelection.optionId)?.color : null;
      if (areaColor) return areaColor;
    }
    for (const selected of entry.options) {
      const color = optionById.get(selected.optionId)?.color;
      if (color) return color;
    }
    return '#868E96';
  }

  protected editingEntry(entryId: number): TimeEntry | undefined {
    return this.timeEntriesService.entries$$().find((entry) => entry.id === entryId);
  }

  // An entry whose create the server hasn't confirmed yet has no real id to address — it can't be
  // moved, resized, edited or deleted until it has one.
  protected onSegmentPointerDown(event: PointerEvent, entry: TimeEntry): void {
    this.closeTooltip();
    const target = event.target as HTMLElement;
    if (target.closest('.handle') || target.closest('.seg-delete')) return;
    if (!isConfirmedEntry(entry)) return;
    this.startMove(event, entry);
  }

  protected onHandlePointerDown(event: PointerEvent, entry: TimeEntry, side: 'left' | 'right'): void {
    event.stopPropagation();
    this.closeTooltip();
    if (!isConfirmedEntry(entry)) return;
    this.startResize(event, entry, side);
  }

  protected deleteEntry(entry: TimeEntry): void {
    this.closeTooltip();
    this.timeEntriesService.deleteEntry(entry.id);
  }

  protected onSegmentMouseEnter(event: MouseEvent, segment: Segment): void {
    this.hoveredSegment$$.set({
      text: this.segmentTooltipText(segment),
      triggerRect: (event.currentTarget as HTMLElement).getBoundingClientRect(),
    });
    this.isTooltipPositioned$$.set(false);
    setTimeout(() => this.updateTooltipPosition(), 0);
  }

  protected closeTooltip(): void {
    this.hoveredSegment$$.set(null);
    this.isTooltipPositioned$$.set(false);
  }

  private updateTooltipPosition(): void {
    const hovered = this.hoveredSegment$$();
    const panel = this.tooltipPanelElem()?.nativeElement;
    if (!hovered || !panel) return;

    const position = computeTooltipPosition(hovered.triggerRect, panel.getBoundingClientRect());
    this.tooltipPlacement$$.set(position.placement);
    this.tooltipTopPx$$.set(position.top);
    this.tooltipLeftPx$$.set(position.left);
    this.isTooltipPositioned$$.set(true);
  }

  private handleScrollTop(scrollEl: HTMLDivElement, scrollTop: number): void {
    this.scrollTop$$.set(scrollTop);
    if (scrollTop > LOAD_OLDER_SCROLL_TOP_PX || this.isPrependingDays) return;
    this.prependOlderDays(scrollEl);
  }

  private startMove(event: PointerEvent, entry: TimeEntry): void {
    event.preventDefault();
    const laneEl = (event.currentTarget as HTMLElement).closest('.lane') as HTMLElement;
    const laneRect = laneEl.getBoundingClientRect();
    const startClientX = event.clientX;
    const originDayNumber = this.dayIsoToDayNumber(entry.startAt.slice(0, 10));
    const originStartAbs = this.toAbsoluteMinutes(entry.startAt);
    const originEndAbs = this.toAbsoluteMinutes(entry.endAt);
    const duration = originEndAbs - originStartAbs;
    let lockedTrack = entry.track;
    let moved = false;

    this.activeAdjustment$$.set({
      entryId: entry.id,
      entry,
      track: entry.track,
      startAbs: originStartAbs,
      endAbs: originEndAbs,
    });

    // pointermove fires far more often than a frame renders — coalescing to
    // rAF means a drag writes the signal (and re-renders) at most once per frame.
    let pendingAdjustment: ActiveAdjustment | null = null;
    let rafScheduled = false;
    const flushAdjustment = () => {
      rafScheduled = false;
      if (!pendingAdjustment) return;
      const next = pendingAdjustment;
      pendingAdjustment = null;
      this.activeAdjustment$$.set(next);
    };

    const onMove = (moveEvent: PointerEvent) => {
      moved = true;
      const dxMinutes = ((moveEvent.clientX - startClientX) / laneRect.width) * MINUTES_PER_DAY;

      let rowDeltaMinutes = 0;
      const hoverLaneEl = (
        document.elementFromPoint(moveEvent.clientX, moveEvent.clientY) as HTMLElement | null
      )?.closest('.lane') as HTMLElement | null;
      if (hoverLaneEl?.dataset['dayIso']) {
        if (moveEvent.shiftKey) lockedTrack = (hoverLaneEl.dataset['track'] as TimeTrack) ?? lockedTrack;
        const hoverDayNumber = this.dayIsoToDayNumber(hoverLaneEl.dataset['dayIso']);
        rowDeltaMinutes = (hoverDayNumber - originDayNumber) * MINUTES_PER_DAY;
      }

      const candidateStart = this.snapValue(originStartAbs + rowDeltaMinutes + dxMinutes);
      const constrainedStart = this.constrainMoveStart(candidateStart, duration, lockedTrack, entry.id);
      pendingAdjustment = {
        entryId: entry.id,
        entry,
        track: lockedTrack,
        startAbs: constrainedStart,
        endAbs: constrainedStart + duration,
      };
      if (!rafScheduled) {
        rafScheduled = true;
        requestAnimationFrame(flushAdjustment);
      }
    };

    const onUp = (upEvent: PointerEvent) => {
      if (pendingAdjustment) {
        this.activeAdjustment$$.set(pendingAdjustment);
        pendingAdjustment = null;
      }
      const adjustment = this.activeAdjustment$$();
      this.activeAdjustment$$.set(null);
      if (!moved) {
        // A plain click (no drag) on the segment body opens the picker in
        // edit mode — matches the plan's "on edit selection open the same
        // picker" without introducing a separate click handler that would
        // race with the drag's pointerdown.
        this.pickerState$$.set({ mode: 'edit', entryId: entry.id, x: upEvent.clientX, y: upEvent.clientY });
        return;
      }
      if (!adjustment) return;
      this.timeEntriesService.updateEntryTime(entry.id, {
        track: adjustment.track,
        startAt: this.fromAbsoluteMinutes(adjustment.startAbs),
        endAt: this.fromAbsoluteMinutes(adjustment.endAbs),
      });
    };

    this.listenToDrag(onMove, onUp);
  }

  private startResize(event: PointerEvent, entry: TimeEntry, side: 'left' | 'right'): void {
    event.preventDefault();
    const laneEl = (event.currentTarget as HTMLElement).closest('.lane') as HTMLElement;
    const laneRect = laneEl.getBoundingClientRect();
    const startClientX = event.clientX;
    const originStartAbs = this.toAbsoluteMinutes(entry.startAt);
    const originEndAbs = this.toAbsoluteMinutes(entry.endAt);
    let moved = false;

    let lower = -Infinity;
    let upper = Infinity;
    for (const other of this.timeEntriesService.entries$$()) {
      if (other.track !== entry.track || other.id === entry.id) continue;
      const otherStart = this.toAbsoluteMinutes(other.startAt);
      const otherEnd = this.toAbsoluteMinutes(other.endAt);
      if (otherEnd <= originStartAbs) lower = Math.max(lower, otherEnd);
      if (otherStart >= originEndAbs) upper = Math.min(upper, otherStart);
    }

    this.activeAdjustment$$.set({
      entryId: entry.id,
      entry,
      track: entry.track,
      startAbs: originStartAbs,
      endAbs: originEndAbs,
    });

    let pendingAdjustment: ActiveAdjustment | null = null;
    let rafScheduled = false;
    const flushAdjustment = () => {
      rafScheduled = false;
      if (!pendingAdjustment) return;
      const next = pendingAdjustment;
      pendingAdjustment = null;
      this.activeAdjustment$$.set(next);
    };

    const onMove = (moveEvent: PointerEvent) => {
      moved = true;
      const dxMinutes = ((moveEvent.clientX - startClientX) / laneRect.width) * MINUTES_PER_DAY;
      if (side === 'left') {
        const candidateStart = this.snapValue(originStartAbs + dxMinutes);
        const newStart = Math.max(lower, Math.min(candidateStart, originEndAbs - MIN_DURATION_MINUTES));
        pendingAdjustment = {
          entryId: entry.id,
          entry,
          track: entry.track,
          startAbs: newStart,
          endAbs: originEndAbs,
        };
      } else {
        const candidateEnd = this.snapValue(originEndAbs + dxMinutes);
        const newEnd = Math.min(upper, Math.max(candidateEnd, originStartAbs + MIN_DURATION_MINUTES));
        pendingAdjustment = {
          entryId: entry.id,
          entry,
          track: entry.track,
          startAbs: originStartAbs,
          endAbs: newEnd,
        };
      }
      if (!rafScheduled) {
        rafScheduled = true;
        requestAnimationFrame(flushAdjustment);
      }
    };

    const onUp = () => {
      if (pendingAdjustment) {
        this.activeAdjustment$$.set(pendingAdjustment);
        pendingAdjustment = null;
      }
      const adjustment = this.activeAdjustment$$();
      this.activeAdjustment$$.set(null);
      if (!moved || !adjustment) return;
      this.timeEntriesService.updateEntryTime(entry.id, {
        track: entry.track,
        startAt: this.fromAbsoluteMinutes(adjustment.startAbs),
        endAt: this.fromAbsoluteMinutes(adjustment.endAbs),
      });
    };

    this.listenToDrag(onMove, onUp);
  }

  // One drag gesture's pointer listeners live on document: removed on pointerup, or when the
  // board is destroyed mid-drag so they never write into a destroyed component.
  private listenToDrag(onMove: (event: PointerEvent) => void, onUp: (event: PointerEvent) => void): void {
    const drag = new AbortController();
    const stopOnDestroy = this.destroyRef.onDestroy(() => drag.abort());
    const finish = (event: PointerEvent): void => {
      drag.abort();
      stopOnDestroy();
      onUp(event);
    };
    document.addEventListener('pointermove', onMove, { signal: drag.signal });
    document.addEventListener('pointerup', finish, { signal: drag.signal });
  }

  protected onLaneMouseMove(event: MouseEvent, dayIso: string, track: TimeTrack): void {
    if (this.activeAdjustment$$()) {
      this.setPreviewSlot(null);
      return;
    }
    const laneRect = (event.currentTarget as HTMLElement).getBoundingClientRect();
    const rawMinute = ((event.clientX - laneRect.left) / laneRect.width) * MINUTES_PER_DAY;
    const slot = this.findGapSlot(dayIso, track, rawMinute);
    if (!slot) {
      this.setPreviewSlot(null);
      return;
    }
    this.setPreviewSlot({
      dayIso,
      track,
      leftPct: (slot.start / MINUTES_PER_DAY) * 100,
      widthPct: ((slot.end - slot.start) / MINUTES_PER_DAY) * 100,
    });
  }

  protected onLaneMouseLeave(): void {
    this.setPreviewSlot(null);
  }

  // Every mousemove tick recomputes a brand-new object even when nothing about
  // the preview actually changed — skip the signal write in that case so a
  // still cursor doesn't keep re-marking the component dirty.
  private setPreviewSlot(next: PreviewSlot | null): void {
    const current = this.previewSlot$$();
    if (current === next) return;
    if (
      current &&
      next &&
      current.dayIso === next.dayIso &&
      current.track === next.track &&
      current.leftPct === next.leftPct &&
      current.widthPct === next.widthPct
    ) {
      return;
    }
    this.previewSlot$$.set(next);
  }

  protected onLaneClick(event: MouseEvent, dayIso: string, track: TimeTrack): void {
    if ((event.target as HTMLElement).closest('.seg')) return;
    const laneRect = (event.currentTarget as HTMLElement).getBoundingClientRect();
    const rawMinute = ((event.clientX - laneRect.left) / laneRect.width) * MINUTES_PER_DAY;
    const slot = this.findGapSlot(dayIso, track, rawMinute);
    if (!slot) return;

    this.pickerState$$.set({
      mode: 'create',
      dayIso,
      track,
      startMinute: slot.start,
      endMinute: slot.end,
      x: event.clientX,
      y: event.clientY,
    });
  }

  protected onPickerConfirm(selection: StructuredActivitySelection): void {
    const picker = this.pickerState$$();
    this.pickerState$$.set(null);
    if (!picker) return;

    if (picker.mode === 'edit') {
      this.timeEntriesService.updateEntrySelection(picker.entryId, selection);
      return;
    }

    const dayAbsBase = this.dayIsoToDayNumber(picker.dayIso) * MINUTES_PER_DAY;
    this.timeEntriesService.createEntry({
      activityKindId: selection.activityKindId,
      track: picker.track,
      startAt: this.fromAbsoluteMinutes(dayAbsBase + picker.startMinute),
      endAt: this.fromAbsoluteMinutes(dayAbsBase + picker.endMinute),
      options: selection.options,
    });
  }

  protected closePicker(): void {
    this.pickerState$$.set(null);
  }

  // Scoped to the day itself + the previous day (an entry can only overlap
  // today's [0, 1440) minute range if it started today or crossed into today
  // from yesterday — a later day's entries start at/after tomorrow's base and
  // can never reach back into today) — O(couple of entries) instead of every
  // entry ever loaded.
  private findGapSlot(dayIso: string, track: TimeTrack, rawMinute: number): { start: number; end: number } | null {
    const dayAbsBase = this.dayIsoToDayNumber(dayIso) * MINUTES_PER_DAY;
    const index = this.timeEntriesService.entriesByDay$$();
    const previousDayIso = this.dayNumberToDayIso(this.dayIsoToDayNumber(dayIso) - 1);
    const trackEntries = [...(index.get(dayIso)?.[track] ?? []), ...(index.get(previousDayIso)?.[track] ?? [])].map(
      (entry) => ({ start: this.toAbsoluteMinutes(entry.startAt), end: this.toAbsoluteMinutes(entry.endAt) }),
    );

    const rawAbs = dayAbsBase + rawMinute;
    if (trackEntries.some((range) => rawAbs >= range.start && rawAbs < range.end)) return null;

    let gapStart = dayAbsBase;
    let gapEnd = dayAbsBase + MINUTES_PER_DAY;
    for (const range of trackEntries) {
      if (range.end <= rawAbs && range.end > gapStart) gapStart = range.end;
      if (range.start >= rawAbs && range.start < gapEnd) gapEnd = range.start;
    }

    const duration = Math.min(DEFAULT_DURATION_MINUTES, gapEnd - gapStart);
    if (duration < MIN_DURATION_MINUTES) return null;

    const snappedCenter = this.snapValue(rawAbs);
    const start = Math.max(gapStart, Math.min(snappedCenter - duration / 2, gapEnd - duration));
    return { start: start - dayAbsBase, end: start - dayAbsBase + duration };
  }

  private constrainMoveStart(candidateStart: number, duration: number, track: TimeTrack, excludeId: number): number {
    let lower = -Infinity;
    let upper = Infinity;
    const center = candidateStart + duration / 2;

    for (const entry of this.timeEntriesService.entries$$()) {
      if (entry.track !== track || entry.id === excludeId) continue;
      const start = this.toAbsoluteMinutes(entry.startAt);
      const end = this.toAbsoluteMinutes(entry.endAt);
      const mid = (start + end) / 2;
      if (center < mid) {
        upper = Math.min(upper, start - duration);
      } else {
        lower = Math.max(lower, end);
      }
    }

    if (lower > upper) return candidateStart;
    return Math.max(lower, Math.min(candidateStart, upper));
  }

  // Rows have a fixed, known height (rowHeightPx$$) — so the scroll compensation
  // for 30 newly-prepended days is computed analytically, not by measuring
  // scrollHeight after a render. That lets scrollTop$$ (which drives the
  // virtualization window) update in the SAME synchronous tick as
  // visibleStartDayNumber$$, so the very first re-render already has a
  // consistent (new day count, new scrollTop) pair — no intermediate frame
  // where the window is computed against a stale scrollTop, which used to
  // show a flash of the wrong/blank rows and a visible jump until the native
  // scroll event eventually caught the signal up.
  private prependOlderDays(scrollEl: HTMLDivElement): void {
    this.isPrependingDays = true;
    const anchoredScrollTop = this.scrollTop$$() + OLDER_DAYS_BATCH * this.rowHeightPx$$();

    this.visibleStartDayNumber$$.update((dayNumber) => dayNumber - OLDER_DAYS_BATCH);
    this.scrollTop$$.set(anchoredScrollTop);

    afterNextRender(
      {
        write: () => {
          scrollEl.scrollTop = anchoredScrollTop;
          this.isPrependingDays = false;
        },
      },
      { injector: this.injector },
    );
  }

  private scrollToBottomAfterRender(): void {
    this.hasScrolledToInitialBottom = true;
    afterNextRender(
      {
        write: () => {
          const scrollEl = this.timelineScrollElem()?.nativeElement;
          if (!scrollEl) {
            this.hasScrolledToInitialBottom = false;
            return;
          }
          scrollEl.scrollTop = scrollEl.scrollHeight;
          this.isInitialScrollReady$$.set(true);
        },
      },
      { injector: this.injector },
    );
  }

  private snapValue(absMinutes: number): number {
    const snap = this.snapMinutesInput();
    if (!snap) return Math.round(absMinutes);
    return Math.round(absMinutes / snap) * snap;
  }

  private minutesOfDay(iso: string): number {
    return Number(iso.slice(11, 13)) * 60 + Number(iso.slice(14, 16));
  }

  private toAbsoluteMinutes(iso: string): number {
    return this.dayIsoToDayNumber(iso.slice(0, 10)) * MINUTES_PER_DAY + this.minutesOfDay(iso);
  }

  private fromAbsoluteMinutes(absMinutes: number): string {
    const dayNumber = Math.floor(absMinutes / MINUTES_PER_DAY);
    const minutesOfDay = Math.round(absMinutes - dayNumber * MINUTES_PER_DAY);
    const hours = Math.floor(minutesOfDay / 60);
    const minutes = minutesOfDay % 60;
    return `${this.dayNumberToDayIso(dayNumber)}T${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:00`;
  }

  private formatClock(iso: string): string {
    return iso.slice(11, 16);
  }

  private clockFromAbsMinutes(absMinutes: number): string {
    const minutesOfDay = ((Math.round(absMinutes) % MINUTES_PER_DAY) + MINUTES_PER_DAY) % MINUTES_PER_DAY;
    const hours = Math.floor(minutesOfDay / 60);
    const minutes = minutesOfDay % 60;
    return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
  }

  private durationLabel(startAbs: number, endAbs: number): string {
    const totalMinutes = Math.round(endAbs - startAbs);
    const hours = Math.floor(totalMinutes / 60);
    const minutes = totalMinutes % 60;
    if (hours === 0) return `${minutes}m`;
    if (minutes === 0) return `${hours}h`;
    return `${hours}h ${minutes}m`;
  }

  private dayIsoToDayNumber(dayIso: string): number {
    const [year, month, day] = parseIsoParts(dayIso);
    return Math.round(new Date(year, month - 1, day).getTime() / 86_400_000);
  }

  private dayNumberToDayIso(dayNumber: number): string {
    const date = new Date(dayNumber * 86_400_000);
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  }

  private todayIso(): string {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  }
}
