import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { computed, inject, Service, signal } from '@angular/core';
import { Router } from '@angular/router';
import { IndexedDbCacheService } from '@app/services/indexed-db-cache.service';
import { NetworkService } from '@app/services/network.service';
import { NotificationService } from '@app/services/notification.service';
import { SyncEngineService } from '@app/services/sync-engine.service';
import { clearAllUserScopedCaches, clearCacheUserId, setCacheUserId } from '@app/shared/cache';
import { SESSION_BOOTSTRAP_TIMEOUT_MS } from '@app/shared/const';
import { SessionResponse, UserCreds } from '@app/shared/types';
import { firstValueFrom } from 'rxjs';
import { timeout } from 'rxjs/operators';

export const AuthSessionState = {
  Unknown: 'unknown',
  Guest: 'guest',
  Authenticated: 'authenticated',
} as const;

export type AuthSessionState = (typeof AuthSessionState)[keyof typeof AuthSessionState];

const RENEW_RETRY_MS = 5 * 60 * 1000;

@Service()
export class AuthService {
  public readonly sessionState$$ = signal<AuthSessionState>(AuthSessionState.Unknown);
  public readonly isAuthenticated$$ = computed(() => this.sessionState$$() === AuthSessionState.Authenticated);
  public readonly bootstrapError$$ = signal(false);
  public readonly isAdmin$$ = signal(false);
  public readonly userId$$ = signal<number | null>(null);
  public readonly sessionGeneration$$ = signal(0);

  private bootstrapPromise: Promise<void> | null = null;
  private renewTimer: ReturnType<typeof setTimeout> | null = null;
  private isInvalidating = false;

  private readonly networkService = inject(NetworkService);
  private readonly http = inject(HttpClient);
  private readonly router = inject(Router);
  private readonly syncEngine = inject(SyncEngineService);
  private readonly notificationService = inject(NotificationService);
  private readonly indexedDbCache = inject(IndexedDbCacheService);

  public constructor() {
    this.networkService.setSessionInvalidationHandler(() => this.invalidateSession());
  }

  public ensureBootstrapped(): Promise<void> {
    if (!this.bootstrapPromise) this.bootstrapPromise = this.bootstrap();
    return this.bootstrapPromise;
  }

  public retryBootstrap(): Promise<void> {
    this.bootstrapError$$.set(false);
    this.bootstrapPromise = null;
    return this.ensureBootstrapped();
  }

  public async login(user: UserCreds): Promise<void> {
    const session = await firstValueFrom(this.http.post<SessionResponse>('/api/auth/login', user));
    this.applySession(session);
  }

  public async register(user: UserCreds): Promise<void> {
    await firstValueFrom(this.http.post('/api/auth/register', user));
  }

  public logout(): void {
    void firstValueFrom(this.http.post<void>('/api/auth/logout', {}))
      .catch(() => undefined)
      .finally(() => this.invalidateSession());
  }

  public invalidateSession(): void {
    if (this.isInvalidating || this.sessionState$$() === AuthSessionState.Guest) return;
    this.isInvalidating = true;
    this.clearRenewTimer();
    this.networkService.disconnect();
    this.syncEngine.reset();
    this.notificationService.clearAll();
    localStorage.removeItem('access_token');
    localStorage.removeItem('refresh_token');
    clearAllUserScopedCaches();
    clearCacheUserId();
    void this.indexedDbCache.clearAllUserScoped();
    this.sessionGeneration$$.update((value) => value + 1);
    this.userId$$.set(null);
    this.isAdmin$$.set(false);
    this.sessionState$$.set(AuthSessionState.Guest);
    this.isInvalidating = false;
    void this.router.navigateByUrl('/auth');
  }

  private async bootstrap(): Promise<void> {
    try {
      const session = await firstValueFrom(
        this.http.get<SessionResponse>('/api/auth/session').pipe(timeout(SESSION_BOOTSTRAP_TIMEOUT_MS)),
      );
      this.applySession(session);
    } catch (error) {
      if (error instanceof HttpErrorResponse && error.status === 401) {
        this.invalidateSession();
        return;
      }
      this.bootstrapError$$.set(true);
    }
  }

  private applySession(session: SessionResponse): void {
    if (!session.authenticated || !Number.isSafeInteger(session.userId) || !session.expiresAt) {
      this.invalidateSession();
      return;
    }
    setCacheUserId(session.userId);
    this.userId$$.set(session.userId);
    this.isAdmin$$.set(session.isAdmin);
    this.sessionState$$.set(AuthSessionState.Authenticated);
    this.bootstrapError$$.set(false);
    this.networkService.connect();
    this.syncEngine.restorePendingOperation();
    this.scheduleRenewal(session.expiresAt);
  }

  private scheduleRenewal(expiresAt: string): void {
    this.clearRenewTimer();
    const delay = Math.max(0, Date.parse(expiresAt) - Date.now() - 7 * 24 * 60 * 60 * 1000);
    this.renewTimer = setTimeout(() => void this.renew(), delay);
  }

  private async renew(): Promise<void> {
    try {
      const session = await firstValueFrom(this.http.post<SessionResponse>('/api/auth/renew', {}));
      this.applySession(session);
    } catch (error) {
      if (!(error instanceof HttpErrorResponse) || error.status !== 401) {
        this.renewTimer = setTimeout(() => void this.renew(), RENEW_RETRY_MS);
      }
    }
  }

  private clearRenewTimer(): void {
    if (this.renewTimer === null) return;
    clearTimeout(this.renewTimer);
    this.renewTimer = null;
  }
}
