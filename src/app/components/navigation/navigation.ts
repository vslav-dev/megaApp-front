import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  ElementRef,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import { Router } from '@angular/router';
import { AuthService } from '@app/services/auth.service';
import { DeviceInfoService } from '@app/services/device-info.service';
import { NavigationService } from '@app/services/navigation.service';
import { ANIMATION_DURATION_MS } from '@app/shared/animations';
import { VButton } from '@ui-kit/components/v-button/v-button';
import { IconName, VIcon } from '@ui-kit/components/v-icon/v-icon';
import { MetricsHealthDot } from '../metrics/metrics-health-dot/metrics-health-dot';
import { DarkSwitch } from '../settings/dark-switch/dark-switch';

@Component({
  selector: 'navigation',
  templateUrl: './navigation.html',
  styleUrl: './navigation.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [VButton, VIcon, DarkSwitch, MetricsHealthDot],
})
export class Navigation {
  protected readonly desktopNav = viewChild<ElementRef<HTMLElement>>('desktopNav');
  protected readonly fader = viewChild.required<ElementRef<HTMLElement>>('fader');

  protected readonly Icon = IconName;

  protected readonly isMobileMenuOpen$$ = signal(false);

  protected readonly navigationService = inject(NavigationService);
  protected readonly authService = inject(AuthService);
  protected readonly deviceInfoService = inject(DeviceInfoService);
  private readonly router = inject(Router);

  private resizeObserver: ResizeObserver | null = null;
  private readonly navbarResizeObserverEffect$$ = effect((onCleanup) => {
    const navElement = this.desktopNav()?.nativeElement;
    const isDesktop = this.isDesktop$$();

    if (!isDesktop || !navElement) {
      this.navigationService.setNavbarWidthPx(0);
      if (this.resizeObserver) {
        this.resizeObserver.disconnect();
      }
      return;
    }

    if (!this.resizeObserver) {
      this.resizeObserver = new ResizeObserver((entries) => {
        const entry = entries[0];
        if (!entry) return;
        const target = entry.target as HTMLElement;
        this.navigationService.setNavbarWidthPx(target.getBoundingClientRect().width);
      });
    }

    this.resizeObserver.disconnect();
    this.resizeObserver.observe(navElement);
    this.navigationService.setNavbarWidthPx(navElement.getBoundingClientRect().width);

    onCleanup(() => {
      if (this.resizeObserver) {
        this.resizeObserver.disconnect();
      }
    });
  });

  protected readonly isDesktop$$ = computed(() => this.deviceInfoService.isDesktopScreen$$());

  protected readonly visibleButtons$$ = computed(() => {
    const place = this.isDesktop$$() ? 'desktop' : 'mobile';
    return this.navigationService.prepButtons(place);
  });

  protected toggleMenuCollapse(): void {
    this.navigationService.toggleCollapse();
  }

  protected toggleMobileMenu(): void {
    this.isMobileMenuOpen$$.update((value) => !value);
    if (this.isMobileMenuOpen$$()) {
      this.fader().nativeElement.classList.remove('hidden');
    } else {
      setTimeout(() => {
        this.fader().nativeElement.classList.add('hidden');
      }, ANIMATION_DURATION_MS.MEDIUM);
    }
  }

  protected closeMobileMenu(): void {
    this.isMobileMenuOpen$$.set(false);
    setTimeout(() => {
      this.fader().nativeElement.classList.add('hidden');
    }, ANIMATION_DURATION_MS.MEDIUM);
  }

  protected navigateToLink(link: string | string[]): void {
    if (Array.isArray(link)) {
      void this.router.navigate(link);
    } else if (link) {
      void this.router.navigate([link]);
    }
  }

  protected getCollapseIconName(): IconName {
    return this.navigationService.isCollapsed$$() ? IconName.LeftPanelOpen : IconName.LeftPanelClose;
  }
}
