import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { AuthService, AuthSessionState } from '@app/services/auth.service';
import { LocalStorageService } from '@app/services/local-storage.service';
import { NotificationService } from '@app/services/notification.service';
import { TelemetryService } from '@app/services/telemetry.service';
import { Catalog, CategoryGroup, CategoryGroupKind } from '@app/shared/time-types';
import { createTelemetryFake } from '@app/testing/telemetry.fake';
import { TimeCatalogueService } from './time-catalogue.service';

const areaGroup: CategoryGroup = {
  id: 1,
  name: 'Area',
  kind: CategoryGroupKind.Area,
  isArchived: false,
  createdAt: '',
  updatedAt: '',
};

function setup() {
  const storage = new Map<string, unknown>();
  const addNotification = vi.fn();

  TestBed.configureTestingModule({
    providers: [
      provideHttpClient(),
      provideHttpClientTesting(),
      {
        provide: LocalStorageService,
        useValue: {
          getUserScoped: (key: string) => storage.get(key) ?? null,
          setUserScoped: (key: string, value: unknown) => storage.set(key, value),
        },
      },
      { provide: NotificationService, useValue: { addNotification } },
      { provide: AuthService, useValue: { sessionState$$: signal(AuthSessionState.Authenticated) } },
      { provide: TelemetryService, useValue: createTelemetryFake() },
    ],
  });

  return {
    service: TestBed.inject(TimeCatalogueService),
    httpMock: TestBed.inject(HttpTestingController),
    storage,
    addNotification,
  };
}

describe('TimeCatalogueService.loadData', () => {
  it('applies and caches the catalogue from the server', async () => {
    const { service, httpMock, storage } = setup();
    const catalog: Catalog = { activityKinds: [], categoryGroups: [areaGroup], categoryOptions: [] };

    service.loadData();
    httpMock.expectOne('/api/time/catalog').flush({ success: true, data: catalog });
    await Promise.resolve();

    expect(service.categoryGroups$$()).toEqual([areaGroup]);
    expect(service.areaGroupId$$()).toBe(1);
    expect(storage.get('time_catalogue')).toEqual(catalog);
    httpMock.verify();
  });
});

describe('TimeCatalogueService mutations', () => {
  it('adds a created group with the server id only after the server confirmed it', async () => {
    const { service, httpMock, addNotification } = setup();

    const saved = service.createCategoryGroup({ name: 'Source', kind: null, isArchived: false });
    expect(service.categoryGroups$$()).toEqual([]);

    httpMock.expectOne('/api/time/category-groups').flush({ success: true, data: { id: 9 } });

    expect(await saved).toBe(true);
    expect(service.categoryGroups$$().map((group) => [group.id, group.name])).toEqual([[9, 'Source']]);
    expect(addNotification).toHaveBeenCalledWith('success', 'Group added');
    httpMock.verify();
  });

  it('leaves state unchanged on a refusal and shows the server reason', async () => {
    const { service, httpMock, addNotification } = setup();

    const saved = service.createCategoryGroup({ name: 'Area 2', kind: CategoryGroupKind.Area, isArchived: false });
    httpMock
      .expectOne('/api/time/category-groups')
      .flush({ success: false, error: 'only one area group is allowed' }, { status: 409, statusText: 'Conflict' });

    expect(await saved).toBe(false);
    expect(service.categoryGroups$$()).toEqual([]);
    expect(addNotification).toHaveBeenCalledWith('error', 'only one area group is allowed');
    httpMock.verify();
  });

  it('falls back to the generic message when the server gives no reason', async () => {
    const { service, httpMock, addNotification } = setup();

    const deleted = service.deleteCategoryOption(3);
    httpMock.expectOne('/api/time/category-options/3').flush(null, { status: 500, statusText: 'Server Error' });

    expect(await deleted).toBe(false);
    expect(addNotification).toHaveBeenCalledWith('error', 'Failed to delete option (used by existing entries)');
    httpMock.verify();
  });

  it('removes a group once the delete is confirmed', async () => {
    const { service, httpMock } = setup();
    service.categoryGroups$$.set([areaGroup]);

    const deleted = service.deleteCategoryGroup(1);
    httpMock.expectOne('/api/time/category-groups/1').flush({ success: true });

    expect(await deleted).toBe(true);
    expect(service.categoryGroups$$()).toEqual([]);
    httpMock.verify();
  });
});
