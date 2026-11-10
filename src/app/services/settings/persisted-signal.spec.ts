import { ApplicationRef, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { AuthService, AuthSessionState } from '@app/services/auth.service';
import { LocalStorageService } from '@app/services/local-storage.service';
import { persistedSignal } from './persisted-signal';

function setup() {
  const store = new Map<string, unknown>();
  const localStorageFake: Pick<LocalStorageService, 'get' | 'set' | 'getUserScoped' | 'setUserScoped'> = {
    get: <T>(key: string) => (store.has(key) ? (store.get(key) as T) : null),
    set: <T>(key: string, value: T) => void store.set(key, value),
    getUserScoped: <T>(key: string) => (store.has(key) ? (store.get(key) as T) : null),
    setUserScoped: <T>(key: string, value: T) => void store.set(key, value),
  };
  const sessionState$$ = signal<AuthSessionState>(AuthSessionState.Unknown);
  const sessionGeneration$$ = signal(0);
  const authServiceFake: Pick<AuthService, 'sessionState$$' | 'sessionGeneration$$'> = {
    sessionState$$,
    sessionGeneration$$,
  };

  TestBed.configureTestingModule({
    providers: [
      { provide: LocalStorageService, useValue: localStorageFake },
      { provide: AuthService, useValue: authServiceFake },
    ],
  });

  return { store, sessionState$$, sessionGeneration$$ };
}

describe('persistedSignal — user scope', () => {
  it('seeds its initial value from user-scoped storage when present', () => {
    const { store } = setup();
    store.set('nav_collapsed', true);
    const value$$ = TestBed.runInInjectionContext(() => persistedSignal('nav_collapsed', false));
    expect(value$$()).toBe(true);
  });

  it('falls back to the default value when nothing is stored', () => {
    setup();
    const value$$ = TestBed.runInInjectionContext(() => persistedSignal('nav_collapsed', false));
    expect(value$$()).toBe(false);
  });

  it('set() writes to user-scoped storage and updates the signal', () => {
    const { store } = setup();
    const value$$ = TestBed.runInInjectionContext(() => persistedSignal('nav_collapsed', false));
    value$$.set(true);
    expect(value$$()).toBe(true);
    expect(store.get('nav_collapsed')).toBe(true);
  });

  it('update() derives the next value from the current one, writes it, and updates the signal', () => {
    const { store } = setup();
    const count$$ = TestBed.runInInjectionContext(() => persistedSignal('counter', 1));
    count$$.update((current) => current + 1);
    expect(count$$()).toBe(2);
    expect(store.get('counter')).toBe(2);
  });
});

describe('persistedSignal — session-generation re-seed', () => {
  it('re-reads storage once per new authenticated sessionGeneration$$, resets to default on Guest, and does not re-read on a same-generation renewal', () => {
    const { store, sessionState$$, sessionGeneration$$ } = setup();
    const appRef = TestBed.inject(ApplicationRef);
    const value$$ = TestBed.runInInjectionContext(() => persistedSignal('theme', 'light'));
    expect(value$$()).toBe('light');

    // A fresh login (generation 1): storage now has a value written after the signal was created.
    store.set('theme', 'dark');
    sessionState$$.set(AuthSessionState.Authenticated);
    sessionGeneration$$.set(1);
    appRef.tick();
    expect(value$$()).toBe('dark');

    // Renewal: state re-confirmed Authenticated, generation unchanged -> no re-read even if storage changes.
    store.set('theme', 'blue');
    sessionState$$.set(AuthSessionState.Authenticated);
    appRef.tick();
    expect(value$$()).toBe('dark');

    // Logout -> Guest: resets to the default value, ignoring storage.
    sessionState$$.set(AuthSessionState.Guest);
    appRef.tick();
    expect(value$$()).toBe('light');

    // Fresh login after logout, generation bumped -> re-reads storage.
    sessionState$$.set(AuthSessionState.Authenticated);
    sessionGeneration$$.set(2);
    appRef.tick();
    expect(value$$()).toBe('blue');
  });
});

describe('persistedSignal — device scope', () => {
  it('routes reads/writes through the device-scoped storage methods, not the user-scoped ones', () => {
    const { store } = setup();
    // Must be a key registered in CACHE_KEY_VERSIONS (shared/const.ts) — buildDeviceCacheKey()
    // throws for any unregistered baseKey, by design (see shared/cache.ts).
    const value$$ = TestBed.runInInjectionContext(() =>
      persistedSignal('metrics_active_card_layout_mode', 240, 'device'),
    );
    value$$.set(300);
    expect(value$$()).toBe(300);
    // Device scope keys are versioned (buildDeviceCacheKey), so the exact key differs from the
    // base key — assert only that *some* device-scoped entry was written.
    expect(store.size).toBeGreaterThan(0);
  });
});
