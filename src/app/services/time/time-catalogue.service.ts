import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { computed, effect, inject, Service, Signal, signal, WritableSignal } from '@angular/core';
import { AuthService, AuthSessionState } from '@app/services/auth.service';
import { LocalStorageService } from '@app/services/local-storage.service';
import { NotificationService } from '@app/services/notification.service';
import { TelemetryService } from '@app/services/telemetry.service';
import {
  ActivityKind,
  ActivityKindInput,
  Catalog,
  CategoryGroup,
  CategoryGroupInput,
  CategoryGroupKind,
  CategoryOption,
  CategoryOptionInput,
} from '@app/shared/time-types';
import { firstValueFrom, Observable } from 'rxjs';

interface DataResponse<T> {
  success: boolean;
  data: T;
}

type CreateResponse = DataResponse<{ id: number }>;

interface MutationMessages {
  success: string;
  error: string;
}

const CATALOGUE_STORAGE_KEY = 'time_catalogue';

@Service()
export class TimeCatalogueService {
  private readonly http = inject(HttpClient);
  private readonly localStorageService = inject(LocalStorageService);
  private readonly notificationService = inject(NotificationService);
  private readonly authService = inject(AuthService);
  private readonly telemetry = inject(TelemetryService);

  public readonly activityKinds$$: WritableSignal<ActivityKind[]> = signal([]);
  public readonly categoryGroups$$: WritableSignal<CategoryGroup[]> = signal([]);
  public readonly categoryOptions$$: WritableSignal<CategoryOption[]> = signal([]);

  public readonly activityKindById$$: Signal<Map<number, ActivityKind>> = computed(
    () => new Map(this.activityKinds$$().map((kind) => [kind.id, kind])),
  );
  public readonly groupById$$: Signal<Map<number, CategoryGroup>> = computed(
    () => new Map(this.categoryGroups$$().map((group) => [group.id, group])),
  );
  public readonly areaGroupId$$: Signal<number | null> = computed(
    () =>
      this.categoryGroups$$().find((group) => group.kind === CategoryGroupKind.Area && !group.isArchived)?.id ?? null,
  );
  public readonly optionById$$: Signal<Map<number, CategoryOption>> = computed(
    () => new Map(this.categoryOptions$$().map((option) => [option.id, option])),
  );
  public readonly optionsByGroupId$$: Signal<Map<number, CategoryOption[]>> = computed(() => {
    const index = new Map<number, CategoryOption[]>();
    for (const option of this.categoryOptions$$()) {
      const list = index.get(option.groupId);
      if (list) {
        list.push(option);
      } else {
        index.set(option.groupId, [option]);
      }
    }
    return index;
  });
  public readonly applicableGroupsByKindId$$: Signal<Map<number, number[]>> = computed(() => {
    const index = new Map<number, number[]>();
    for (const kind of this.activityKinds$$()) {
      index.set(
        kind.id,
        kind.groupBindings.map((binding) => binding.groupId),
      );
    }
    return index;
  });
  public readonly requiredGroupIdsByKindId$$: Signal<Map<number, Set<number>>> = computed(() => {
    const index = new Map<number, Set<number>>();
    for (const kind of this.activityKinds$$()) {
      index.set(
        kind.id,
        new Set(kind.groupBindings.filter((binding) => binding.required).map((binding) => binding.groupId)),
      );
    }
    return index;
  });

  private readonly resetOnAuthLossEffect$$ = effect(() => {
    if (this.authService.sessionState$$() === AuthSessionState.Guest) {
      this.reset();
    }
  });

  public reset(): void {
    this.activityKinds$$.set([]);
    this.categoryGroups$$.set([]);
    this.categoryOptions$$.set([]);
  }

  //                                                            ~~~ BOOTSTRAP ~~~

  // Called on every entry to the screen: shows the cached catalogue at once, then refreshes it.
  public loadData(): void {
    const cached = this.localStorageService.getUserScoped<Catalog>(CATALOGUE_STORAGE_KEY);
    if (cached) {
      this.telemetry.measure(
        'time.catalogue_apply',
        () => this.applyCatalog(cached),
        () => ({ source: 'cache', activityKinds: cached.activityKinds.length }),
      );
    }

    void this.fetchCatalog();
  }

  private async fetchCatalog(): Promise<void> {
    const startedAt = performance.now();
    try {
      const response = await firstValueFrom(this.http.get<DataResponse<Catalog>>('/api/time/catalog'));
      this.applyCatalog(response.data);
      this.writeCache();
      void this.telemetry.recordAfterPaint('time.catalogue_apply', startedAt, {
        source: 'server',
        activityKinds: response.data.activityKinds.length,
      });
    } catch (error) {
      console.error('Failed loading time catalog:', error);
    }
  }

  private applyCatalog(catalog: Catalog): void {
    this.activityKinds$$.set(catalog.activityKinds);
    this.categoryGroups$$.set(catalog.categoryGroups);
    this.categoryOptions$$.set(catalog.categoryOptions);
  }

