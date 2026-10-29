import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { AuthService, AuthSessionState } from '@app/services/auth.service';
import { LocalStorageService } from '@app/services/local-storage.service';
import { NetworkService } from '@app/services/network.service';
import { NotificationService } from '@app/services/notification.service';
import { SyncEngineService } from '@app/services/sync-engine.service';
import { SETTINGS_AUTO_SAVE_DEBOUNCE_MS } from '@app/shared/const';
import { IncomingWsMessage } from '@app/shared/types';
import { Subject } from 'rxjs';
import { NamespaceSettingsStore } from './namespace-settings-store';

interface TestSettings {
  a: number;
  b: string;
}

const DEFAULTS: TestSettings = { a: 0, b: 'x' };

function setup() {
  const localStorageFake: Pick<LocalStorageService, 'getUserScoped' | 'setUserScoped'> = {
    getUserScoped: vi.fn(() => null),
    setUserScoped: vi.fn(),
  };
  const networkServiceFake: Pick<NetworkService, 'wsMessages$'> = { wsMessages$: new Subject<IncomingWsMessage>() };
  const notificationServiceFake: Pick<NotificationService, 'showSyncError'> = { showSyncError: vi.fn() };
  const syncEngineFake: Pick<SyncEngineService, 'addOperation'> = { addOperation: vi.fn() };
  const sessionState$$ = signal<AuthSessionState>(AuthSessionState.Unknown);
  const sessionGeneration$$ = signal(0);
  const authServiceFake: Pick<AuthService, 'sessionState$$' | 'sessionGeneration$$' | 'ensureBootstrapped'> = {
    sessionState$$,
    sessionGeneration$$,
    ensureBootstrapped: vi.fn(() => Promise.resolve()),
  };

  TestBed.configureTestingModule({
    providers: [
      provideHttpClient(),
      provideHttpClientTesting(),
      { provide: LocalStorageService, useValue: localStorageFake },
      { provide: NetworkService, useValue: networkServiceFake },
      { provide: NotificationService, useValue: notificationServiceFake },
      { provide: SyncEngineService, useValue: syncEngineFake },
      { provide: AuthService, useValue: authServiceFake },
    ],
  });

  const store = TestBed.runInInjectionContext(() => new NamespaceSettingsStore<TestSettings>('test-ns', DEFAULTS));

  return {
    store,
    httpMock: TestBed.inject(HttpTestingController),
    syncEngineFake,
    notificationServiceFake,
    sessionState$$,
    sessionGeneration$$,
  };
}

describe('NamespaceSettingsStore.set — debounced auto-save', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('applies every set() optimistically and immediately, but sends only one debounced PUT for a burst', () => {
    const { store, syncEngineFake } = setup();

    store.set('a', 1);
    store.set('a', 2);
    store.set('b', 'y');
    expect(store.value$$()).toEqual({ a: 2, b: 'y' });
    expect(syncEngineFake.addOperation).not.toHaveBeenCalled();

    vi.advanceTimersByTime(SETTINGS_AUTO_SAVE_DEBOUNCE_MS);

    expect(syncEngineFake.addOperation).toHaveBeenCalledTimes(1);
    expect(syncEngineFake.addOperation).toHaveBeenCalledWith(expect.objectContaining({ data: { a: 2, b: 'y' } }));
  });

  it('rolls back to the value from before the whole burst (not the last intermediate one) on failure, and notifies both the caller and the user', () => {
    const { store, syncEngineFake, notificationServiceFake } = setup();
    const onRollback = vi.fn();

    store.set('a', 1, onRollback);
    store.set('a', 2, onRollback);
    vi.advanceTimersByTime(SETTINGS_AUTO_SAVE_DEBOUNCE_MS);

    const addOperationSpy = syncEngineFake.addOperation as ReturnType<typeof vi.fn>;
    const { rollbackCallback } = addOperationSpy.mock.calls[0][0] as { rollbackCallback: () => void };
    rollbackCallback();

    expect(store.value$$().a).toBe(0); // pre-burst value, not 1 (the first intermediate set())
    expect(onRollback).toHaveBeenCalledWith(0);
    expect(notificationServiceFake.showSyncError).toHaveBeenCalledWith('Failed to save settings');
  });
});

describe('NamespaceSettingsStore — load binding to sessionGeneration$$', () => {
  async function readyAndMaybeFlush(
    store: NamespaceSettingsStore<TestSettings>,
    httpMock: HttpTestingController,
    expectsNewRequest: boolean,
  ): Promise<void> {
    const pending = store.ready();
    if (expectsNewRequest) {
      await Promise.resolve();
      httpMock.expectOne('/api/settings/test-ns').flush({ a: 5, b: 'server' });
    }
    await pending;
  }

  it('loads once per authenticated sessionGeneration$$, not again on a same-generation renewal, and reloads on a fresh post-logout login', async () => {
    const { store, httpMock, sessionState$$, sessionGeneration$$ } = setup();

    sessionState$$.set(AuthSessionState.Authenticated);
    sessionGeneration$$.set(1);
    await readyAndMaybeFlush(store, httpMock, true);
    expect(store.value$$()).toEqual({ a: 5, b: 'server' });

    // Renewal: state re-confirmed Authenticated, generation unchanged -> no second load.
    sessionState$$.set(AuthSessionState.Authenticated);
    await readyAndMaybeFlush(store, httpMock, false);
    expect(store.value$$()).toEqual({ a: 5, b: 'server' }); // unchanged, no reload happened

    // Logout -> Guest: resets to defaults, no HTTP call.
    sessionState$$.set(AuthSessionState.Guest);
    await readyAndMaybeFlush(store, httpMock, false);
    expect(store.value$$()).toEqual(DEFAULTS);

    // Fresh login after logout, generation bumped -> triggers a new load.
    sessionState$$.set(AuthSessionState.Authenticated);
    sessionGeneration$$.set(2);
    await readyAndMaybeFlush(store, httpMock, true);
    expect(store.value$$()).toEqual({ a: 5, b: 'server' });

    httpMock.verify();
  });
});
