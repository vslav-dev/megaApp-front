import { provideHttpClient, withXhr } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { AuthService, AuthSessionState } from '@app/services/auth.service';
import { IndexedDbCacheService } from '@app/services/indexed-db-cache.service';
import { LocalStorageService } from '@app/services/local-storage.service';
import { NetworkService } from '@app/services/network.service';
import { NotificationService } from '@app/services/notification.service';
import { SyncEngineService, SyncOperationType } from '@app/services/sync-engine.service';
import { TelemetryService } from '@app/services/telemetry.service';
import { DiaryEntry, HistoryEntryAction } from '@app/shared/types';
import { Subject } from 'rxjs';
import { FoodCatalogueService } from './food-catalogue.service';
import { FoodDiaryService } from './food-diary.service';
import { FoodPersonalKcalsService } from './food-personal-kcals.service';
import { FoodSettingsService } from './food-settings.service';

function setup() {
  const addOperation = vi.fn();
  const recordAfterPaint = vi.fn(() => Promise.resolve());
  TestBed.configureTestingModule({
    providers: [
      provideHttpClient(withXhr()),
      provideHttpClientTesting(),
      { provide: NetworkService, useValue: { wsMessages$: new Subject<unknown>(), isNetworkAvailable$$: signal(true) } },
      { provide: SyncEngineService, useValue: { addOperation } },
      { provide: LocalStorageService, useValue: { getUserScoped: () => null, setUserScoped: vi.fn() } },
      { provide: AuthService, useValue: { sessionState$$: signal(AuthSessionState.Unknown) } },
      { provide: NotificationService, useValue: { addNotification: vi.fn() } },
      {
        provide: TelemetryService,
        useValue: {
          measure: (_operation: string, work: () => unknown) => work(),
          record: vi.fn(),
          recordAfterPaint,
        },
      },
      { provide: IndexedDbCacheService, useValue: { setDay: vi.fn(() => Promise.resolve()) } },
      { provide: FoodCatalogueService, useValue: { catalogue$$: signal({}) } },
      { provide: FoodPersonalKcalsService, useValue: { personalKcals$$: signal({}) } },
      { provide: FoodSettingsService, useValue: { reset: vi.fn(), height$$: signal(null) } },
    ],
  });
  return { service: TestBed.inject(FoodDiaryService), addOperation, recordAfterPaint };
}

const entry: DiaryEntry = {
  id: 0,
  dateISO: '2026-10-30',
  foodCatalogueId: 5,
  foodWeight: 80,
  kcals: 0,
  history: [{ action: HistoryEntryAction.INIT, value: 80 }],
};

describe('FoodDiaryService.createDiaryEntry search query', () => {
  it('sends the query to the server next to the entry', async () => {
    const { service, addOperation } = setup();

    await service.createDiaryEntry(entry, 'конфеты');

    expect(addOperation).toHaveBeenCalledWith(
      expect.objectContaining({
        type: SyncOperationType.CREATE,
        endpoint: '/api/food/diary/',
        data: { ...entry, searchQuery: 'конфеты' },
      }),
    );
  });

  it.each([null, ''])('sends the entry alone when the query is %j', async (searchQuery) => {
    const { service, addOperation } = setup();

    await service.createDiaryEntry(entry, searchQuery);

    expect(addOperation).toHaveBeenCalledWith(expect.objectContaining({ data: entry }));
  });

  // TODO(plan 48 debug): remove with the hasQuery and queryLength telemetry attributes.
  it.each([
    ['конфеты', { hasQuery: true, queryLength: 7 }],
    [null, { hasQuery: false, queryLength: 0 }],
  ])('reports in telemetry whether the create carried the query %j', async (searchQuery, expected) => {
    const { service, recordAfterPaint } = setup();

    await service.createDiaryEntry(entry, searchQuery);

    expect(recordAfterPaint).toHaveBeenCalledWith('food.diary_mutation', expect.any(Number), {
      mutationType: 'create',
      ...expected,
    });
  });

  it('leaves the entry itself without the query', async () => {
    const { service } = setup();

    await service.createDiaryEntry(entry, 'конфеты');

    expect(entry).not.toHaveProperty('searchQuery');
  });
});
