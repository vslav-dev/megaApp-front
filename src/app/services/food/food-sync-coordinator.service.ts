import { HttpClient } from '@angular/common/http';
import { effect, inject, Service } from '@angular/core';
import { AuthService, AuthSessionState } from '@app/services/auth.service';
import { LocalStorageService } from '@app/services/local-storage.service';
import { NetworkService } from '@app/services/network.service';
import { TelemetryService } from '@app/services/telemetry.service';
import {
  CatalogueVersionResponse,
  IncomingWsMessage,
  UserDataLastModifiedTs,
  WebSocketMessageType,
} from '@app/shared/types';
import { calculateTodayIsoWithUserTimeShift } from '@app/shared/utils';
import { firstValueFrom } from 'rxjs';
import { FoodCatalogueService } from './food-catalogue.service';
import { FoodDiaryService } from './food-diary.service';
import { FoodPersonalKcalsService } from './food-personal-kcals.service';
import { FoodStatsService } from './food-stats.service';

// Single owner of "how does the food section get from cold/stale to fully up to date" (§2.4 of
// plan 28) — replaces three previously independent mechanisms: FoodDiaryService's own
// handleSyncStatus (diary itself excluded — the original bug), FoodCatalogueService's bare
// connected$ resubscribe (search replay only, no data catch-up), and each service silently
// trusting whatever it last happened to load. The one thing this service is deliberately NOT
// responsible for: diary's own day-to-day segment fetching as the user navigates the calendar —
// that stays exactly as before (ensureDiarySegmentEffect$$ in FoodDiaryService).
@Service()
export class FoodSyncCoordinatorService {
  // Calendar date of the last confirmed-complete sync (bootstrap or a successful catch-up) —
  // §2.2. A reconnect re-fetches diary [checkpoint, today] inclusive instead of guessing a fixed
  // window, so a tab backgrounded for an hour and one backgrounded for a month both converge
  // correctly, just at different cost. Editing a day *before* the checkpoint on another device
  // during the disconnect window is the one accepted gap (see plan §2.2) — negligible probability,
  // closed anyway by ordinary calendar navigation or a reload.
  private readonly CHECKPOINT_STORAGE_KEY = 'food_sync_checkpoint';
  private lastSyncTs = 0;

  private readonly http = inject(HttpClient);
  private readonly authService = inject(AuthService);
  private readonly networkService = inject(NetworkService);
  private readonly localStorageService = inject(LocalStorageService);
  private readonly telemetry = inject(TelemetryService);
  private readonly foodDiaryService = inject(FoodDiaryService);
  private readonly foodCatalogueService = inject(FoodCatalogueService);
  private readonly foodStatsService = inject(FoodStatsService);
  private readonly foodPersonalKcalsService = inject(FoodPersonalKcalsService);

  private readonly resetOnAuthLossEffect$$ = effect(() => {
    if (this.authService.sessionState$$() === AuthSessionState.Guest) {
      this.clearCheckpoint();
      this.lastSyncTs = 0;
    }
  });

  public constructor() {
    this.networkService.wsMessages$.subscribe((message: IncomingWsMessage) => {
      if (message.type === WebSocketMessageType.SYNC_STATUS && this.isValidSyncStatusPayload(message.payload)) {
        void this.handleSyncStatus(message.payload);
      }
    });
  }

  // Called once when the food screen mounts — the bootstrap "full sync" moment §2.2 measures
  // catch-up ranges from. Diary's own first segment (always ±7 days, so it always covers today)
  // is awaited here too, not left to the reactive effect alone, so the checkpoint is only ever
  // advanced once today's data has actually, verifiably landed.
  public async loadInitialFoodData(): Promise<void> {
    const startedAt = performance.now();
    await Promise.all([
      this.foodDiaryService.ensureTodaySegmentLoaded(),
      this.foodCatalogueService.getCatalogueEntries(),
      this.foodPersonalKcalsService.getPersonalKcals(),
      this.foodStatsService.getStats(),
    ]);

    if (!this.getCheckpoint()) this.setCheckpoint(calculateTodayIsoWithUserTimeShift());
    this.lastSyncTs = Date.now();

    void this.telemetry.recordAfterPaint('food.initial_load', startedAt, {
      catalogueEntries: Object.keys(this.foodCatalogueService.catalogue$$()).length,
      statsDays: this.foodStatsService.loadedDates$$().length,
    });
  }

