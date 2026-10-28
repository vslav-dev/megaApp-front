import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  computed,
  effect,
  inject,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { KeyboardService } from '@app/services/keyboard.service';
import { MoneyComputeService } from '@app/services/money-compute.service';
import { MoneyService } from '@app/services/money.service';
import { TelemetryService } from '@app/services/telemetry.service';
import { DefaultModal } from '@app/shared/components/default-modal/default-modal';
import { FormModal } from '@app/shared/components/form-modal/form-modal';
import { sumDayTotals } from '@app/shared/day-totals';
import { SeriesChart, filterByEnabledSeries } from '@app/shared/money-series';
import { areArraysShallowEqual, convertAmount } from '@app/shared/money-utils';
import { groupNumberText } from '@app/shared/number-format';
import {
  AccountKind,
  Asset,
  Currency,
  Organization,
  SymbolPosition,
  Transaction,
  TransactionKind,
} from '@app/shared/types';
import { VButton } from '@ui-kit/components/v-button/v-button';
import { VCard } from '@ui-kit/components/v-card/v-card';
import { IconName, VIcon } from '@ui-kit/components/v-icon/v-icon';
import { TransactionForm } from './transaction-form/transaction-form';

interface TransactionGroup {
  date: string;
  dateDisplay: string;
  transactions: Transaction[];
}

type AmountSign = '+' | '-' | '';

interface DayTotalsDisplay {
  income: string | null;
  expense: string | null;
}

interface GroupMeasurement {
  startY: number;
  height: number;
  group: TransactionGroup;
}

