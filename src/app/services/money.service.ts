import { HttpClient } from '@angular/common/http';
import { computed, effect, inject, Service, Signal, signal, WritableSignal } from '@angular/core';
import { AuthService, AuthSessionState } from '@app/services/auth.service';
import { LocalStorageService } from '@app/services/local-storage.service';
import { NamespaceSettingsStore } from '@app/services/settings/namespace-settings-store';
import { TelemetryService } from '@app/services/telemetry.service';
import { firstValueFrom, Observable } from 'rxjs';
import { areSetsEqual } from '../shared/money-utils';
import {
  Account,
  Asset,
  Category,
  Currency,
  MoneyRateHistory,
  Organization,
  Transaction,
  TransactionKind,
} from '../shared/types';
import { SyncEngineService, SyncOperationMode, SyncOperationType } from './sync-engine.service';

export type SuspensionFilter = 'all' | 'exclude' | 'only';

interface BaseResponse {
  success: boolean;
}

interface DataResponse<T> extends BaseResponse {
  data: T;
}

interface MessageResponse extends BaseResponse {
  message?: string;
}

interface AccountApi extends Omit<Account, 'isInvest' | 'isArchived'> {
  isInvest?: boolean | number | string;
  isArchived?: boolean | number | string;
}

interface MoneySnapshot {
  currencies: Currency[];
  categories: Category[];
  organizations: Organization[];
  accounts: Account[];
  assets: Asset[];
  transactions: Transaction[];
  rateHistory: MoneyRateHistory[];
}

type SnapshotResponse = DataResponse<MoneySnapshot>;

export interface ExpenseChartYMaxSetting {
  rawValue: string;
  currencyTicker: string;
}

interface MoneySettings {
  displayCurrency: string;
  chartRangeStart: string | null;
  chartRangeEnd: string | null;
  expenseChartYMax: ExpenseChartYMaxSetting | null;
  convertToUnifiedCurrency: boolean;
  // Checked series of the expense / income chart legends (see money-series.ts for the id space).
  enabledCategoryIds: number[];
  incomeEnabledCategoryIds: number[];
  linkTransactionsToCharts: boolean;
  yearlyMode: boolean;
  showByAccount: boolean;
  suspensionFilter: SuspensionFilter;
  disabledAccountIds: number[];
}

const SNAPSHOT_KEY = 'money_snapshot';

function defaultSettings(): MoneySettings {
  return {
    displayCurrency: 'RUB',
    chartRangeStart: null,
    chartRangeEnd: null,
    expenseChartYMax: null,
    convertToUnifiedCurrency: false,
    enabledCategoryIds: [],
    incomeEnabledCategoryIds: [],
    linkTransactionsToCharts: false,
    yearlyMode: false,
    showByAccount: false,
    suspensionFilter: 'all',
    disabledAccountIds: [],
  };
}

type CreateCurrencyResponse = DataResponse<{ id: number }>;

type CreateCategoryResponse = DataResponse<{ id: number }>;

type CreateOrganizationResponse = DataResponse<{ id: number }>;

type CreateAccountResponse = DataResponse<{ id: number }>;

type CreateAssetResponse = DataResponse<{ id: number }>;

type CreateTransactionResponse = DataResponse<{ id: number; twinId?: number }>;

type BasicResponse = MessageResponse;

@Service()
export class MoneyService {
  private readonly http = inject(HttpClient);
  private readonly syncEngine = inject(SyncEngineService);
  private readonly localStorageService = inject(LocalStorageService);
  private readonly telemetry = inject(TelemetryService);