  private isValidSyncStatusPayload(payload: UserDataLastModifiedTs): payload is UserDataLastModifiedTs {
    return Boolean(payload) && typeof payload.userDataLastModifiedTs === 'number';
  }

  private async handleSyncStatus(payload: UserDataLastModifiedTs): Promise<void> {
    // Catalogue is a global resource, not scoped to this user's own userDataLastModifiedTs (a
    // save by a different user never bumps it) — its freshness check runs on every SYNC_STATUS
    // regardless of the timestamp comparison below.
    void this.ensureCatalogueFreshness();

    if (payload.userDataLastModifiedTs <= this.lastSyncTs) return;
    await this.runCatchUp();
  }

  private async runCatchUp(): Promise<void> {
    const checkpoint = this.getCheckpoint();
    if (!checkpoint) return; // bootstrap hasn't run yet — loadInitialFoodData() owns that case

    const today = calculateTodayIsoWithUserTimeShift();
    if (checkpoint >= today) {
      this.lastSyncTs = Date.now();
      return;
    }

    const startedAt = performance.now();
    const gapDays = this.daysBetween(checkpoint, today);
    // Ignore the segment cache on purpose — after the DB index (§2.1) this is a cheap query, and
    // trusting a segment's "already confirmed this session" flag across a reconnect is exactly
    // the bug this mechanism replaces.
    const sessionGenerationAtStart = this.authService.sessionGeneration$$();

    try {
      await Promise.all([
        this.foodDiaryService.getFoodDiaryFullUpdateRange(today, gapDays),
        this.foodPersonalKcalsService.getPersonalKcals(),
        this.foodStatsService.getStats(),
      ]);
    } catch (error) {
      console.error('Failed to catch up food data after reconnect:', error);
      return;
    }

    // A logout/relogin mid-flight invalidates this result for the session it was started under —
    // discard rather than advance the checkpoint or overwrite a just-loaded fresh session's data.
    if (this.authService.sessionGeneration$$() !== sessionGenerationAtStart) return;

    this.setCheckpoint(today);
    this.lastSyncTs = Date.now();
    void this.telemetry.recordAfterPaint('food.reconnect_catchup', startedAt, { gapDays });
  }

  private async ensureCatalogueFreshness(): Promise<void> {
    const sessionGenerationAtStart = this.authService.sessionGeneration$$();
    try {
      const response = await firstValueFrom(this.http.get<CatalogueVersionResponse>('/api/food/catalogue/version'));
      if (this.authService.sessionGeneration$$() !== sessionGenerationAtStart) return;
      if (response.version !== this.foodCatalogueService.catalogueVersion$$()) {
        await this.foodCatalogueService.getCatalogueEntries();
      }
    } catch (error) {
      console.error('Failed to check catalogue freshness:', error);
    }
  }

  private daysBetween(fromIso: string, toIso: string): number {
    return Math.round((new Date(toIso).getTime() - new Date(fromIso).getTime()) / (1000 * 60 * 60 * 24));
  }

  private getCheckpoint(): string | null {
    return this.localStorageService.getUserScoped<string>(this.CHECKPOINT_STORAGE_KEY);
  }

  private setCheckpoint(dateISO: string): void {
    this.localStorageService.setUserScoped(this.CHECKPOINT_STORAGE_KEY, dateISO);
  }

  private clearCheckpoint(): void {
    this.localStorageService.removeUserScoped(this.CHECKPOINT_STORAGE_KEY);
  }
}
