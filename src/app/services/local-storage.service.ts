import { Injectable } from '@angular/core';
import { buildCacheKey, hasCacheUser } from '@app/shared/cache';

@Injectable({
  providedIn: 'root',
})
export class LocalStorageService {
  public getUserScoped<T>(baseKey: string): T | null {
    if (!hasCacheUser()) return null;
    return this.get<T>(buildCacheKey(baseKey));
  }

  public setUserScoped<T>(baseKey: string, data: T): void {
    if (!hasCacheUser()) return;
    this.set(buildCacheKey(baseKey), data);
  }

  public removeUserScoped(baseKey: string): void {
    if (!hasCacheUser()) return;
    this.remove(buildCacheKey(baseKey));
  }

  public get<T>(key: string): T | null {
    try {
      const item = localStorage.getItem(key);
      return item ? JSON.parse(item) : null;
    } catch (error) {
      console.error(`Error reading from localStorage for key "${key}":`, error);
      return null;
    }
  }

  public set<T>(key: string, data: T): void {
    try {
      localStorage.setItem(key, JSON.stringify(data));
    } catch (error) {
      console.error(`Error writing to localStorage for key "${key}":`, error);
    }
  }

  public remove(key: string): void {
    try {
      localStorage.removeItem(key);
    } catch (error) {
      console.error(`Error removing from localStorage for key "${key}":`, error);
    }
  }

  public clear(): void {
    try {
      localStorage.clear();
    } catch (error) {
      console.error('Error clearing localStorage:', error);
    }
  }

  public exists(key: string): boolean {
    return localStorage.getItem(key) !== null;
  }
}