  public readonly currencies$$: WritableSignal<Currency[]> = signal([]);
  public readonly categories$$: WritableSignal<Category[]> = signal([]);
  public readonly organizations$$: WritableSignal<Organization[]> = signal([]);
  public readonly accounts$$: WritableSignal<Account[]> = signal([]);
  public readonly assets$$: WritableSignal<Asset[]> = signal([]);
  public readonly transactions$$: WritableSignal<Transaction[]> = signal([]);
  public readonly rateHistory$$: WritableSignal<MoneyRateHistory[]> = signal([]);
  private readonly rateSnapshots$$: Signal<{ dateISO: string; rates: Record<string, number> }[]> = computed(() => {
    const sorted = [...this.rateHistory$$()].sort((a, b) => a.dateISO.localeCompare(b.dateISO));
    let accumulated: Record<string, number> = {};
    return sorted.map((item) => {
      accumulated = { ...accumulated, ...(item.ratesJson as Record<string, number>) };
      return { dateISO: item.dateISO, rates: accumulated };
    });
  });
  private readonly settingsStore = new NamespaceSettingsStore<MoneySettings>('money', defaultSettings());

  public readonly displayCurrency$$: Signal<string> = computed(() => this.settingsStore.value$$().displayCurrency);
  public readonly chartRangeStart$$: Signal<string | null> = computed(
    () => this.settingsStore.value$$().chartRangeStart,
  );
  public readonly chartRangeEnd$$: Signal<string | null> = computed(() => this.settingsStore.value$$().chartRangeEnd);
  public readonly expenseChartYMax$$: Signal<ExpenseChartYMaxSetting | null> = computed(
    () => this.settingsStore.value$$().expenseChartYMax,
  );
  public readonly convertToUnifiedCurrency$$: Signal<boolean> = computed(
    () => this.settingsStore.value$$().convertToUnifiedCurrency,
  );
  // Compared by content: any settings write replaces the stored arrays, but readers (charts, the
  // transactions filter) should only recompute when the checked series themselves change.
  public readonly enabledExpenseSeriesIds$$: Signal<Set<number>> = computed(
    () => new Set(this.settingsStore.value$$().enabledCategoryIds),
    { equal: areSetsEqual },
  );
  public readonly enabledIncomeSeriesIds$$: Signal<Set<number>> = computed(
    () => new Set(this.settingsStore.value$$().incomeEnabledCategoryIds),
    { equal: areSetsEqual },
  );
  public readonly linkTransactionsToCharts$$: Signal<boolean> = computed(
    () => this.settingsStore.value$$().linkTransactionsToCharts,
  );
  public readonly yearlyMode$$: Signal<boolean> = computed(() => this.settingsStore.value$$().yearlyMode);
  public readonly showByAccount$$: Signal<boolean> = computed(() => this.settingsStore.value$$().showByAccount);
  public readonly suspensionFilter$$: Signal<SuspensionFilter> = computed(
    () => this.settingsStore.value$$().suspensionFilter,
  );
  public readonly disabledAccountIds$$: Signal<Set<number>> = computed(
    () => new Set(this.settingsStore.value$$().disabledAccountIds),
  );

  // Transaction ids with an edit/delete sitting in the sync queue, not yet confirmed or rolled
  // back. Re-navigating to the money screen re-triggers fetchSnapshot(), which can legitimately
  // return pre-commit server state for these ids while the write is still queued/in flight —
  // mergeSnapshotTransactions() keeps our own state for them instead of letting the snapshot win.
  private readonly pendingTransactionIds = new Set<number>();

  private readonly isDataReady$$: WritableSignal<boolean> = signal(false);
  public readonly isChartDataReady$$ = computed(() => this.isDataReady$$());

  private readonly authService = inject(AuthService);

  private readonly resetOnAuthLossEffect$$ = effect(() => {
    if (this.authService.sessionState$$() === AuthSessionState.Guest) {
      this.reset();
    }
  });

  public setChartRange(start: string | null, end: string | null): void {
    this.settingsStore.set('chartRangeStart', start);
    this.settingsStore.set('chartRangeEnd', end);
  }

  public setDisplayCurrency(id: string): void {
    this.settingsStore.set('displayCurrency', id);
  }

  public setExpenseChartYMax(setting: ExpenseChartYMaxSetting | null): void {
    this.settingsStore.set('expenseChartYMax', setting);
  }

