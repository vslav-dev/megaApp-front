import { effect, inject, signal, WritableSignal } from '@angular/core';
import { AuthService, AuthSessionState } from '@app/services/auth.service';
import { LocalStorageService } from '@app/services/local-storage.service';
import { buildDeviceCacheKey } from '@app/shared/cache';

export type PersistedSignalScope = 'user' | 'device';

// A signal that writes itself to localStorage on every set()/update() and seeds its initial
// value from there. `scope: 'user'` (the default) keys storage per logged-in user; `'device'`
// keys it globally for the browser (e.g. navbar collapsed state, which shouldn't follow the
// user between devices). Must be called from an injection context, same as signal()/inject().
export function persistedSignal<T>(
  key: string,
  defaultValue: T,
  scope: PersistedSignalScope = 'user',
): WritableSignal<T> {
  const localStorageService = inject(LocalStorageService);

  const read = (): T | null =>
    scope === 'user'
      ? localStorageService.getUserScoped<T>(key)
      : localStorageService.get<T>(buildDeviceCacheKey(key));
  const write = (value: T): void => {
    if (scope === 'user') localStorageService.setUserScoped(key, value);
    else localStorageService.set(buildDeviceCacheKey(key), value);
  };

  const state = signal<T>(read() ?? defaultValue);
  const applySet = state.set;

  // user-scoped storage is keyed by the logged-in user, but this can be created before the
  // session is known (e.g. root-level services constructed at app boot, while still a guest) —
  // seeding read() ?? defaultValue above then reads under the wrong (guest) key and never
  // retries. Re-read once a real session settles, keyed by sessionGeneration so a renewal
  // doesn't re-trigger it and a fresh login (after a prior logout, which bumps the generation)
  // does. device-scoped values don't depend on which user is logged in, so this is a no-op there.
  if (scope === 'user') {
    const authService = inject(AuthService);
    let loadedForGeneration = -1;

    effect(() => {
      const sessionState = authService.sessionState$$();
      if (sessionState === AuthSessionState.Authenticated) {
        const generation = authService.sessionGeneration$$();
        if (loadedForGeneration !== generation) {
          loadedForGeneration = generation;
          applySet(read() ?? defaultValue);
        }
      } else if (sessionState === AuthSessionState.Guest && loadedForGeneration !== -1) {
        loadedForGeneration = -1;
        applySet(defaultValue);
      }
    });
  }

  return Object.assign(state, {
    set: (value: T): void => {
      write(value);
      applySet(value);
    },
    update: (updateFn: (current: T) => T): void => {
      const next = updateFn(state());
      write(next);
      applySet(next);
    },
  });
}
