import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';

import { SettingsService } from '@app/services/settings.service';

export const isChapterSelected: CanActivateFn = async (_route, state) => {
  const router = inject(Router);
  const settingsService = inject(SettingsService);
  await settingsService.ensureReady();

  const settings = settingsService.settings$$();

  if (state.url.startsWith('/food') && !settings.selectedChapterFood) {
    return router.createUrlTree(['/settings']);
  }

  if (state.url.startsWith('/money') && !settings.selectedChapterMoney) {
    return router.createUrlTree(['/settings']);
  }

  return true;
};