  public setConvertToUnifiedCurrency(value: boolean): void {
    this.settingsStore.set('convertToUnifiedCurrency', value);
  }

  public setEnabledExpenseSeriesIds(ids: ReadonlySet<number>): void {
    this.settingsStore.set('enabledCategoryIds', [...ids]);
  }

  public setEnabledIncomeSeriesIds(ids: ReadonlySet<number>): void {
    this.settingsStore.set('incomeEnabledCategoryIds', [...ids]);
  }

  public setLinkTransactionsToCharts(value: boolean): void {
    this.settingsStore.set('linkTransactionsToCharts', value);
  }

  public setYearlyMode(value: boolean): void {
    this.settingsStore.set('yearlyMode', value);
  }

  public setShowByAccount(value: boolean): void {
    this.settingsStore.set('showByAccount', value);
  }

  public setSuspensionFilter(value: SuspensionFilter): void {
    this.settingsStore.set('suspensionFilter', value);
  }

  public setDisabledAccountIds(ids: ReadonlySet<number>): void {
    this.settingsStore.set('disabledAccountIds', [...ids]);
  }

  public reset(): void {
    this.currencies$$.set([]);
    this.categories$$.set([]);
    this.organizations$$.set([]);
    this.accounts$$.set([]);
    this.assets$$.set([]);
    this.transactions$$.set([]);
    this.rateHistory$$.set([]);
    this.isDataReady$$.set(false);
    this.pendingTransactionIds.clear();
    this.settingsStore.reset();
  }

  //                                                            ~~~ BOOTSTRAP ~~~

  public loadData(): void {
    const cached = this.localStorageService.getUserScoped<MoneySnapshot>(SNAPSHOT_KEY);
    if (cached) {
      this.telemetry.measure(
        'money.snapshot_apply',
        () => this.applySnapshot(cached, true),
        () => ({
          source: 'cache',
          transactions: cached.transactions?.length ?? 0,
        }),
      );
    }

    void this.fetchSnapshot();
  }

  private async fetchSnapshot(): Promise<void> {
    const startedAt = performance.now();
    try {
      const response = await firstValueFrom(this.http.get<SnapshotResponse>('/api/money/snapshot'));
      if (response.success && response.data) {
        this.applySnapshot(response.data, true);
        this.writeCacheSnapshot();
        void this.telemetry.recordAfterPaint('money.snapshot_apply', startedAt, {
          source: 'server',
          transactions: response.data.transactions?.length ?? 0,
          accounts: response.data.accounts?.length ?? 0,
        });
      }
    } catch (error) {
      console.error('Error fetching money snapshot:', error);
    }
  }

  // Runs a write request and resolves with its response once the server confirmed it, or null
  // when it failed or was refused — callers only touch local state on a non-null result.
  private async send<T extends BaseResponse>(request$: Observable<T>, action: string): Promise<T | null> {
    try {
      const response = await firstValueFrom(request$);
      return response.success ? response : null;
    } catch (error) {
      console.error(`Error ${action}:`, error);
      return null;
    }
  }

  private applySnapshot(data: MoneySnapshot, setReady: boolean): void {
    this.currencies$$.set(data.currencies ?? []);
    this.categories$$.set(data.categories ?? []);
    this.organizations$$.set(data.organizations ?? []);
    this.accounts$$.set((data.accounts ?? []).map((a) => this.normalizeAccount(a as AccountApi)));
    this.assets$$.set(data.assets ?? []);
    this.transactions$$.set(this.mergeSnapshotTransactions(this.transactions$$(), data.transactions ?? []));
    if (data.rateHistory?.length) {
      this.rateHistory$$.set(
        data.rateHistory.map((item) => ({ ...item, ratesJson: this.parseRatesJson(item.ratesJson) })),
      );
    }
    if (setReady) this.isDataReady$$.set(true);
  }

