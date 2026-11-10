import { Component, computed, effect, inject, OnInit, signal } from '@angular/core';
import { TelemetryService } from '@app/services/telemetry.service';
import { TimeCatalogueService } from '@app/services/time/time-catalogue.service';
import {
  MAX_LANE_HEIGHT_PX,
  MAX_PICKER_HEIGHT_PX,
  MIN_LANE_HEIGHT_PX,
  MIN_PICKER_HEIGHT_PX,
  TimeDisplayPrefsService,
} from '@app/services/time/time-display-prefs.service';
import { TimeEntriesService } from '@app/services/time/time-entries.service';
import { TimeScreenView } from '@app/shared/time-types';
import { VButton } from '@ui-kit/components/v-button/v-button';
import { VCard } from '@ui-kit/components/v-card/v-card';
import { VCheckbox } from '@ui-kit/components/v-checkbox/v-checkbox';
import { IconName, VIcon } from '@ui-kit/components/v-icon/v-icon';
import { VSlider } from '@ui-kit/components/v-slider/v-slider';
import { VToggle, VToggleItem } from '@ui-kit/components/v-toggle/v-toggle';
import { ActivityKindsList } from './activity-kinds-list/activity-kinds-list';
import { CategoryGroupsList } from './category-groups-list/category-groups-list';
import { TimelineBoard } from './timeline-board/timeline-board';

@Component({
  selector: 'time-screen',
  templateUrl: './time-screen.html',
  styleUrl: './time-screen.scss',
  imports: [ActivityKindsList, CategoryGroupsList, TimelineBoard, VButton, VCard, VCheckbox, VIcon, VSlider, VToggle],
})
export class TimeScreen implements OnInit {
  protected readonly TimeScreenView = TimeScreenView;
  protected readonly IconName = IconName;

  protected readonly timeDisplayPrefsService = inject(TimeDisplayPrefsService);

  private readonly timeEntriesService = inject(TimeEntriesService);
  private readonly timeCatalogueService = inject(TimeCatalogueService);
  private readonly telemetry = inject(TelemetryService);
  private readonly screenStartedAt = performance.now();
  private screenReadyRecorded = false;

  private readonly screenReadyEffect$$ = effect(() => {
    if (!this.timeEntriesService.isLoaded$$() || this.screenReadyRecorded) return;
    this.screenReadyRecorded = true;
    void this.telemetry.recordAfterPaint('time.screen_ready', this.screenStartedAt, {
      entries: this.timeEntriesService.entries$$().length,
    });
  });

  protected readonly minLaneHeightPx = MIN_LANE_HEIGHT_PX;
  protected readonly maxLaneHeightPx = MAX_LANE_HEIGHT_PX;
  protected readonly minPickerHeightPx = MIN_PICKER_HEIGHT_PX;
  protected readonly maxPickerHeightPx = MAX_PICKER_HEIGHT_PX;

  protected readonly activeView$$ = signal<TimeScreenView>(TimeScreenView.Entry);

  protected readonly snapToggleItems: VToggleItem[] = [
    { id: '1', label: '1' },
    { id: '15', label: '15' },
    { id: '30', label: '30' },
    { id: '60', label: '60' },
  ];

  protected readonly snapToggleValue$$ = computed(() => [String(this.timeDisplayPrefsService.snapMinutes$$())]);

  public ngOnInit(): void {
    this.timeCatalogueService.loadData();
    this.timeEntriesService.loadData();
  }

  protected setView(view: TimeScreenView): void {
    this.activeView$$.set(view);
  }

  protected toggleSettingsCollapsed(): void {
    this.timeDisplayPrefsService.setSettingsCollapsed(!this.timeDisplayPrefsService.settingsCollapsed$$());
  }

  protected onSnapChange(value: string[]): void {
    const raw = value[0];
    if (raw === undefined) return;
    this.timeDisplayPrefsService.setSnapMinutes(Number(raw));
  }
}
