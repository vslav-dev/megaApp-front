import { HTTP_INTERCEPTORS, provideHttpClient, withInterceptorsFromDi, withXhr } from '@angular/common/http';
import { ErrorHandler, inject, provideZoneChangeDetection } from '@angular/core';
import { bootstrapApplication } from '@angular/platform-browser';
import { NavigationError, provideRouter, withNavigationErrorHandler } from '@angular/router';
import { routes } from '@app/app-routes';
import { MainAppComponent } from '@app/app.component';
import { AuthInterceptor } from '@app/services/auth.interceptor';
import { NotificationService } from '@app/services/notification.service';
import { TelemetryErrorHandler, TelemetryService } from '@app/services/telemetry.service';
import { purgeStaleCacheVersions } from '@app/shared/cache';
import { isChunkLoadError } from '@app/shared/chunk-load-error';
import { idbPurgeStaleKvEntries } from '@app/shared/idb-cache';

purgeStaleCacheVersions();
void idbPurgeStaleKvEntries();

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
    provideHttpClient(withXhr(), withInterceptorsFromDi()),
    provideRouter(routes, withNavigationErrorHandler(handleNavigationError)),
    { provide: HTTP_INTERCEPTORS, useClass: AuthInterceptor, multi: true },
    { provide: ErrorHandler, useClass: TelemetryErrorHandler },
  ],
}).catch((err) => console.error(err));