  // A snapshot refetch (re-navigating to the money screen) can legitimately reflect
  // not-yet-committed server state for a transaction we have a pending edit/delete queued for
  // (see pendingTransactionIds). For those ids specifically, keep our own state instead of the
  // snapshot's — and if we've already removed one locally, don't let a stale snapshot bring it back.
  private mergeSnapshotTransactions(current: Transaction[], incoming: Transaction[]): Transaction[] {
    if (this.pendingTransactionIds.size === 0) return incoming;

    const currentById = new Map(current.filter((tx) => tx.id !== undefined).map((tx) => [tx.id!, tx]));
    const merged: Transaction[] = [];

    for (const tx of incoming) {
      if (tx.id !== undefined && this.pendingTransactionIds.has(tx.id)) {
        const pending = currentById.get(tx.id);
        if (pending) merged.push(pending);
        continue;
      }
      merged.push(tx);
    }

    return merged;
  }

  private writeCacheSnapshot(): void {
    const snapshot: MoneySnapshot = {
      currencies: this.currencies$$(),
      categories: this.categories$$(),
      organizations: this.organizations$$(),
      accounts: this.accounts$$(),
      assets: this.assets$$(),
      transactions: this.transactions$$(),
      rateHistory: this.rateHistory$$(),
    };
    this.localStorageService.setUserScoped(SNAPSHOT_KEY, snapshot);
  }

  private parseRatesJson(ratesJson: Record<string, number> | string): Record<string, number> {
    if (ratesJson && typeof ratesJson === 'object') {
      return ratesJson;
    }

    if (typeof ratesJson === 'string') {
      try {
        const parsed: unknown = JSON.parse(ratesJson);
        if (parsed && typeof parsed === 'object') {
          return parsed as Record<string, number>;
        }
      } catch {
        return {};
      }
    }

    return {};
  }

  //                                                          ~~~ CURRENCIES ~~~

  public async createCurrency(currencyData: Currency): Promise<boolean> {
    const response = await this.send(
      this.http.post<CreateCurrencyResponse>('/api/money/currencies', currencyData),
      'creating currency',
    );
    if (!response?.data?.id) return false;
    this.addCurrencyToState({ id: response.data.id, ...currencyData });
    return true;
  }

  public async updateCurrency(currencyData: Currency): Promise<boolean> {
    if (!currencyData.id) {
      console.error('Currency ID is required for update');
      return false;
    }

    const response = await this.send(
      this.http.put<BasicResponse>(`/api/money/currencies/${currencyData.id}`, currencyData),
      'updating currency',
    );
    if (!response) return false;
    this.updateCurrencyInState(currencyData);
    return true;
  }

  public async deleteCurrency(currencyId: number): Promise<boolean> {
    const response = await this.send(
      this.http.delete<BasicResponse>(`/api/money/currencies/${currencyId}`),
      'deleting currency',
    );
    if (!response) return false;
    this.removeCurrencyFromState(currencyId);
    return true;
  }

  private addCurrencyToState(currency: Currency): void {
    this.currencies$$.update((currencies: Currency[]) => [...currencies, currency]);
  }

  private updateCurrencyInState(updatedCurrency: Currency): void {
    this.currencies$$.update((currencies: Currency[]) =>
      currencies.map((currency: Currency) =>
        currency.id === updatedCurrency.id ? { ...currency, ...updatedCurrency } : currency,
      ),
    );
  }

  private removeCurrencyFromState(currencyId: number): void {
    this.currencies$$.update((currencies: Currency[]) =>
      currencies.filter((currency: Currency) => currency.id !== currencyId),
    );
  }

  //                                                          ~~~ CATEGORIES ~~~

  public async createCategory(categoryData: Category): Promise<boolean> {
    const response = await this.send(
      this.http.post<CreateCategoryResponse>('/api/money/categories', categoryData),
      'creating category',
    );
    if (!response?.data?.id) return false;
    this.addCategoryToState({ id: response.data.id, ...categoryData });
    return true;
  }

