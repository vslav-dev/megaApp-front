import {
  Component,
  computed,
  DestroyRef,
  effect,
  ElementRef,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import { ChartThemeService } from '@app/services/chart-theme.service';
import { MoneyComputeService } from '@app/services/money-compute.service';
import { MoneyService } from '@app/services/money.service';
import {
  DEFAULT_PALETTE_TUNING,
  PALETTE_LIMITS,
  SeriesColor,
  seriesColor,
  seriesColorById,
} from '@app/shared/categorical-palette';
import type { ChartColors } from '@app/shared/chart-config';
import { Category, CategoryType } from '@app/shared/types';
import { VButton } from '@ui-kit/components/v-button/v-button';
import { VCheckbox } from '@ui-kit/components/v-checkbox/v-checkbox';
import { DropdownItem, VDropdown } from '@ui-kit/components/v-dropdown/v-dropdown';
import { VInput } from '@ui-kit/components/v-input/v-input';
import { VSlider } from '@ui-kit/components/v-slider/v-slider';

const HUE_GRADIENT_STOPS = [0, 60, 120, 180, 240, 300, 360];

// Steps of the lightness and saturation slider tracks.
const TRACK_STEPS = 8;

// Stands in for a category that is not saved yet: the highest id, so it gets the color a new
// category would get (the next free automatic hue).
const NEW_CATEGORY_PREVIEW_ID = Number.MAX_SAFE_INTEGER;

@Component({
  selector: 'category-form',
  templateUrl: './category-form.html',
  imports: [VButton, VCheckbox, VDropdown, VInput, VSlider],
})
export class CategoryForm {
  public readonly categoryInput = input<Category | null>(null);
  public readonly categoriesInput = input<Category[]>([]);
  public readonly isOpenInput = input<boolean>(false);

  public readonly savedOutput = output<void>();
  public readonly cancelledOutput = output<void>();
  // true while a slider is held down, false when it is let go.
  public readonly sliderDragOutput = output<boolean>();

  protected readonly name$$ = signal('');
  protected readonly categoryType$$ = signal<CategoryType>(CategoryType.EXPENSE);
  protected readonly parentId$$ = signal<string | null>(null);
  protected readonly hiddenOnCharts$$ = signal(false);
  // The category's own chart color. null: hue is picked automatically, lightness and saturation
  // follow the default for all categories (the "All categories" sliders).
  protected readonly hue$$ = signal<number | null>(null);
  protected readonly lightness$$ = signal<number | null>(null);
  protected readonly saturation$$ = signal<number | null>(null);

  protected readonly PaletteLimits = PALETTE_LIMITS;

  private readonly chartThemeService = inject(ChartThemeService);
  private readonly moneyService = inject(MoneyService);
  private readonly moneyComputeService = inject(MoneyComputeService);

  // A category that transactions use keeps its type: the server rejects a change.
  protected readonly isTypeLocked$$ = computed(() => {
    const categoryId = this.categoryInput()?.id;
    return categoryId !== undefined && this.moneyService.transactions$$().some((tx) => tx.categoryId === categoryId);
  });

  // The default lightness/saturation for every category. The form edits it as a draft that the
  // charts show live (see ChartThemeService) and saves only with "Update", so "Cancel" drops it.
  protected readonly paletteDefault$$ = this.chartThemeService.paletteTuning$$;
  protected readonly isPaletteDefaultUntouched$$ = computed(
    () =>
      this.paletteDefault$$().lightness === DEFAULT_PALETTE_TUNING.lightness &&
      this.paletteDefault$$().saturation === DEFAULT_PALETTE_TUNING.saturation,
  );
  protected readonly themeLabel$$ = computed(() => (this.chartThemeService.colors$$().isDark ? 'dark' : 'light'));

  // Slider values as the chart will use them: the category's own, else the shared default.
  protected readonly lightnessValue$$ = computed(() => this.lightness$$() ?? this.paletteDefault$$().lightness);
  protected readonly saturationValue$$ = computed(() => this.saturation$$() ?? this.paletteDefault$$().saturation);

  private readonly editedSeriesId$$ = computed(() => this.categoryInput()?.id ?? NEW_CATEGORY_PREVIEW_ID);

  // Every series' color of this chart with the form's unsaved values applied to this category.
  private readonly draftSeriesColors$$ = computed(() =>
    this.moneyComputeService.previewSeriesColors(this.categoryType$$(), {
      id: this.editedSeriesId$$(),
      hue: this.hue$$(),
      lightness: this.lightness$$(),
      saturation: this.saturation$$(),
    }),
  );

  // The hue the chart gives this category, also while it is automatic.
  protected readonly effectiveHue$$ = computed(() => this.draftSeriesColors$$().get(this.editedSeriesId$$())?.hue ?? 0);

  // Where the hue slider sits and how it looks: dimmed while the hue is automatic.
  protected readonly hueSliderValue$$ = computed(() => this.hue$$() ?? this.effectiveHue$$());
  protected readonly hueOpacity$$ = computed(() => (this.hue$$() === null ? 0.5 : 1));
  protected readonly lightnessOpacity$$ = computed(() => (this.lightness$$() === null ? 0.5 : 1));
  protected readonly saturationOpacity$$ = computed(() => (this.saturation$$() === null ? 0.5 : 1));

  // A single bar sized like a typical month of the last year: each category's part of the total
  // and the chart's stacking order (left = bottom), in the colors the charts would show after saving.
  protected readonly previewSegments$$ = computed(() => {
    const colors = this.chartThemeService.colors$$();
    const seriesColors = this.draftSeriesColors$$();
    const editedId = this.editedSeriesId$$();
    const shares =
      this.categoryType$$() === CategoryType.EXPENSE
        ? this.moneyComputeService.expenseSeriesShares$$()
        : this.moneyComputeService.incomeSeriesShares$$();

    const series = shares.some((item) => item.id === editedId)
      ? shares
      : [...shares, { id: editedId, name: this.name$$() || 'New category', share: 1 / Math.max(shares.length, 1) }];
    return series.map((item) => ({
      ...item,
      color: seriesColorById(seriesColors, item.id, colors),
      flex: `${item.share} 1 0`,
      // The edited category is outlined so it can be told apart in the bar.
      boxShadow: item.id === editedId ? 'inset 0 0 0 2px currentColor' : null,
    }));
  });

  protected readonly hueTrackGradient$$ = computed(() => {
    const colors = this.chartThemeService.colors$$();
    const lightness = this.lightnessValue$$();
    const saturation = this.saturationValue$$();
    return this.trackGradient(
      HUE_GRADIENT_STOPS.map((hue) => ({ hue, lightness, saturation })),
      colors,
    );
  });

  // Each track shows the colors the slider would give at the category's hue, holding the other
  // value fixed: its own for the category sliders, the shared default for the default sliders.
  protected readonly lightnessTrackGradient$$ = computed(() => this.lightnessTrack(this.saturationValue$$()));
  protected readonly saturationTrackGradient$$ = computed(() => this.saturationTrack(this.lightnessValue$$()));
  protected readonly paletteLightnessTrackGradient$$ = computed(() =>
    this.lightnessTrack(this.paletteDefault$$().saturation),
  );
  protected readonly paletteSaturationTrackGradient$$ = computed(() =>
    this.saturationTrack(this.paletteDefault$$().lightness),
  );

  public constructor() {
    effect(() => {
      const currentCategory = this.categoryInput();
      if (currentCategory) {
        this.fillForm(currentCategory);
      } else {
        this.resetForm();
      }
    });

    // While the form is open the charts behind it show its unsaved colors; closing it drops them.
    effect(() => {
      if (!this.isOpenInput()) {
        this.clearDrafts();
        this.sliderDragOutput.emit(false);
        return;
      }
      this.moneyComputeService.setColorDraft({
        categoryType: this.categoryType$$(),
        id: this.editedSeriesId$$(),
        hue: this.hue$$(),
        lightness: this.lightness$$(),
        saturation: this.saturation$$(),
      });
    });

    // A slider's own handlers stop the pointerdown event from bubbling, so it is caught on the way
    // down (capture); the release can land anywhere, so it is awaited on the window.
    const element: HTMLElement = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;
    element.addEventListener('pointerdown', this.onPointerDownCapture, true);
    inject(DestroyRef).onDestroy(() => {
      element.removeEventListener('pointerdown', this.onPointerDownCapture, true);
      this.clearDrafts();
    });
  }

  protected async save(): Promise<void> {
    if (!this.name$$() || !this.categoryType$$()) return;

    this.savePaletteDraft();

    const categoryData: Category = {
      name: this.name$$(),
      categoryType: this.categoryType$$(),
      parentId: this.parentId$$() ? Number(this.parentId$$()) : null,
      hiddenOnCharts: this.hiddenOnCharts$$(),
      hue: this.hue$$(),
      lightness: this.lightness$$(),
      saturation: this.saturation$$(),
    };

    const currentCategory = this.categoryInput();
    if (currentCategory?.id) {
      categoryData.id = currentCategory.id;
      if (await this.moneyService.updateCategory(categoryData)) {
        this.savedOutput.emit();
      }
    } else {
      if (await this.moneyService.createCategory(categoryData)) {
        this.savedOutput.emit();
      }
    }
  }

  // The server stores whole numbers; a drag can land between them.
  protected onHueChange(value: number): void {
    this.hue$$.set(Math.round(value));
  }

  protected onLightnessChange(value: number): void {
    this.lightness$$.set(Math.round(value));
  }

  protected onSaturationChange(value: number): void {
    this.saturation$$.set(Math.round(value));
  }

  // These two change the default of every category; it is stored with "Update".
  protected onPaletteLightnessChange(value: number): void {
    this.chartThemeService.setPaletteDraft({ ...this.paletteDefault$$(), lightness: Math.round(value) });
  }

  protected onPaletteSaturationChange(value: number): void {
    this.chartThemeService.setPaletteDraft({ ...this.paletteDefault$$(), saturation: Math.round(value) });
  }

  protected resetPaletteDefault(): void {
    this.chartThemeService.setPaletteDraft(DEFAULT_PALETTE_TUNING);
  }

  protected cancel(): void {
    this.cancelledOutput.emit();
  }

  protected isEditing(): boolean {
    return Boolean(this.categoryInput()?.id);
  }

  private getCategoryTypeValues(): CategoryType[] {
    return Object.values(CategoryType);
  }

  protected categoryTypeItems(): DropdownItem[] {
    return this.getCategoryTypeValues().map((value) => ({
      value,
      label: this.getCategoryTypeDisplayName(value),
    }));
  }

  private getCategoryTypeDisplayName(categoryType: CategoryType): string {
    switch (categoryType) {
      case CategoryType.INCOME:
        return 'Income';
      case CategoryType.EXPENSE:
        return 'Expense';
      default:
        return categoryType;
    }
  }

  private getParentCategories(): Category[] {
    const currentId = this.categoryInput()?.id;
    return this.categoriesInput()
      .filter((category) => category.categoryType === this.categoryType$$() && category.id !== currentId)
      .filter((category) => !category.parentId)
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  protected parentCategoryItems(): DropdownItem[] {
    return [
      { value: '', label: 'No parent' },
      ...this.getParentCategories().map((category) => ({
        value: String(category.id),
        label: category.name,
      })),
    ];
  }

  // The dropdown only offers the CategoryType items, so its string value is one of them.
  protected onCategoryTypeChange(value: string | null): void {
    this.categoryType$$.set(value as CategoryType);
    const parentId = this.parentId$$() ? Number(this.parentId$$()) : null;
    if (!parentId) return;
    const parentCategory = this.categoriesInput().find((category) => category.id === parentId);
    if (!parentCategory || parentCategory.categoryType !== this.categoryType$$()) {
      this.parentId$$.set(null);
    }
  }

  // Stores the edited default palette: back to "no override" when it is the built-in default again.
  private savePaletteDraft(): void {
    const draft = this.chartThemeService.paletteDraftValue$$();
    if (draft === null) return;

    if (
      draft.lightness === DEFAULT_PALETTE_TUNING.lightness &&
      draft.saturation === DEFAULT_PALETTE_TUNING.saturation
    ) {
      this.chartThemeService.resetPaletteTuning();
    } else {
      this.chartThemeService.setPaletteTuning(draft);
    }
    this.chartThemeService.setPaletteDraft(null);
  }

  private clearDrafts(): void {
    this.chartThemeService.setPaletteDraft(null);
    this.moneyComputeService.setColorDraft(null);
  }

  // Tells the host while a slider is held, so it can let the charts behind the form show through.
  private readonly onPointerDownCapture = (event: PointerEvent): void => {
    if (!(event.target as HTMLElement).closest('v-slider')) return;

    this.sliderDragOutput.emit(true);
    const release = (): void => {
      window.removeEventListener('pointerup', release, true);
      window.removeEventListener('pointercancel', release, true);
      this.sliderDragOutput.emit(false);
    };
    window.addEventListener('pointerup', release, true);
    window.addEventListener('pointercancel', release, true);
  };

  private lightnessTrack(saturation: number): string {
    const { min, max } = PALETTE_LIMITS.lightness;
    const hue = this.effectiveHue$$();
    return this.trackGradient(
      this.trackValues(min, max).map((lightness) => ({ hue, lightness, saturation })),
      this.chartThemeService.colors$$(),
    );
  }

  private saturationTrack(lightness: number): string {
    const { min, max } = PALETTE_LIMITS.saturation;
    const hue = this.effectiveHue$$();
    return this.trackGradient(
      this.trackValues(min, max).map((saturation) => ({ hue, lightness, saturation })),
      this.chartThemeService.colors$$(),
    );
  }

  private trackValues(min: number, max: number): number[] {
    return Array.from({ length: TRACK_STEPS }, (_, i) => min + ((max - min) * i) / (TRACK_STEPS - 1));
  }

  private trackGradient(stops: SeriesColor[], colors: ChartColors): string {
    return `linear-gradient(to right, ${stops.map((stop) => seriesColor(stop, colors)).join(', ')})`;
  }

  private fillForm(category: Category): void {
    this.name$$.set(category.name);
    this.categoryType$$.set(category.categoryType);
    this.parentId$$.set(category.parentId ? String(category.parentId) : null);
    this.hiddenOnCharts$$.set(Boolean(category.hiddenOnCharts));
    this.hue$$.set(category.hue ?? null);
    this.lightness$$.set(category.lightness ?? null);
    this.saturation$$.set(category.saturation ?? null);
  }

  private resetForm(): void {
    this.name$$.set('');
    this.categoryType$$.set(CategoryType.EXPENSE);
    this.parentId$$.set(null);
    this.hiddenOnCharts$$.set(false);
    this.hue$$.set(null);
    this.lightness$$.set(null);
    this.saturation$$.set(null);
  }
}
