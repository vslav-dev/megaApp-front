import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { LocalStorageService } from '@app/services/local-storage.service';
import { NotificationService } from '@app/services/notification.service';
import { TelemetryService } from '@app/services/telemetry.service';
import { createTelemetryFake } from '@app/testing/telemetry.fake';
import {
  OptimisticSyncOperation,
  SyncEngineService,
  SyncOperationMode,
  SyncOperationType,
} from './sync-engine.service';

function setup() {
  const localStorageFake: Pick<LocalStorageService, 'getUserScoped' | 'setUserScoped' | 'removeUserScoped'> = {
    getUserScoped: vi.fn(() => null),
    setUserScoped: vi.fn(),
    removeUserScoped: vi.fn(),
  };
  const notificationServiceFake: Pick<NotificationService, 'addNotification' | 'removeNotification'> = {
    addNotification: vi.fn(() => 'notification-id'),
    removeNotification: vi.fn(),
  };

  TestBed.configureTestingModule({
    providers: [
      provideHttpClient(),
      provideHttpClientTesting(),
      { provide: LocalStorageService, useValue: localStorageFake },
      { provide: NotificationService, useValue: notificationServiceFake },
      { provide: TelemetryService, useValue: createTelemetryFake() },
    ],
  });

  return {
    service: TestBed.inject(SyncEngineService),
    httpMock: TestBed.inject(HttpTestingController),
    localStorageFake,
  };
}

function optimisticOperation(overrides: Partial<OptimisticSyncOperation> = {}): OptimisticSyncOperation {
  return {
    type: SyncOperationType.CREATE,
    endpoint: '/api/things',
    data: { name: 'x' },
    mode: SyncOperationMode.Optimistic,
    ...overrides,
  };
}

describe('SyncEngineService — retryability', () => {
  it('does not retry a 400 (terminal) error and calls rollbackCallback once', async () => {
    const { service, httpMock } = setup();
    const rollbackCallback = vi.fn();

    service.addOperation(optimisticOperation({ rollbackCallback }));

    const req = httpMock.expectOne('/api/things');
    req.flush({ error: 'bad request' }, { status: 400, statusText: 'Bad Request' });
    await vi.waitFor(() => expect(rollbackCallback).toHaveBeenCalledTimes(1));

    httpMock.expectNone('/api/things');
    expect(rollbackCallback).toHaveBeenCalledWith({ status: 400, body: { error: 'bad request' } });
    httpMock.verify();
  });

  it('retries a 429 (retryable) error with a 1s*retryCount backoff, then succeeds', async () => {
    vi.useFakeTimers();
    const { service, httpMock } = setup();
    const successCallback = vi.fn();

    service.addOperation(optimisticOperation({ successCallback }));

    httpMock.expectOne('/api/things').flush(null, { status: 429, statusText: 'Too Many Requests' });
    await vi.advanceTimersByTimeAsync(1000); // backoff after 1st failure (1000 * retryCount=1)

    httpMock.expectOne('/api/things').flush({ id: 1 });
    await vi.advanceTimersByTimeAsync(0);

    expect(successCallback).toHaveBeenCalledWith({ id: 1 });
    httpMock.verify();
    vi.useRealTimers();
  });

  it('gives up after BACKGROUND_SYNC_RETRIES_MAX attempts and calls rollbackCallback', async () => {
    vi.useFakeTimers();
    const { service, httpMock } = setup();
    const rollbackCallback = vi.fn();

    service.addOperation(optimisticOperation({ rollbackCallback }));

    httpMock.expectOne('/api/things').flush(null, { status: 500, statusText: 'Server Error' });
    await vi.advanceTimersByTimeAsync(1000);
    httpMock.expectOne('/api/things').flush(null, { status: 500, statusText: 'Server Error' });
    await vi.advanceTimersByTimeAsync(2000);
    httpMock.expectOne('/api/things').flush(null, { status: 500, statusText: 'Server Error' });
    await vi.advanceTimersByTimeAsync(0);

    expect(rollbackCallback).toHaveBeenCalledTimes(1);
    httpMock.expectNone('/api/things');
    httpMock.verify();
    vi.useRealTimers();
  });
});

describe('SyncEngineService — pending-operation persistence', () => {
  it('persists the operation before the request settles, and clears it once the request succeeds', async () => {
    const { service, httpMock, localStorageFake } = setup();

    service.addOperation(optimisticOperation());

    expect(localStorageFake.setUserScoped).toHaveBeenCalledWith(
      'sync_pending_operation',
      expect.objectContaining({ type: SyncOperationType.CREATE, endpoint: '/api/things' }),
    );
    expect(localStorageFake.removeUserScoped).not.toHaveBeenCalled();

    httpMock.expectOne('/api/things').flush({ id: 1 });
    await vi.waitFor(() => expect(localStorageFake.removeUserScoped).toHaveBeenCalledWith('sync_pending_operation'));
    httpMock.verify();
  });

  it('restorePendingOperation() resends a persisted operation with the same operationId and no feedback', async () => {
    const { service, httpMock, localStorageFake } = setup();
    (localStorageFake.getUserScoped as ReturnType<typeof vi.fn>).mockReturnValue({
      type: SyncOperationType.UPDATE,
      endpoint: '/api/things/1',
      data: { name: 'restored' },
      operationId: 'persisted-op-id',
    });

    service.restorePendingOperation();

    const req = httpMock.expectOne('/api/things/1');
    expect(req.request.method).toBe('PUT');
    expect(req.request.body).toEqual({ name: 'restored', operationId: 'persisted-op-id' });
    req.flush({ ok: true });
    httpMock.verify();
  });
});