  public async updateCategory(categoryData: Category): Promise<boolean> {
    if (!categoryData.id) {
      console.error('Category ID is required for update');
      return false;
    }

    const response = await this.send(
      this.http.put<BasicResponse>(`/api/money/categories/${categoryData.id}`, categoryData),
      'updating category',
    );
    if (!response) return false;
    this.updateCategoryInState(categoryData);
    return true;
  }

  public async deleteCategory(categoryId: number): Promise<boolean> {
    const response = await this.send(
      this.http.delete<BasicResponse>(`/api/money/categories/${categoryId}`),
      'deleting category',
    );
    if (!response) return false;
    this.removeCategoryFromState(categoryId);
    return true;
  }

  private addCategoryToState(category: Category): void {
    this.categories$$.update((categories: Category[]) => [...categories, category]);
  }

  private updateCategoryInState(updatedCategory: Category): void {
    this.categories$$.update((categories: Category[]) =>
      categories.map((category: Category) =>
        category.id === updatedCategory.id ? { ...category, ...updatedCategory } : category,
      ),
    );
  }

  private removeCategoryFromState(categoryId: number): void {
    this.categories$$.update((categories: Category[]) =>
      categories.filter((category: Category) => category.id !== categoryId),
    );
  }

  //                                                        ~~~ ORGANIZATIONS ~~~

  public async createOrganization(organizationData: Organization): Promise<boolean> {
    const response = await this.send(
      this.http.post<CreateOrganizationResponse>('/api/money/organizations', organizationData),
      'creating organization',
    );
    if (!response?.data?.id) return false;
    this.addOrganizationToState({ id: response.data.id, ...organizationData });
    return true;
  }

  public async updateOrganization(organizationData: Organization): Promise<boolean> {
    if (!organizationData.id) {
      console.error('Organization ID is required for update');
      return false;
    }

    const response = await this.send(
      this.http.put<BasicResponse>(`/api/money/organizations/${organizationData.id}`, organizationData),
      'updating organization',
    );
    if (!response) return false;
    this.updateOrganizationInState(organizationData);
    return true;
  }

  public async deleteOrganization(organizationId: number): Promise<boolean> {
    const response = await this.send(
      this.http.delete<BasicResponse>(`/api/money/organizations/${organizationId}`),
      'deleting organization',
    );
    if (!response) return false;
    this.removeOrganizationFromState(organizationId);
    return true;
  }

  private addOrganizationToState(organization: Organization): void {
    this.organizations$$.update((organizations: Organization[]) => [...organizations, organization]);
  }

  private updateOrganizationInState(updatedOrganization: Organization): void {
    this.organizations$$.update((organizations: Organization[]) =>
      organizations.map((organization: Organization) =>
        organization.id === updatedOrganization.id ? { ...organization, ...updatedOrganization } : organization,
      ),
    );
  }

  private removeOrganizationFromState(organizationId: number): void {
    this.organizations$$.update((organizations: Organization[]) =>
      organizations.filter((organization: Organization) => organization.id !== organizationId),
    );
  }

  //                                                            ~~~ ACCOUNTS ~~~

  public async createAccount(accountData: Account): Promise<boolean> {
    const response = await this.send(
      this.http.post<CreateAccountResponse>('/api/money/accounts', this.toAccountApiPayload(accountData)),
      'creating account',
    );
    if (!response?.data?.id) return false;
    this.addAccountToState({ id: response.data.id, ...accountData });
    return true;
  }

  public async updateAccount(accountData: Account): Promise<boolean> {
    if (!accountData.id) {
      console.error('Account ID is required for update');
      return false;
    }

    const response = await this.send(
      this.http.put<BasicResponse>(`/api/money/accounts/${accountData.id}`, this.toAccountApiPayload(accountData)),
      'updating account',
    );
    if (!response) return false;
    this.updateAccountInState(accountData);
    return true;
  }

