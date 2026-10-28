import { ChangeDetectionStrategy, Component, computed, inject, Signal } from '@angular/core';
import { FoodFabLayer, foodFabStackBottomPx } from '@app/components/food/food-fab-layout';
import { AuthService } from '@app/services/auth.service';
import { DeviceInfoService } from '@app/services/device-info.service';
import { FoodScreenMobileTab, FoodScreenModeService } from '@app/services/food/food-screen-mode.service';
import { VButton } from '@ui-kit/components/v-button/v-button';
import { IconName, VIcon } from '@ui-kit/components/v-icon/v-icon';

// Always mounted from food-screen.html (never swapped out with the diary/stats content it
// controls) — otherwise switching to stats would unmount the only button that can switch back.
@Component({
  selector: 'food-mode-toggle-fab',
  templateUrl: './food-mode-toggle-fab.html',
  imports: [VButton, VIcon],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class FoodModeToggleFab {
  protected readonly authService = inject(AuthService);
  protected readonly deviceInfoService = inject(DeviceInfoService);
  private readonly foodScreenModeService = inject(FoodScreenModeService);

  protected readonly Icon = IconName;
  protected readonly bottomPx: string = foodFabStackBottomPx(FoodFabLayer.ModeToggle);

  protected readonly isVisible$$: Signal<boolean> = computed(
    () => this.authService.isAuthenticated$$() && this.foodScreenModeService.isSingleColumnLayout$$(),
  );

  // Shows the tab you'd switch TO, mirroring how the hamburger's Menu/Close icon works.
  protected readonly modeToggleIcon$$: Signal<IconName> = computed(() =>
    this.foodScreenModeService.mobileTab$$() === FoodScreenMobileTab.Diary ? IconName.Analytics : IconName.Dining,
  );

  protected toggleMode(): void {
    this.foodScreenModeService.toggleMobileTab();
  }
}
