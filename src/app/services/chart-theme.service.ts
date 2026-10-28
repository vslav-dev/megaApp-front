import { computed, inject, Injectable, Signal, signal } from '@angular/core';
import {
  CHART_COLORS_DARK,
  CHART_COLORS_LIGHT,
  ChartColors,
  FOOD_STATS_MONTH_LABELS_OPTIONS_DARK,
  FOOD_STATS_MONTH_LABELS_OPTIONS_LIGHT,
  MonthLabelsPluginOptions,
} from '@app/shared/chart-config';
import { DEFAULT_PALETTE_TUNING } from '@app/shared/categorical-palette';
import { PaletteTuning } from '@app/shared/types';
import { Chart } from 'chart.js';
import { SettingsService } from './settings.service';

// Single place every Chart.js-based component reads its theme from — replaces the
// darkTheme ternary that used to be duplicated independently in each chart component.
@Injectable({
  providedIn: 'root',
})
export class ChartThemeService {
  private readonly settingsService = inject(SettingsService);

  // An unsaved palette tuning shown live while the category form is open; nothing is stored until
  // the form saves it with setPaletteTuning.
  private readonly paletteDraft$$ = signal<PaletteTuning | null>(null);
  public readonly paletteDraftValue$$: Signal<PaletteTuning | null> = this.paletteDraft$$.asReadonly();

  // The tuning in effect for the current theme: the unsaved draft, else the user's override, else
  // the built-in default. Compared by content so unrelated settings changes don't hand every chart
  // a new colors object.
  public readonly paletteTuning$$ = computed<PaletteTuning>(
    () => {
      const settings = this.settingsService.settings$$();
      const override = this.settingsService.darkTheme$$() ? settings.chartPaletteDark : settings.chartPaletteLight;
      return this.paletteDraft$$() ?? override ?? DEFAULT_PALETTE_TUNING;
    },
    { equal: (a, b) => a.lightness === b.lightness && a.saturation === b.saturation },
  );

  public readonly colors$$ = computed<ChartColors>(() => {
    const base = this.settingsService.darkTheme$$() ? CHART_COLORS_DARK : CHART_COLORS_LIGHT;
    const colors = { ...base, palette: this.paletteTuning$$() };
    // Chart.js resolves grid/tick/legend colors from these defaults on every chart.update()
    // call unless a chart's own options override them. Setting them here, as part of computing
    // colors$$ rather than in a separate effect, guarantees they're current before any chart
    // component's own theme-reactive update effect (which also reads colors$$) runs.
    Chart.defaults.color = colors.text;
    Chart.defaults.borderColor = colors.grid;
    return colors;
  });

  public readonly monthLabelsOptions$$ = computed<MonthLabelsPluginOptions>(() =>
    this.settingsService.darkTheme$$() ? FOOD_STATS_MONTH_LABELS_OPTIONS_DARK : FOOD_STATS_MONTH_LABELS_OPTIONS_LIGHT,
  );

  public setPaletteDraft(tuning: PaletteTuning | null): void {
    this.paletteDraft$$.set(tuning);
  }

  // Overrides the palette tuning of the current theme only; the other theme keeps its own.
  public setPaletteTuning(tuning: PaletteTuning): void {
    void this.settingsService.updateSetting(this.paletteSettingKey(), tuning);
  }

  public resetPaletteTuning(): void {
    void this.settingsService.updateSetting(this.paletteSettingKey(), null);
  }

  private paletteSettingKey(): 'chartPaletteLight' | 'chartPaletteDark' {
    return this.settingsService.darkTheme$$() ? 'chartPaletteDark' : 'chartPaletteLight';
  }
}