  public async deleteAccount(accountId: number): Promise<boolean> {
    const response = await this.send(
      this.http.delete<BasicResponse>(`/api/money/accounts/${accountId}`),
      'deleting account',
    );
    if (!response) return false;
    this.removeAccountFromState(accountId);
    return true;
  }

  private addAccountToState(account: Account): void {
    this.accounts$$.update((accounts: Account[]) => [...accounts, account]);
  }

  private updateAccountInState(updatedAccount: Account): void {
    this.accounts$$.update((accounts: Account[]) =>
      accounts.map((account: Account) =>
        account.id === updatedAccount.id ? { ...account, ...updatedAccount } : account,
      ),
    );
  }

  private removeAccountFromState(accountId: number): void {
    this.accounts$$.update((accounts: Account[]) => accounts.filter((account: Account) => account.id !== accountId));
  }

  private normalizeAccount(account: AccountApi): Account {
    return {
      id: account.id,
      title: account.title,
      currencyId: account.currencyId,
      isInvest: this.toBoolean(account.isInvest),
      isArchived: this.toBoolean(account.isArchived),
      kind: account.kind,
      organizationId: account.organizationId ?? null,
    };
  }

  private toAccountApiPayload(accountData: Account): AccountApi {
    return {
      id: accountData.id,
      title: accountData.title,
      currencyId: accountData.currencyId,
      isInvest: this.toBoolean(accountData.isInvest),
      isArchived: this.toBoolean(accountData.isArchived),
      kind: accountData.kind,
      organizationId: accountData.organizationId ?? null,
    };
  }

  private toBoolean(value: boolean | number | string | undefined): boolean {
    return value === true || value === 1 || value === '1' || value === 'true';
  }

  //                                                              ~~~ ASSETS ~~~

  public async createAsset(assetData: Asset): Promise<boolean> {
    const response = await this.send(
      this.http.post<CreateAssetResponse>('/api/money/assets', assetData),
      'creating asset',
    );
    if (!response?.data?.id) return false;
    this.addAssetToState({ id: response.data.id, ...assetData });
    return true;
  }

  public async updateAsset(assetData: Asset): Promise<boolean> {
    if (!assetData.id) {
      console.error('Asset ID is required for update');
      return false;
    }

    const response = await this.send(
      this.http.put<BasicResponse>(`/api/money/assets/${assetData.id}`, assetData),
      'updating asset',
    );
    if (!response) return false;
    this.updateAssetInState(assetData);
    return true;
  }

  public async deleteAsset(assetId: number): Promise<boolean> {
    const response = await this.send(
      this.http.delete<BasicResponse>(`/api/money/assets/${assetId}`),
      'deleting asset',
    );
    if (!response) return false;
    this.removeAssetFromState(assetId);
    return true;
  }

  private addAssetToState(asset: Asset): void {
    this.assets$$.update((assets: Asset[]) => [...assets, asset]);
  }

  private updateAssetInState(updatedAsset: Asset): void {
    this.assets$$.update((assets: Asset[]) =>
      assets.map((asset: Asset) => (asset.id === updatedAsset.id ? { ...asset, ...updatedAsset } : asset)),
    );
  }

  private removeAssetFromState(assetId: number): void {
    this.assets$$.update((assets: Asset[]) => assets.filter((asset: Asset) => asset.id !== assetId));
  }

  //                                                        ~~~ TRANSACTIONS ~~~

  // The transaction writes are optimistic: local state changes at once and the sync engine
  // confirms or rolls back later, so there is nothing for a caller to wait for.
  public createTransaction(transactionData: Transaction): void {
    const tempId = Date.now();
    const snapshot = this.transactions$$();

    this.addTransactionToState({ ...transactionData, id: tempId });

    this.syncEngine.addOperation({
      mode: SyncOperationMode.Optimistic,
      type: SyncOperationType.CREATE,
      endpoint: '/api/money/transactions',
      data: transactionData,
      successCallback: (response: CreateTransactionResponse) => {
        if (response.success && response.data?.id) {
          this.transactions$$.update((txs) =>
            txs.map((tx) => (tx.id === tempId ? { ...tx, id: response.data.id } : tx)),
          );
        }
        this.writeCacheSnapshot();
      },
      rollbackCallback: () => {
        this.transactions$$.set(snapshot);
      },
    });
  }

