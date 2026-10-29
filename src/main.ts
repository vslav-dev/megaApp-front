import { provideHttpClient, withInterceptors, withXhr } from '@angular/common/http';
import { ErrorHandler, inject, provideZoneChangeDetection } from '@angular/core';
import { bootstrapApplication } from '@angular/platform-browser';
import { NavigationError, provideRouter, withNavigationErrorHandler } from '@angular/router';
import { routes } from '@app/app-routes';
import { MainAppComponent } from '@app/app.component';
import { authInterceptor } from '@app/services/auth.interceptor';
import { NotificationService } from '@app/services/notification.service';
import { TelemetryErrorHandler, TelemetryService } from '@app/services/telemetry.service';
import { purgeStaleCacheVersions } from '@app/shared/cache';
import { logBuildInfo } from '@app/shared/build-info';
import { isChunkLoadError } from '@app/shared/chunk-load-error';
import { idbPurgeStaleKvEntries } from '@app/shared/idb-cache';

purgeStaleCacheVersions();
void idbPurgeStaleKvEntries();
void logBuildInfo();

function handleNavigationError(error: NavigationError): void {
  console.error('🧭 Navigation failed:', error.url, error.error);
  inject(TelemetryService).logError(error.error, { route: error.url });

  if (isChunkLoadError(error.error)) {
    window.location.reload();
    return;
  }

  inject(NotificationService).addNotification('error', 'Не удалось открыть страницу — обновите вкладку');
}

bootstrapApplication(MainAppComponent, {
  providers: [
    provideZoneChangeDetection(),
    provideHttpClient(withXhr(), withInterceptors([authInterceptor])),
    provideRouter(routes, withNavigationErrorHandler(handleNavigationError)),
    { provide: ErrorHandler, useClass: TelemetryErrorHandler },
  ],
}).catch((err) => console.error(err));
