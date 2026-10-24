import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  OnDestroy,
  OnInit,
  Signal,
  signal,
  WritableSignal,
} from '@angular/core';
import { CameraPreview } from '@app/components/food/diary/camera-preview/camera-preview';
import { CatalogueEntryEditForm } from '@app/components/food/diary/catalogue-entry-edit-form/catalogue-entry-edit-form';
import { DiaryEntryAddForm } from '@app/components/food/diary/diary-entry-add-form/diary-entry-add-form';
import { FoodDiary } from '@app/components/food/diary/food-diary';
import { FoodSearch } from '@app/components/food/diary/food-search/food-search';
import { FoodModeToggleFab } from '@app/components/food/food-mode-toggle-fab/food-mode-toggle-fab';
import { FoodStatsAccordion } from '@app/components/food/stats/food-stats-accordion/food-stats-accordion';
import { FoodStatsColumns } from '@app/components/food/stats/food-stats-columns/food-stats-columns';
import { DeviceInfoService } from '@app/services/device-info.service';
import { FoodAddModalService, ModalState } from '@app/services/food/food-add-modal.service';
import { FoodCatalogueService } from '@app/services/food/food-catalogue.service';
import { FoodScreenMobileTab, FoodScreenModeService } from '@app/services/food/food-screen-mode.service';
import { FoodSyncCoordinatorService } from '@app/services/food/food-sync-coordinator.service';
import { TelemetryService } from '@app/services/telemetry.service';
import { fitColumnsToWidth } from '@app/shared/utils';
import { VModal } from '@ui-kit/components/v-modal/v-modal';

const TARGET_COLUMN_WIDTH_PX = 400;
const COLUMN_GAP_PX = 8;
// Host has `px-2` (16px total horizontal padding).
const HOST_HORIZONTAL_PADDING_PX = 16;

@Component({
  selector: 'food-screen',
  templateUrl: './food-screen.html',
  imports: [
    FoodDiary,
    FoodStatsAccordion,
    FoodStatsColumns,
    FoodModeToggleFab,
    VModal,
    FoodSearch,
    CameraPreview,
    DiaryEntryAddForm,
    CatalogueEntryEditForm,
  ],
  providers: [FoodScreenModeService],
  host: {
    class: 'mt-2 px-2 w-full items-stretch gap-3',
    '[class.flex]': 'totalColumnCount$$() === 1',
    '[class.flex-col]': 'totalColumnCount$$() === 1',
    '[class.grid]': 'totalColumnCount$$() >= 2',
    '[style.grid-template-columns]': 'gridTemplateColumns$$()',
  },
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class FoodScreen implements OnInit, OnDestroy {
  private readonly foodSyncCoordinatorService = inject(FoodSyncCoordinatorService);
  protected readonly deviceInfoService = inject(DeviceInfoService);
  private readonly telemetry = inject(TelemetryService);
  private readonly foodCatalogueService = inject(FoodCatalogueService);
  protected readonly foodScreenModeService = inject(FoodScreenModeService);
  protected readonly foodAddModalService = inject(FoodAddModalService);
  protected readonly Tab = FoodScreenMobileTab;
  protected readonly ModalState = ModalState;

  // Raw window width — deliberately NOT this component's own (sidebar-shrunk) container width.
  // Deciding column count from the real container would make the sidebar's own visibility depend
  // on a value the sidebar itself affects: hide sidebar → container widens → more columns →
  // "desktop" → sidebar reappears → container narrows → back to 1 column → forever. The sidebar is
  // a few tens of pixels against a 400px-per-column target, so ignoring it here is the deliberate
  // trade-off that keeps "1 column" and "mobile chrome" a single source of truth with no feedback
  // loop — see totalColumnCount$$ below, which drives both.
  private readonly windowWidthPx$$: WritableSignal<number> = signal(window.innerWidth);
  private readonly onWindowResize = (): void => this.windowWidthPx$$.set(window.innerWidth);

  // Total columns on screen, diary included — 1 means only the diary fits (stats go into the
  // accordion below it), 2+ means diary plus (totalColumnCount - 1) stats columns beside it. Also
  // the single source of truth for the app-wide mobile/desktop chrome override (see constructor) —
  // whatever this says the grid renders is exactly what decides sidebar vs. hamburger, so the two
  // can never disagree.
  protected readonly totalColumnCount$$: Signal<number> = computed(() =>
    fitColumnsToWidth(this.windowWidthPx$$() - HOST_HORIZONTAL_PADDING_PX, TARGET_COLUMN_WIDTH_PX, COLUMN_GAP_PX),
  );

  protected readonly statsColumnCount$$: Signal<number> = computed(() => this.totalColumnCount$$() - 1);

  // With exactly 2 total columns, diary trails (2nd/last) so stats sit left of it. With 3+ columns
  // there's room for stats on both sides, so diary sits in the 2nd column, centered between them.
  protected readonly diaryColumnIndex$$: Signal<number> = computed(() =>
    this.totalColumnCount$$() >= 3 ? 2 : this.totalColumnCount$$(),
  );

  // Grid column (1-based) for each of the statsColumnCount stats columns, in order — every grid
  // column except the diary's.
  protected readonly statsGridColumns$$: Signal<number[]> = computed(() => {
    const total = this.totalColumnCount$$();
    const diaryColumn = this.diaryColumnIndex$$();
    const columns: number[] = [];
    for (let column = 1; column <= total; column++) {
      if (column !== diaryColumn) columns.push(column);
    }
    return columns;
  });

  // Columns sized as equal fractions of the container, so each lands close to TARGET_COLUMN_WIDTH_PX
  // without ever being pinned to a fixed pixel width.
  protected readonly gridTemplateColumns$$: Signal<string> = computed(
    () => `repeat(${this.totalColumnCount$$()}, minmax(0, 1fr))`,
  );

  public constructor() {
    effect(() => this.foodScreenModeService.isSingleColumnLayout$$.set(this.totalColumnCount$$() === 1));
    effect(() => this.deviceInfoService.setMobileOverride(this.totalColumnCount$$() === 1));
  }

  public ngOnInit(): void {
    const startedAt = performance.now();
    void this.foodSyncCoordinatorService.loadInitialFoodData().then(() =>
      this.telemetry.recordAfterPaint('food.screen_ready', startedAt, {
        columns: this.totalColumnCount$$(),
      }),
    );
    window.addEventListener('resize', this.onWindowResize);
  }

  public ngOnDestroy(): void {
    window.removeEventListener('resize', this.onWindowResize);
    this.deviceInfoService.setMobileOverride(null);
  }

  protected closeAddFoodModal(): void {
    this.foodAddModalService.closeModal();
    this.foodCatalogueService.clearSearch();
  }
}
