import { Service, WritableSignal } from '@angular/core';
import { persistedSignal } from '@app/services/settings/persisted-signal';

const COMPACT_MODE_STORAGE_KEY = 'time_compact_mode';
const PRIMARY_HEIGHT_STORAGE_KEY = 'time_primary_height_px';
const SECONDARY_HEIGHT_STORAGE_KEY = 'time_secondary_height_px';
const SETTINGS_COLLAPSED_STORAGE_KEY = 'time_settings_collapsed';
const SNAP_MINUTES_STORAGE_KEY = 'time_snap_minutes';
const PICKER_HEIGHT_STORAGE_KEY = 'time_picker_height_px';

const DEFAULT_PRIMARY_HEIGHT_PX = 24;
const DEFAULT_SECONDARY_HEIGHT_PX = 18;
const DEFAULT_SNAP_MINUTES = 15;
const DEFAULT_PICKER_HEIGHT_PX = 329;

export const MIN_LANE_HEIGHT_PX = 16;
export const MAX_LANE_HEIGHT_PX = 36;

export const MIN_PICKER_HEIGHT_PX = 320;
export const MAX_PICKER_HEIGHT_PX = 700;

@Service()
export class TimeDisplayPrefsService {
  public readonly compactMode$$: WritableSignal<boolean> = persistedSignal(COMPACT_MODE_STORAGE_KEY, false);

  public readonly primaryHeightPx$$: WritableSignal<number> = persistedSignal(
    PRIMARY_HEIGHT_STORAGE_KEY,
    DEFAULT_PRIMARY_HEIGHT_PX,
  );

  public readonly secondaryHeightPx$$: WritableSignal<number> = persistedSignal(
    SECONDARY_HEIGHT_STORAGE_KEY,
    DEFAULT_SECONDARY_HEIGHT_PX,
  );

  public readonly settingsCollapsed$$: WritableSignal<boolean> = persistedSignal(SETTINGS_COLLAPSED_STORAGE_KEY, false);

  public readonly snapMinutes$$: WritableSignal<number> = persistedSignal(
    SNAP_MINUTES_STORAGE_KEY,
    DEFAULT_SNAP_MINUTES,
  );

  public readonly pickerHeightPx$$: WritableSignal<number> = persistedSignal(
    PICKER_HEIGHT_STORAGE_KEY,
    DEFAULT_PICKER_HEIGHT_PX,
  );

  public setPickerHeightPx(value: number): void {
    this.pickerHeightPx$$.set(this.clampPickerHeight(value));
  }

  public setSettingsCollapsed(value: boolean): void {
    this.settingsCollapsed$$.set(value);
  }

  public setSnapMinutes(value: number): void {
    this.snapMinutes$$.set(value);
  }

  public setCompactMode(value: boolean): void {
    this.compactMode$$.set(value);
  }

  public setPrimaryHeightPx(value: number): void {
    this.primaryHeightPx$$.set(this.clampHeight(value));
  }

  public setSecondaryHeightPx(value: number): void {
    this.secondaryHeightPx$$.set(this.clampHeight(value));
  }

  private clampHeight(value: number): number {
    return Math.min(MAX_LANE_HEIGHT_PX, Math.max(MIN_LANE_HEIGHT_PX, Math.round(value)));
  }

  private clampPickerHeight(value: number): number {
    return Math.min(MAX_PICKER_HEIGHT_PX, Math.max(MIN_PICKER_HEIGHT_PX, Math.round(value)));
  }
}