  public updateTransaction(transactionData: Transaction): void {
    if (!transactionData.id) {
      console.error('Transaction ID is required for update');
      return;
    }

    const snapshot = this.transactions$$();
    this.updateTransactionInState(transactionData);
    this.pendingTransactionIds.add(transactionData.id);

    this.syncEngine.addOperation({
      mode: SyncOperationMode.Optimistic,
      type: SyncOperationType.UPDATE,
      endpoint: `/api/money/transactions/${transactionData.id}`,
      data: transactionData,
      successCallback: () => {
        this.pendingTransactionIds.delete(transactionData.id!);
        this.writeCacheSnapshot();
      },
      rollbackCallback: () => {
        this.pendingTransactionIds.delete(transactionData.id!);
        this.transactions$$.set(snapshot);
      },
    });
  }

  public deleteTransaction(transactionId: number): void {
    const snapshot = this.transactions$$();
    const twinId = snapshot.find((transaction) => transaction.id === transactionId)?.twinId;
    this.removeTransactionPairFromState(transactionId);
    this.pendingTransactionIds.add(transactionId);
    if (twinId != null) {
      this.pendingTransactionIds.add(twinId);
    }

    this.syncEngine.addOperation({
      mode: SyncOperationMode.Optimistic,
      type: SyncOperationType.DELETE,
      endpoint: `/api/money/transactions/${transactionId}`,
      data: {},
      successCallback: () => {
        this.pendingTransactionIds.delete(transactionId);
        if (twinId != null) {
          this.pendingTransactionIds.delete(twinId);
        }
        this.writeCacheSnapshot();
      },
      rollbackCallback: () => {
        this.pendingTransactionIds.delete(transactionId);
        if (twinId != null) {
          this.pendingTransactionIds.delete(twinId);
        }
        this.transactions$$.set(snapshot);
      },
    });
  }

  public createTransfer(transferData: {
    dateISO: string;
    accountId: number;
    amount: number;
    twinAccountId: number;
    twinAmount: number;
    notes?: string;
  }): void {
    const tempId1 = Date.now();
    const tempId2 = tempId1 + 1;
    const snapshot = this.transactions$$();

    this.transactions$$.update((txs) => [
      {
        id: tempId1,
        dateISO: transferData.dateISO,
        accountId: transferData.accountId,
        amount: transferData.amount,
        categoryId: null,
        kind: TransactionKind.TRANSFER,
        isGift: false,
        notes: transferData.notes,
        detailsJSON: JSON.stringify({ direction: 'out' }),
        twinId: tempId2,
      },
      {
        id: tempId2,
        dateISO: transferData.dateISO,
        accountId: transferData.twinAccountId,
        amount: transferData.twinAmount,
        categoryId: null,
        kind: TransactionKind.TRANSFER,
        isGift: false,
        notes: transferData.notes,
        detailsJSON: JSON.stringify({ direction: 'in' }),
        twinId: tempId1,
      },
      ...txs,
    ]);

    this.syncEngine.addOperation({
      mode: SyncOperationMode.Optimistic,
      type: SyncOperationType.CREATE,
      endpoint: '/api/money/transactions',
      data: { ...transferData, kind: TransactionKind.TRANSFER, isGift: false, categoryId: null },
      successCallback: (response: CreateTransactionResponse) => {
        if (response.success && response.data?.id && response.data?.twinId) {
          this.transactions$$.update((txs) =>
            txs.map((tx) => {
              if (tx.id === tempId1) return { ...tx, id: response.data.id, twinId: response.data.twinId };
              if (tx.id === tempId2) return { ...tx, id: response.data.twinId, twinId: response.data.id };
              return tx;
            }),
          );
        }
        this.writeCacheSnapshot();
      },
      rollbackCallback: () => {
        this.transactions$$.set(snapshot);
      },
    });
  }

