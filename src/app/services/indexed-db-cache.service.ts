import { Injectable } from '@angular/core';
import { buildCacheKey, hasCacheUser } from '@app/shared/cache';
import {
  idbClearAllUserScopedKvEntries,
  idbClearDays,
  idbClearMetricSeries,
  idbGet,
  idbGetAllMetricSeries,
  idbGetDay,
  idbRemove,
  idbSet,
  idbSetDay,
  idbSetMetricSeries,
} from '@app/shared/idb-cache';

@Injectable({
  providedIn: 'root',
})
export class IndexedDbCacheService {
  public get<T>(baseKey: string): Promise<T | null> {
    if (!hasCacheUser()) return Promise.resolve(null);
    return idbGet<T>(buildCacheKey(baseKey));
  }

  public set<T>(baseKey: string, value: T): Promise<void> {
    if (!hasCacheUser()) return Promise.resolve();
    return idbSet<T>(buildCacheKey(baseKey), value);
  }

  public remove(baseKey: string): Promise<void> {
    if (!hasCacheUser()) return Promise.resolve();
    return idbRemove(buildCacheKey(baseKey));
  }

  public getDay<T>(dateISO: string): Promise<T | null> {
    return idbGetDay<T>(dateISO);
  }

  public setDay<T>(dateISO: string, value: T): Promise<void> {
    return idbSetDay<T>(dateISO, value);
  }

  public clearDays(): Promise<void> {
    return idbClearDays();
  }

  public clearAllUserScoped(): Promise<void> {
    return idbClearAllUserScopedKvEntries();
  }

  public setMetricSeries<T>(seriesKey: string, value: T): Promise<void> {
    return idbSetMetricSeries(seriesKey, value);
  }

  public getAllMetricSeries<T>(): Promise<T[]> {
    return idbGetAllMetricSeries<T>();
  }

  public clearMetricSeries(): Promise<void> {
    return idbClearMetricSeries();
  }
}
