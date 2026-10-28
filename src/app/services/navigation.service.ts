import { computed, inject, Service, signal } from '@angular/core';

import { AuthService } from '@app/services/auth.service';
import { RouterService } from '@app/services/router.service';
import { SettingsService } from '@app/services/settings.service';
import { SettingsChapterNames } from '@app/shared/types';
import { IconName } from '@ui-kit/components/v-icon/v-icon';

const MenuPlace = {
  Mobile: 'mobile',
  Desktop: 'desktop',
  Both: 'both',
} as const;

type MenuPlace = (typeof MenuPlace)[keyof typeof MenuPlace];

export interface MenuButton {
  label: string;
  place: MenuPlace;
  link: string | string[];
  selected?: boolean;
  chapterSettingName?: SettingsChapterNames;
  adminOnly?: boolean;
  iconName: IconName;
  bgClass?: string;
}

@Service()
export class NavigationService {
  private readonly navbarWidthPx$$ = signal(0);

  public readonly isCollapsed$$ = computed(() => this.settingsService.navbarCollapsed$$());

  public readonly navbarWidth$$ = computed(() => {
    return `${this.navbarWidthPx$$()}px`;
  });

  private readonly buttons: MenuButton[] = [
    {
      label: 'Дневник питания',
      place: MenuPlace.Both,
      link: '/food',
      chapterSettingName: 'selectedChapterFood',
      iconName: IconName.Restaurant,
      bgClass: 'food-bg',
    },
    {
      label: 'Дневник финансов',
      place: MenuPlace.Both,
      link: '/money',
      chapterSettingName: 'selectedChapterMoney',
      iconName: IconName.Paid,
      bgClass: 'money-bg',
    },
    {
      label: 'Метрики',
      place: MenuPlace.Both,
      link: '/metrics',
      adminOnly: true,
      iconName: IconName.Analytics,
      bgClass: 'settings-bg',
    },
    {
      label: 'DarkThemeSwitch',
      place: MenuPlace.Desktop,
      link: '',
      iconName: IconName.QuestionMark, // TODO [136]: implement dark mode
    },
    {
      label: 'Настройки',
      place: MenuPlace.Both,
      link: '/settings',
      iconName: IconName.Settings,
      bgClass: 'settings-bg',
    },
  ];

  private readonly routerService = inject(RouterService);
  private readonly settingsService = inject(SettingsService);
  private readonly authService = inject(AuthService);

  public toggleCollapse(): void {
    this.settingsService.navbarCollapsed$$.update((collapsed) => !collapsed);
  }

  public setNavbarWidthPx(width: number): void {
    this.navbarWidthPx$$.set(Math.max(0, Math.ceil(width)));
  }

  // Reads the settings, the admin flag and the current route, so a computed that calls it
  // re-evaluates on any of them — `selected` is derived here, never stored on the buttons.
  public prepButtons(place: 'mobile' | 'desktop'): MenuButton[] {
    const route = this.routerService.currentRoute$$();
    return this.buttons
      .filter((button) => {
        const chapterName: SettingsChapterNames = button.chapterSettingName as SettingsChapterNames;
        const chapterSelected = chapterName ? this.settingsService.settings$$()[chapterName] : true;
        const adminAllowed = !button.adminOnly || this.authService.isAdmin$$();
        return (button.place === place || button.place === 'both') && chapterSelected && adminAllowed;
      })
      .map((button) => ({ ...button, selected: this.isLinkActive(button.link, route) }));
  }

  private isLinkActive(link: string | string[], route: string): boolean {
    const links = Array.isArray(link) ? link : [link];
    return links.some((item) => item !== '' && route.includes(item));
  }
}