@Component({
  selector: 'transactions-list',
  templateUrl: './transactions-list.html',
  styleUrl: './transactions-list.scss',
  imports: [DefaultModal, FormModal, TransactionForm, VButton, VCard, VIcon],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class TransactionsList {
  protected readonly Icon = IconName;

  private readonly moneyService = inject(MoneyService);
  private readonly moneyComputeService = inject(MoneyComputeService);
  private readonly keyboardService = inject(KeyboardService);
  private readonly telemetry = inject(TelemetryService);

  private readonly shortcutSubscription = this.keyboardService
    .shortcut$({
      code: 'KeyN',
      when: () => !this.showForm$$(),
    })
    .pipe(takeUntilDestroyed())
    .subscribe(() => {
      this.showNewTransactionForm();
    });

  private readonly currencies$$ = computed(() => this.moneyService.currencies$$());
  private readonly categories$$ = computed(() => this.moneyService.categories$$());
  private readonly accounts$$ = computed(() => this.moneyService.accounts$$());
  private readonly organizations$$ = computed(() => this.moneyService.organizations$$());
  private readonly assets$$ = computed(() => this.moneyService.assets$$());
  private readonly displayCurrency$$ = computed(() => this.moneyService.displayCurrency$$());
  private readonly displayCurrencyInfo$$ = computed(() =>
    this.currencies$$().find((currency) => currency.ticker === this.displayCurrency$$()),
  );
  private readonly currencyByAccountId$$ = computed(() => {
    const currencyById = new Map(this.currencies$$().map((currency) => [currency.id, currency]));
    const currencyByAccountId = new Map<number, Currency>();
    for (const account of this.accounts$$()) {
      const currency = currencyById.get(account.currencyId);
      if (account.id !== undefined && currency) currencyByAccountId.set(account.id, currency);
    }
    return currencyByAccountId;
  });
  protected readonly isRatesReady$$ = computed(() => this.moneyService.isChartDataReady$$());
  protected readonly convertToUnifiedCurrency$$ = this.moneyService.convertToUnifiedCurrency$$;

  protected readonly isLinkedToCharts$$ = computed(() => this.moneyService.linkTransactionsToCharts$$());

  // With the "follow charts" mode on, only transactions feeding a checked chart series are listed —
  // the same series resolver the charts are built with. Off: the very same array, no copy.
  private readonly visibleTransactions$$ = computed(() => {
    const transactions = this.moneyService.transactions$$();
    if (!this.isLinkedToCharts$$()) return transactions;
    return filterByEnabledSeries(transactions, this.moneyComputeService.seriesResolver$$(), {
      [SeriesChart.EXPENSE]: this.moneyService.enabledExpenseSeriesIds$$(),
      [SeriesChart.INCOME]: this.moneyService.enabledIncomeSeriesIds$$(),
    });
  });

  // A shorter list can leave the scroll window past its end; start from the top after any filter change.
  private readonly scrollToTopOnFilterChange = effect(() => {
    if (!this.isLinkedToCharts$$()) return;
    this.moneyService.enabledExpenseSeriesIds$$();
    this.moneyService.enabledIncomeSeriesIds$$();
    untracked(() => this.scrollContainerElem()?.nativeElement.scrollTo({ top: 0 }));
  });

  protected readonly groupedTransactions$$ = computed(() =>
    this.telemetry.measure(
      'money.transaction_list_model',
      () => this.groupTransactionsByDate(),
      (groups) => ({
        groups: groups.length,
        transactions: groups.reduce((total, group) => total + group.transactions.length, 0),
      }),
    ),
  );
  protected readonly isDeleteConfirmOpen$$ = signal(false);

  private readonly pendingDeleteId$$ = signal<number | null>(null);

  protected readonly showForm$$ = signal(false);
  protected readonly formDateISO$$ = signal<string | null>(null);
  protected readonly editingTransaction$$ = signal<Transaction | null>(null);

  private readonly scrollContainerElem = viewChild<ElementRef<HTMLDivElement>>('scrollContainer');

  private readonly HEADER_HEIGHT = 24;
  private readonly TRANSACTION_HEIGHT = 32;
  private readonly GROUP_BOTTOM_MARGIN = 16;
  private readonly BUFFER_PX = 1200;

  protected readonly containerHeight = 893;

  private readonly scrollTop$$ = signal(0);

  protected readonly isAtTop$$ = computed(() => this.scrollTop$$() === 0);

  private readonly groupMeasurements$$ = computed<GroupMeasurement[]>(() => {
    const groups = this.groupedTransactions$$();
    let y = 0;
    return groups.map((group) => {
      const height =
        this.HEADER_HEIGHT + group.transactions.length * this.TRANSACTION_HEIGHT + this.GROUP_BOTTOM_MARGIN;
      const measurement: GroupMeasurement = { startY: y, height, group };
      y += height;
      return measurement;
    });
  });

  protected readonly totalScrollHeight$$ = computed(() => {
    const measurements = this.groupMeasurements$$();
    if (!measurements.length) return 0;
    const last = measurements[measurements.length - 1];
    return last.startY + last.height;
  });

  // Scrolling inside the same set of groups yields an equal window, so nothing derived from it reruns.
  protected readonly visibleMeasurements$$ = computed(
    () => {
      const measurements = this.groupMeasurements$$();
      const scrollTop = this.scrollTop$$();
      const visibleBottom = scrollTop + this.containerHeight;
      return measurements.filter(
        (m) => m.startY + m.height > scrollTop - this.BUFFER_PX && m.startY < visibleBottom + this.BUFFER_PX,
      );
    },
    { equal: areArraysShallowEqual },
  );

  // Sums for the rendered days only, of exactly the transactions listed for each (so the follow-charts
  // filter applies), always in the display currency: rows may show native amounts, but a day spans
  // several accounts. Rates are the last known ones on or before the day (see getRatesForDate).
  protected readonly dayTotalsByDate$$ = computed(() => {
    const totalsByDate = new Map<string, DayTotalsDisplay>();
    for (const { group } of this.visibleMeasurements$$()) {
      const totals = sumDayTotals(group.transactions, (transaction) =>
        this.toDisplayAmount(transaction.accountId, transaction.amount, transaction.dateISO),
      );
      totalsByDate.set(group.date, {
        income: totals.income === null ? null : this.formatDisplayAmount(totals.income, '+'),
        expense: totals.expense === null ? null : this.formatDisplayAmount(totals.expense, '-'),
      });
    }
    return totalsByDate;
  });

  protected readonly paddingTop$$ = computed(() => {
    const visible = this.visibleMeasurements$$();
    return visible.length ? visible[0].startY : 0;
  });

  protected readonly paddingBottom$$ = computed(() => {
    const visible = this.visibleMeasurements$$();
    const total = this.totalScrollHeight$$();
    if (!visible.length) return total;
    const last = visible[visible.length - 1];
    return total - (last.startY + last.height);
  });

  protected onScroll(event: Event): void {
    this.scrollTop$$.set((event.target as HTMLElement).scrollTop);
  }

  protected showNewTransactionForm(): void {
    this.formDateISO$$.set(this.getTodayDateISO());
    this.editingTransaction$$.set(null);
    this.showForm$$.set(true);
  }

  protected showEditTransactionForm(transaction: Transaction): void {
    this.editingTransaction$$.set(transaction);
    this.formDateISO$$.set(null);
    this.showForm$$.set(true);
  }

  protected hideForm(): void {
    this.showForm$$.set(false);
  }

  protected getKindDisplayName(kind: TransactionKind): string {
    switch (kind) {
      case TransactionKind.INCOME:
        return 'Income';
      case TransactionKind.EXPENSE:
        return 'Expense';
      case TransactionKind.TRANSFER:
        return 'Transfer';
      case TransactionKind.INVEST_BUY:
        return 'invest buy';
      case TransactionKind.INVEST_SELL:
        return 'invest sell';
      case TransactionKind.INVEST_DIVIDEND:
        return 'invest dividend';
      default:
        return kind;
    }
  }

  protected getPrimaryLine(transaction: Transaction): string {
    if (transaction.kind === TransactionKind.TRANSFER) {
      return this.getTransferAccountLine(transaction);
    }

    if (this.isInvestKind(transaction.kind)) {
      return `${this.getAccountTitle(transaction.accountId)} - ${this.getKindDisplayName(transaction.kind)}`;
    }

    return this.getAccountTitle(transaction.accountId);
  }

  protected getAccountKindIcon(accountId: number): IconName {
    const account = this.accounts$$().find((a) => a.id === accountId);
    if (!account) return IconName.AccountBalanceWallet;

    switch (account.kind) {
      case AccountKind.CASH:
        return IconName.UniversalCurrencyAlt;
      case AccountKind.CARD:
        return IconName.CreditCard;
      case AccountKind.CHECKING:
        return IconName.AccountBalance;
      case AccountKind.DEPOSIT:
        return IconName.Savings;
      case AccountKind.BROKERAGE:
        return IconName.CandlestickChart;
      case AccountKind.CRYPTO:
        return IconName.CurrencyBitcoin;
      default:
        return IconName.AccountBalanceWallet;
    }
  }

  protected getAccountOrgLogoSrc(accountId: number): string | null {
    const account = this.accounts$$().find((a) => a.id === accountId);
    if (!account?.organizationId) return null;

    const org = this.organizations$$().find((o: Organization) => o.id === account.organizationId);
    if (!org?.logoBase64) return null;

    return `data:image/png;base64,${org.logoBase64}`;
  }

  protected getTransferOrgLogoSrc(transaction: Transaction): string | null {
    const twin = this.getTwinTransaction(transaction);
    if (!twin) return null;
    return this.getAccountOrgLogoSrc(twin.accountId);
  }

  protected getTransferAccountKindIcon(transaction: Transaction): IconName {
    const twin = this.getTwinTransaction(transaction);
    if (!twin) return IconName.AccountBalanceWallet;
    return this.getAccountKindIcon(twin.accountId);
  }

  protected getInvestSharesLine(transaction: Transaction): string | null {
    if (!this.isInvestKind(transaction.kind)) return null;

    const details = this.parseDetails(transaction.detailsJSON);
    const assetId = this.toPositiveNumber(details?.assetId);
    if (assetId == null) return null;

    const ticker = this.getAssetTicker(assetId);
    if (transaction.kind === TransactionKind.INVEST_DIVIDEND) {
      return ticker;
    }

    const quantity = this.toPositiveNumber(details?.quantity);
    if (quantity == null) return ticker;

    const sign = transaction.kind === TransactionKind.INVEST_BUY ? '+' : '-';
    return `${sign}${this.formatSharesQuantity(quantity)} shares ${ticker}`;
  }

  protected getAccountTitle(accountId: number): string {
    const account = this.accounts$$().find((a) => a.id === accountId);
    return account ? account.title : 'Unknown Account';
  }

  protected getTransferAccountLine(transaction: Transaction): string {
    const twin = this.getTwinTransaction(transaction);
    if (!twin) return this.getAccountTitle(transaction.accountId);
    return `${this.getAccountTitle(transaction.accountId)} → ${this.getAccountTitle(twin.accountId)}`;
  }

  protected getCategoryName(categoryId?: number | null): string | null {
    if (!categoryId) return null;
    const normalizedCategoryId = Number(categoryId);
    const category = this.categories$$().find((c) => Number(c.id) === normalizedCategoryId);
    if (!category) return 'Unknown Category';
    return category.name;
  }

  protected formatAmount(transaction: Transaction): string {
    const currency = this.currencyByAccountId$$().get(transaction.accountId);
    if (!currency) return transaction.amount.toString();

    const sign = this.getAmountSign(transaction.kind);
    if (!this.convertToUnifiedCurrency$$() || currency.ticker === this.displayCurrency$$()) {
      return this.formatWithCurrency(transaction.amount, currency, sign);
    }

    const converted = this.toDisplayAmount(transaction.accountId, transaction.amount, transaction.dateISO);
    return this.formatDisplayAmount(converted, sign);
  }

  protected toggleConvertToUnifiedCurrency(): void {
    this.moneyService.setConvertToUnifiedCurrency(!this.convertToUnifiedCurrency$$());
  }

  protected formatTransferAmounts(transaction: Transaction): string {
    const twin = this.getTwinTransaction(transaction);
    if (!twin) return this.formatAmount(transaction);

    if (!this.convertToUnifiedCurrency$$()) {
      return `${this.formatPlainAmount(transaction.accountId, transaction.amount)} → ${this.formatPlainAmount(twin.accountId, twin.amount)}`;
    }

    const fromConverted = this.toDisplayAmount(transaction.accountId, transaction.amount, transaction.dateISO);
    const toConverted = this.toDisplayAmount(twin.accountId, twin.amount, transaction.dateISO);
    return `≈ ${this.formatDisplayAmount((fromConverted + toConverted) / 2, '')}`;
  }

  protected transactionKindIsIncome(transaction: Transaction): boolean {
    return transaction.kind === TransactionKind.INCOME;
  }

  protected getAmountColor(transaction: Transaction): string | null {
    if (transaction.kind === TransactionKind.INCOME || transaction.kind === TransactionKind.INVEST_DIVIDEND)
      return 'var(--v-color-success)';
    if (transaction.kind === TransactionKind.EXPENSE) return 'var(--v-color-text-danger)';
    return null;
  }

  private isInvestKind(kind: TransactionKind): boolean {
    return (
      kind === TransactionKind.INVEST_BUY ||
      kind === TransactionKind.INVEST_SELL ||
      kind === TransactionKind.INVEST_DIVIDEND
    );
  }

  private getAssetTicker(assetId: number): string {
    const asset = this.assets$$().find((item: Asset) => item.id === assetId);
    return asset?.ticker ?? `asset #${assetId}`;
  }

  private parseDetails(detailsJSON: any): any {
    if (!detailsJSON) return null;

    if (typeof detailsJSON === 'object') {
      return detailsJSON;
    }

    if (typeof detailsJSON === 'string') {
      try {
        return JSON.parse(detailsJSON);
      } catch {
        return null;
      }
    }

    return null;
  }

  private toPositiveNumber(value: unknown): number | null {
    const numberValue = Number(value);
    if (!Number.isFinite(numberValue) || numberValue <= 0) return null;
    return numberValue;
  }

  private formatSharesQuantity(quantity: number): string {
    return new Intl.NumberFormat('ru-RU', {
      minimumFractionDigits: 0,
      maximumFractionDigits: 8,
    }).format(quantity);
  }

  private getAmountSign(kind: TransactionKind): AmountSign {
    return kind === TransactionKind.INCOME ? '+' : kind === TransactionKind.EXPENSE ? '-' : '';
  }

  // The amount in the display currency, at the rates last known on or before the date. An account
  // without a currency has nothing to convert from, so its amount stays as is.
  private toDisplayAmount(accountId: number, amount: number, dateISO: string): number {
    const currency = this.currencyByAccountId$$().get(accountId);
    if (!currency) return amount;
    const rates = this.moneyService.getRatesForDate(dateISO) ?? {};
    return convertAmount(amount, currency.ticker, this.displayCurrency$$(), rates);
  }

  private formatDisplayAmount(amount: number, sign: AmountSign): string {
    const currency = this.displayCurrencyInfo$$();
    return currency ? this.formatWithCurrency(amount, currency, sign) : this.formatNumber(amount);
  }

  private formatWithCurrency(
    amount: number,
    currency: { symbol: string; whitespace?: boolean | null; symbolPosEnum: SymbolPosition },
    sign: AmountSign,
  ): string {
    const whitespace = currency.whitespace ? ' ' : '';
    const formatted = this.formatNumber(amount);
    if (currency.symbolPosEnum === SymbolPosition.BEFORE) {
      return `${currency.symbol}${whitespace}${sign}${formatted}`;
    }
    return `${sign}${formatted}${whitespace}${currency.symbol}`;
  }

  private formatPlainAmount(accountId: number, amount: number): string {
    const currency = this.currencyByAccountId$$().get(accountId);
    if (!currency) return amount.toFixed(2);
    return this.formatWithCurrency(amount, currency, '');
  }

  private formatNumber(amount: number): string {
    return groupNumberText(amount.toFixed(2));
  }

  private getTwinTransaction(transaction: Transaction): Transaction | null {
    if (!transaction.twinId) return null;
    return this.moneyService.transactions$$().find((item) => item.id === transaction.twinId) ?? null;
  }

  private shouldDisplayTransaction(transaction: Transaction): boolean {
    if (transaction.kind !== TransactionKind.TRANSFER) return true;
    if (!transaction.twinId || !transaction.id) return true;
    return transaction.id < transaction.twinId;
  }

  protected deleteTransaction(id: number): void {
    this.openConfirmationModal(id);
  }

  private openConfirmationModal(id: number): void {
    this.pendingDeleteId$$.set(id);
    this.isDeleteConfirmOpen$$.set(true);
  }

  protected closeConfirmationModal(): void {
    this.isDeleteConfirmOpen$$.set(false);
    this.pendingDeleteId$$.set(null);
  }

  protected onDeleteConfirmed(): void {
    const id = this.pendingDeleteId$$();
    this.isDeleteConfirmOpen$$.set(false);
    this.pendingDeleteId$$.set(null);
    if (!id) return;
    this.moneyService.deleteTransaction(id);
  }

  private groupTransactionsByDate(): TransactionGroup[] {
    const transactions = this.visibleTransactions$$();
    const transactionsByDateMap = new Map<string, TransactionGroup>();

    transactions.forEach((transaction) => {
      if (!this.shouldDisplayTransaction(transaction)) return;
      const dateIsoKey = transaction.dateISO;

      if (!transactionsByDateMap.has(dateIsoKey)) {
        transactionsByDateMap.set(dateIsoKey, {
          date: dateIsoKey,
          dateDisplay: this.formatDate(transaction.dateISO),
          transactions: [],
        });
      }

      transactionsByDateMap.get(dateIsoKey)!.transactions.push(transaction);
    });

    const groupsSortedByDate = Array.from(transactionsByDateMap.values()).sort((a, b) => b.date.localeCompare(a.date));

    return groupsSortedByDate;
  }

  private formatDate(dateISO: string): string {
    const date = new Date(dateISO + 'T00:00:00');
    const currentYear = new Date().getFullYear();
    const options: Intl.DateTimeFormatOptions = {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
    };

    if (date.getFullYear() !== currentYear) {
      options.year = 'numeric';
    }

    return date.toLocaleDateString('en-US', options);
  }

  private getTodayDateISO(): string {
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }
}
