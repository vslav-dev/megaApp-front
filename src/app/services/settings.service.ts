import { effect, inject, Service, Signal, WritableSignal } from '@angular/core';
import { ANIMATION_DURATION_MS, ANIMATION_DURATION_MS_STRING } from '@app/shared/animations';
import { DEFAULT_SETTINGS } from '@app/shared/const';
import { UserSettings } from '@app/shared/types';
import { NetworkService } from './network.service';
import { NamespaceSettingsStore } from './settings/namespace-settings-store';
import { persistedSignal } from './settings/persisted-signal';

@Service()
export class SettingsService {
  private readonly networkService = inject(NetworkService);
  private readonly store = new NamespaceSettingsStore<UserSettings>('core', DEFAULT_SETTINGS);

  public readonly settings$$: Signal<UserSettings> = this.store.value$$;

  // Local-only, not synced to the server — deliberately reclassified from the core namespace:
  // a device's dark/light preference and its navbar-collapsed state aren't things that should
  // follow the user to another device. darkTheme is per-user (their preference, wherever they're
  // on this browser); navbarCollapsed is per-device (a layout choice tied to screen size).
  public readonly darkTheme$$: WritableSignal<boolean> = persistedSignal('dark_theme', false);
  public readonly navbarCollapsed$$: WritableSignal<boolean> = persistedSignal('navbar_collapsed', true, 'device');

  private themeTransitionTimeoutId: ReturnType<typeof setTimeout> | null = null;

  // Applies whenever darkTheme changes for any reason that isn't a user-triggered toggle on this
  // device (initial load from storage, a rollback) — those go through applyThemeAnimated directly
  // instead, at the point of the user's own click.
  private readonly applyThemeEffect$$ = effect(() => {
    this.applyTheme(this.darkTheme$$());
  });

  public ensureReady(): Promise<void> {
    return this.store.ready();
  }

  // Local-only write — always "succeeds" synchronously, no network/rollback path needed.
  public setDarkTheme(value: boolean): void {
    this.applyThemeAnimated(value);
    this.darkTheme$$.set(value);
  }

  public async updateSetting<K extends keyof UserSettings>(key: K, value: UserSettings[K]): Promise<boolean> {
    if (!this.networkService.isNetworkAvailable$$()) {
      return false;
    }

    this.store.set(key, value);
    return true;
  }

  public applyTheme(isDarkTheme: boolean): void {
    if (isDarkTheme) {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
  }

  // Used for user-triggered theme switches only: loadSettings/reset apply the initial
  // theme via the plain applyTheme so the first paint never animates from the wrong theme.
  public applyThemeAnimated(isDarkTheme: boolean): void {
    if (this.themeTransitionTimeoutId !== null) {
      clearTimeout(this.themeTransitionTimeoutId);
    }

    document.documentElement.style.setProperty('--v-theme-transition-duration', ANIMATION_DURATION_MS_STRING.THEME);
    this.applyTheme(isDarkTheme);

    this.themeTransitionTimeoutId = setTimeout(() => {
      document.documentElement.style.removeProperty('--v-theme-transition-duration');
      this.themeTransitionTimeoutId = null;
    }, ANIMATION_DURATION_MS.THEME);
  }

  public async saveSetting(setting: Partial<UserSettings>): Promise<boolean> {
    const key = Object.keys(setting)[0] as keyof UserSettings;
    const value = setting[key];

    if (value !== undefined) {
      return await this.updateSetting(key, value);
    }

    return false;
  }
}
