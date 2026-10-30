import { HttpClient } from '@angular/common/http';
import { inject } from '@angular/core';
import { LocalStorageService } from '@app/services/local-storage.service';
import { NetworkService } from '@app/services/network.service';
import { SyncEngineService, SyncOperationInput } from '@app/services/sync-engine.service';

export abstract class BaseFoodService {
  protected readonly http = inject(HttpClient);
  protected readonly localStorageService = inject(LocalStorageService);
  protected readonly networkService = inject(NetworkService);
  protected readonly syncEngine = inject(SyncEngineService);

  protected abstract getStorageKey(): string;

  protected saveToLocalStorage<T>(data: T): void {
    this.localStorageService.setUserScoped(this.getStorageKey(), data);
  }

  protected loadFromLocalStorage<T>(): T | null {
    return this.localStorageService.getUserScoped<T>(this.getStorageKey());
  }

  protected checkNetworkAvailability(): boolean {
    return this.networkService.isNetworkAvailable$$();
  }

  protected addSyncOperation<TResponse>(operation: SyncOperationInput<TResponse>): void {
    this.syncEngine.addOperation(operation);
  }
}