  private writeCache(): void {
    this.localStorageService.setUserScoped<Catalog>(CATALOGUE_STORAGE_KEY, {
      activityKinds: this.activityKinds$$(),
      categoryGroups: this.categoryGroups$$(),
      categoryOptions: this.categoryOptions$$(),
    });
  }

  // Runs a write request and resolves with its response once the server confirmed it, or null
  // when it failed — callers only touch local state on a non-null result. The server's own
  // reason (e.g. "group is still bound to an active activity kind") wins over the generic text.
  private async send<T>(request$: Observable<T>, messages: MutationMessages): Promise<T | null> {
    try {
      const response = await firstValueFrom(request$);
      this.notificationService.addNotification('success', messages.success);
      return response;
    } catch (error) {
      console.error(`${messages.error}:`, error);
      this.notificationService.addNotification('error', serverErrorReason(error) ?? messages.error);
      return null;
    }
  }

  //                                                       ~~~ ACTIVITY KINDS ~~~

  public async createActivityKind(input: ActivityKindInput): Promise<boolean> {
    const response = await this.send(this.http.post<CreateResponse>('/api/time/activity-kinds', input), {
      success: 'Activity kind added',
      error: 'Failed to save activity kind',
    });
    if (!response) return false;
    const now = new Date().toISOString();
    this.activityKinds$$.update((kinds) => [
      ...kinds,
      { ...input, id: response.data.id, createdAt: now, updatedAt: now },
    ]);
    this.writeCache();
    return true;
  }

  public async updateActivityKind(kindId: number, input: ActivityKindInput): Promise<boolean> {
    const response = await this.send(this.http.put(`/api/time/activity-kinds/${kindId}`, input), {
      success: 'Changes saved',
      error: 'Failed to save changes',
    });
    if (!response) return false;
    this.activityKinds$$.update((kinds) => kinds.map((kind) => (kind.id === kindId ? { ...kind, ...input } : kind)));
    this.writeCache();
    return true;
  }

  //                                                      ~~~ CATEGORY GROUPS ~~~

  public async createCategoryGroup(input: CategoryGroupInput): Promise<boolean> {
    const response = await this.send(this.http.post<CreateResponse>('/api/time/category-groups', input), {
      success: 'Group added',
      error: 'Failed to save group',
    });
    if (!response) return false;
    const now = new Date().toISOString();
    this.categoryGroups$$.update((groups) => [
      ...groups,
      { ...input, id: response.data.id, createdAt: now, updatedAt: now },
    ]);
    this.writeCache();
    return true;
  }

  public async updateCategoryGroup(groupId: number, input: CategoryGroupInput): Promise<boolean> {
    const response = await this.send(this.http.put(`/api/time/category-groups/${groupId}`, input), {
      success: 'Changes saved',
      error: 'Failed to save changes',
    });
    if (!response) return false;
    this.categoryGroups$$.update((groups) =>
      groups.map((group) => (group.id === groupId ? { ...group, ...input } : group)),
    );
    this.writeCache();
    return true;
  }

  public async deleteCategoryGroup(groupId: number): Promise<boolean> {
    const response = await this.send(this.http.delete(`/api/time/category-groups/${groupId}`), {
      success: 'Group deleted',
      error: 'Failed to delete group (still has options or is bound to an activity kind)',
    });
    if (!response) return false;
    this.categoryGroups$$.update((groups) => groups.filter((group) => group.id !== groupId));
    this.writeCache();
    return true;
  }

  //                                                     ~~~ CATEGORY OPTIONS ~~~

  public async createCategoryOption(input: CategoryOptionInput): Promise<boolean> {
    const response = await this.send(this.http.post<CreateResponse>('/api/time/category-options', input), {
      success: 'Option added',
      error: 'Failed to save option',
    });
    if (!response) return false;
    const now = new Date().toISOString();
    this.categoryOptions$$.update((options) => [
      ...options,
      { ...input, id: response.data.id, createdAt: now, updatedAt: now },
    ]);
    this.writeCache();
    return true;
  }

  public async updateCategoryOption(optionId: number, input: CategoryOptionInput): Promise<boolean> {
    const response = await this.send(this.http.put(`/api/time/category-options/${optionId}`, input), {
      success: 'Changes saved',
      error: 'Failed to save changes',
    });
    if (!response) return false;
    this.categoryOptions$$.update((options) =>
      options.map((option) => (option.id === optionId ? { ...option, ...input } : option)),
    );
    this.writeCache();
    return true;
  }

  public async deleteCategoryOption(optionId: number): Promise<boolean> {
    const response = await this.send(this.http.delete(`/api/time/category-options/${optionId}`), {
      success: 'Option deleted',
      error: 'Failed to delete option (used by existing entries)',
    });
    if (!response) return false;
    this.categoryOptions$$.update((options) => options.filter((option) => option.id !== optionId));
    this.writeCache();
    return true;
  }
}

// Backend errors come back as `{ success: false, error: "<message>" }`.
function serverErrorReason(error: unknown): string | null {
  if (!(error instanceof HttpErrorResponse)) return null;
  const body: unknown = error.error;
  if (typeof body !== 'object' || body === null || !('error' in body)) return null;
  return typeof body.error === 'string' ? body.error : null;
}
