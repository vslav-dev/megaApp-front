import { Component, inject, linkedSignal, WritableSignal } from '@angular/core';

import { AuthService } from '@app/services/auth.service';
import { DeviceInfoService } from '@app/services/device-info.service';
import { SettingsService } from '@app/services/settings.service';
import { KeyOfUserSettings, SettingsChapterNames } from '@app/shared/types';
import { VButton } from '@ui-kit/components/v-button/v-button';
import { VCard } from '@ui-kit/components/v-card/v-card';
import { VCheckbox } from '@ui-kit/components/v-checkbox/v-checkbox';

type ChapterName = Exclude<SettingsChapterNames, ''>;

@Component({
  selector: 'settings',
  templateUrl: './settings.html',
  imports: [VButton, VCard, VCheckbox],
})
export class Settings {
  protected readonly KeyOfSettings = KeyOfUserSettings;

  protected readonly authService = inject(AuthService);
  protected readonly deviceInfoService = inject(DeviceInfoService);
  protected readonly settingsService = inject(SettingsService);

  // Follow the saved settings, but flip at once on a click and snap back if the save is refused.
  protected readonly isFoodChapterSelected$$ = linkedSignal(() => this.settingsService.settings$$().selectedChapterFood);
  protected readonly isMoneyChapterSelected$$ = linkedSignal(
    () => this.settingsService.settings$$().selectedChapterMoney,
  );

  protected async onChapterChange(
    chapterName: ChapterName,
    isSelected$$: WritableSignal<boolean>,
    newValue: boolean,
  ): Promise<void> {
    const previousValue = isSelected$$();
    if (previousValue === newValue) return;

    isSelected$$.set(newValue);

    const requestIsSuccess = await this.settingsService.saveSetting({ [chapterName]: newValue });
    if (!requestIsSuccess) {
      isSelected$$.set(previousValue);
    }
  }
}