  public updateTransfer(transferData: {
    id: number;
    twinId: number;
    dateISO: string;
    accountId: number;
    amount: number;
    twinAccountId: number;
    twinAmount: number;
    notes?: string;
  }): void {
    const snapshot = this.transactions$$();
    this.updateTransferInState(transferData);
    this.pendingTransactionIds.add(transferData.id);
    this.pendingTransactionIds.add(transferData.twinId);

    this.syncEngine.addOperation({
      mode: SyncOperationMode.Optimistic,
      type: SyncOperationType.UPDATE,
      endpoint: `/api/money/transactions/${transferData.id}`,
      data: {
        dateISO: transferData.dateISO,
        accountId: transferData.accountId,
        amount: transferData.amount,
        twinAccountId: transferData.twinAccountId,
        twinAmount: transferData.twinAmount,
        kind: TransactionKind.TRANSFER,
        isGift: false,
        categoryId: null,
        notes: transferData.notes,
      },
      successCallback: () => {
        this.pendingTransactionIds.delete(transferData.id);
        this.pendingTransactionIds.delete(transferData.twinId);
        this.writeCacheSnapshot();
      },
      rollbackCallback: () => {
        this.pendingTransactionIds.delete(transferData.id);
        this.pendingTransactionIds.delete(transferData.twinId);
        this.transactions$$.set(snapshot);
      },
    });
  }

  private addTransactionToState(transaction: Transaction): void {
    this.transactions$$.update((transactions: Transaction[]) => [transaction, ...transactions]);
  }

  private updateTransactionInState(updatedTransaction: Transaction): void {
    this.transactions$$.update((transactions: Transaction[]) =>
      transactions.map((transaction: Transaction) =>
        transaction.id === updatedTransaction.id ? { ...transaction, ...updatedTransaction } : transaction,
      ),
    );
  }

  private removeTransactionFromState(transactionId: number): void {
    this.transactions$$.update((transactions: Transaction[]) =>
      transactions.filter((transaction: Transaction) => transaction.id !== transactionId),
    );
  }

  private removeTransactionPairFromState(transactionId: number): void {
    const transactions = this.transactions$$();
    const target = transactions.find((transaction) => transaction.id === transactionId);
    const twinId = target?.twinId;

    this.transactions$$.update((items: Transaction[]) =>
      items.filter((transaction) => transaction.id !== transactionId && transaction.id !== twinId),
    );
  }

  private updateTransferInState(transferData: {
    id: number;
    twinId: number;
    dateISO: string;
    accountId: number;
    amount: number;
    twinAccountId: number;
    twinAmount: number;
    notes?: string;
  }): void {
    this.transactions$$.update((transactions: Transaction[]) =>
      transactions.map((transaction: Transaction) => {
        if (transaction.id === transferData.id) {
          return {
            ...transaction,
            dateISO: transferData.dateISO,
            accountId: transferData.accountId,
            amount: transferData.amount,
            notes: transferData.notes,
          };
        }

        if (transaction.id === transferData.twinId) {
          return {
            ...transaction,
            dateISO: transferData.dateISO,
            accountId: transferData.twinAccountId,
            amount: transferData.twinAmount,
            notes: transferData.notes,
          };
        }

        return transaction;
      }),
    );
  }

  public getRatesForDate(dateISO: string): Record<string, number> | null {
    const snapshots = this.rateSnapshots$$();
    if (!snapshots.length) return null;

    let lo = 0,
      hi = snapshots.length - 1,
      result = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (snapshots[mid].dateISO <= dateISO) {
        result = mid;
        lo = mid + 1;
      } else {
        hi = mid - 1;
      }
    }

    return result >= 0 ? snapshots[result].rates : null;
  }
}
