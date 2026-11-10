import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { IndexedDbCacheService } from '@app/services/indexed-db-cache.service';
import { NetworkService } from '@app/services/network.service';
import { NotificationService } from '@app/services/notification.service';
import { SyncEngineService } from '@app/services/sync-engine.service';
import { SessionResponse } from '@app/shared/types';
import { AuthService, AuthSessionState } from './auth.service';

function session(overrides: Partial<SessionResponse> = {}): SessionResponse {
  // 10 days out: scheduleRenewal() clips this to a small, real (non-fake-timer) setTimeout delay
  // (~3 days, well within setTimeout's 32-bit ms range) so tests that don't care about renewal
  // timing don't schedule a huge/overflowing real timer in the background.
  const expiresAt = new Date(Date.now() + 10 * 24 * 60 * 60 * 1000).toISOString();
  return { authenticated: true, userId: 1, username: 'u', isAdmin: false, expiresAt, ...overrides };
}

function setup() {
  const networkServiceFake: Pick<NetworkService, 'setSessionInvalidationHandler' | 'connect' | 'disconnect'> = {
    setSessionInvalidationHandler: vi.fn(),
    connect: vi.fn(),
    disconnect: vi.fn(),
  };
  const syncEngineFake: Pick<SyncEngineService, 'reset' | 'restorePendingOperation'> = {
    reset: vi.fn(),
    restorePendingOperation: vi.fn(),
  };
  const notificationServiceFake: Pick<NotificationService, 'clearAll'> = { clearAll: vi.fn() };
  const indexedDbCacheFake: Pick<IndexedDbCacheService, 'clearAllUserScoped'> = {
    clearAllUserScoped: vi.fn(() => Promise.resolve()),
  };
  const routerFake: Pick<Router, 'navigateByUrl'> = { navigateByUrl: vi.fn(() => Promise.resolve(true)) };

  TestBed.configureTestingModule({
    providers: [
      provideHttpClient(),
      provideHttpClientTesting(),
      { provide: NetworkService, useValue: networkServiceFake },
      { provide: SyncEngineService, useValue: syncEngineFake },
      { provide: NotificationService, useValue: notificationServiceFake },
      { provide: IndexedDbCacheService, useValue: indexedDbCacheFake },
      { provide: Router, useValue: routerFake },
    ],
  });

  return {
    service: TestBed.inject(AuthService),
    httpMock: TestBed.inject(HttpTestingController),
    networkServiceFake,
    syncEngineFake,
    routerFake,
  };
}

describe('AuthService — bootstrap session state transitions', () => {
  it('moves Unknown -> Authenticated on a valid session response', async () => {
    const { service, httpMock, networkServiceFake, syncEngineFake } = setup();
    expect(service.sessionState$$()).toBe(AuthSessionState.Unknown);

    const bootstrapped = service.ensureBootstrapped();
    httpMock.expectOne('/api/auth/session').flush(session());
    await bootstrapped;

    expect(service.sessionState$$()).toBe(AuthSessionState.Authenticated);
    expect(service.userId$$()).toBe(1);
    expect(networkServiceFake.connect).toHaveBeenCalledTimes(1);
    expect(syncEngineFake.restorePendingOperation).toHaveBeenCalledTimes(1);
    httpMock.verify();
  });

  it('moves Unknown -> Guest when the session response says not authenticated', async () => {
    const { service, httpMock } = setup();

    const bootstrapped = service.ensureBootstrapped();
    httpMock.expectOne('/api/auth/session').flush(session({ authenticated: false }));
    await bootstrapped;

    expect(service.sessionState$$()).toBe(AuthSessionState.Guest);
    httpMock.verify();
  });

  it('moves Unknown -> Guest on a 401 bootstrap error, without setting bootstrapError$$', async () => {
    const { service, httpMock } = setup();

    const bootstrapped = service.ensureBootstrapped();
    httpMock.expectOne('/api/auth/session').flush(null, { status: 401, statusText: 'Unauthorized' });
    await bootstrapped;

    expect(service.sessionState$$()).toBe(AuthSessionState.Guest);
    expect(service.bootstrapError$$()).toBe(false);
    httpMock.verify();
  });

  it('sets bootstrapError$$ and stays Unknown on a non-401 bootstrap error', async () => {
    const { service, httpMock } = setup();

    const bootstrapped = service.ensureBootstrapped();
    httpMock.expectOne('/api/auth/session').flush(null, { status: 500, statusText: 'Server Error' });
    await bootstrapped;

    expect(service.sessionState$$()).toBe(AuthSessionState.Unknown);
    expect(service.bootstrapError$$()).toBe(true);
    httpMock.verify();
  });
});

describe('AuthService.invalidateSession — idempotency', () => {
  it('runs its side effects only once when called twice in a row', async () => {
    const { service, httpMock, networkServiceFake, syncEngineFake, routerFake } = setup();

    const bootstrapped = service.ensureBootstrapped();
    httpMock.expectOne('/api/auth/session').flush(session());
    await bootstrapped;
    expect(service.sessionState$$()).toBe(AuthSessionState.Authenticated);

    service.invalidateSession();
    service.invalidateSession();

    expect(service.sessionState$$()).toBe(AuthSessionState.Guest);
    expect(networkServiceFake.disconnect).toHaveBeenCalledTimes(1);
    expect(syncEngineFake.reset).toHaveBeenCalledTimes(1);
    expect(routerFake.navigateByUrl).toHaveBeenCalledTimes(1);
    httpMock.verify();
  });
});

describe('AuthService — scheduleRenewal delay clipping', () => {
  it('clips a past/near-past expiresAt to a 0ms delay instead of a negative one', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T00:00:00.000Z'));
    const { service, httpMock } = setup();

    const bootstrapped = service.ensureBootstrapped();
    httpMock.expectOne('/api/auth/session').flush(session({ expiresAt: '2026-01-01T00:00:00.000Z' }));
    await bootstrapped;

    // delay = max(0, expiresAt - now - 7days) = max(0, negative) = 0 -> renew() fires immediately.
    await vi.advanceTimersByTimeAsync(0);
    httpMock.expectOne('/api/auth/renew').flush(session());

    httpMock.verify();
    vi.useRealTimers();
  });
});
