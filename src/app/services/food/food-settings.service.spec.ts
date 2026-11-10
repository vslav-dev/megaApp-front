import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
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
import { FoodSettingsService } from './food-settings.service';

function setup() {
  const localStorageFake: Pick<LocalStorageService, 'getUserScoped' | 'setUserScoped'> = {
    getUserScoped: vi.fn(() => null),
    setUserScoped: vi.fn(),
  };
  const networkServiceFake: Pick<NetworkService, 'wsMessages$'> = { wsMessages$: new Subject<IncomingWsMessage>() };
  const notificationServiceFake: Pick<NotificationService, 'showSyncError'> = { showSyncError: vi.fn() };
  const syncEngineFake: Pick<SyncEngineService, 'addOperation'> = { addOperation: vi.fn() };
  const authServiceFake: Pick<AuthService, 'sessionState$$' | 'sessionGeneration$$' | 'ensureBootstrapped'> = {
    sessionState$$: signal<AuthSessionState>(AuthSessionState.Unknown),
    sessionGeneration$$: signal(0),
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

  return { service: TestBed.inject(FoodSettingsService), syncEngineFake };
}

describe('FoodSettingsService — BMI bands flag', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('is enabled by default', () => {
    const { service } = setup();

    expect(service.statsWeightBmiBands$$()).toBe(true);
  });

  it('applies a change immediately and sends it to the server under the backend field name', () => {
    const { service, syncEngineFake } = setup();

    service.setStatsWeightBmiBands(false);
    expect(service.statsWeightBmiBands$$()).toBe(false);

    vi.advanceTimersByTime(SETTINGS_AUTO_SAVE_DEBOUNCE_MS);

    expect(syncEngineFake.addOperation).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ statsWeightBmiBands: false }) }),
    );
  });
});
