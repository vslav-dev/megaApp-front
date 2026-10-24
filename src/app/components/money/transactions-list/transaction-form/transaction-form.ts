import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  ElementRef,
  inject,
  input,
  output,
  signal,
  viewChild,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MoneyService } from '@app/services/money.service';
import { evaluateAmountExpression, normalizeAmountInput } from '@app/shared/amount-expression';
import {
  Account,
  AccountKind,
  Asset,
  AssetType,
  Category,
  CategoryType,
  Currency,
  SymbolPosition,
  Transaction,
  TransactionKind,
} from '@app/shared/types';
import { dateToIsoNoTimeNoTZ } from '@app/shared/utils';
import { VButton } from '@ui-kit/components/v-button/v-button';
import { VCheckbox } from '@ui-kit/components/v-checkbox/v-checkbox';
import { VDateWheelInput } from '@ui-kit/components/v-date-wheel-input/v-date-wheel-input';
import { DropdownItem, VDropdown } from '@ui-kit/components/v-dropdown/v-dropdown';
import { IconName, VIcon } from '@ui-kit/components/v-icon/v-icon';
import { VInput } from '@ui-kit/components/v-input/v-input';
import { VToggle } from '@ui-kit/components/v-toggle/v-toggle';

@Component({
  selector: 'transaction-form',
  templateUrl: './transaction-form.html',
  styleUrl: './transaction-form.scss',
  imports: [FormsModule, VButton, VCheckbox, VDateWheelInput, VDropdown, VIcon, VInput, VToggle],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class TransactionForm {
  protected readonly Icon = IconName;
  protected readonly TransactionKind = TransactionKind;
  private readonly dateInputElem = viewChild<ElementRef<HTMLInputElement>>('dateInputElem');
  private readonly amountInputElem = viewChild<VInput>('amountInputElem');
  private readonly investDividendAmountElem = viewChild<VInput>('investDividendAmountElem');
  private readonly amountFromElem = viewChild<VInput>('amountFromElem');
  private readonly amountToElem = viewChild<VInput>('amountToElem');

  public readonly dateIsoInput = input<string | null>(null);
  public readonly transactionInput = input<Transaction | null>(null);

  public readonly savedOutput = output<void>();
  public readonly cancelledOutput = output<void>();

  protected readonly dateISO$$ = signal('');
  protected readonly accountId$$ = signal<string | null>(null);
  protected readonly accountToId$$ = signal<string | null>(null);
  protected readonly amount$$ = signal('');
  protected readonly amountTo$$ = signal('');
  protected readonly kind$$ = signal<TransactionKind>(TransactionKind.EXPENSE);
  protected readonly notes$$ = signal('');
  protected readonly isGift$$ = signal(false);
  protected readonly categoryId$$ = signal<string | null>(null);
  protected readonly assetId$$ = signal<string | null>(null);
  protected readonly quantity$$ = signal('');
  protected readonly price$$ = signal('');
  protected readonly commissionAmount$$ = signal('');
  protected readonly accruedInterestAmount$$ = signal('');
  protected readonly isCouponDividend$$ = signal(false);
  protected readonly isEditing$$ = computed(() => Boolean(this.transactionInput()?.id));

  private readonly moneyService = inject(MoneyService);

  private readonly selectedAccount$$ = computed(() => {
    const accountIdValue = this.accountId$$();
    if (!accountIdValue) return null;
    const accountId = Number(accountIdValue);
    if (!Number.isFinite(accountId)) return null;
    return this.moneyService.accounts$$().find((item) => item.id === accountId) ?? null;
  });

  private readonly selectedAsset$$ = computed(() => {
    const assetIdValue = this.assetId$$();
    if (!assetIdValue) return null;
    const assetId = Number(assetIdValue);
    if (!Number.isFinite(assetId)) return null;
    return this.moneyService.assets$$().find((item) => item.id === assetId) ?? null;
  });

  protected readonly isInvestMode$$ = computed(() => {
    if (this.kind$$() === TransactionKind.TRANSFER) return false;
    const currentTransaction = this.transactionInput();
    if (currentTransaction && this.isPersistedInvestKind(currentTransaction.kind)) return true;
    return (
      this.selectedAccount$$()?.kind === AccountKind.BROKERAGE || this.selectedAccount$$()?.kind === AccountKind.CRYPTO
    );
  });

  private readonly persistedKind$$ = computed(() => {
    const currentTransaction = this.transactionInput();
    if (currentTransaction && this.isPersistedInvestKind(currentTransaction.kind)) {
      return currentTransaction.kind;
    }

    if (!this.isInvestMode$$()) return this.kind$$();
    if (this.kind$$() === TransactionKind.EXPENSE) return TransactionKind.INVEST_BUY;
    return this.isCouponDividend$$() ? TransactionKind.INVEST_DIVIDEND : TransactionKind.INVEST_SELL;
  });

  protected readonly isInvestDividendMode$$ = computed(
    () => this.isInvestMode$$() && this.persistedKind$$() === TransactionKind.INVEST_DIVIDEND,
  );

  protected readonly selectedAssetIsBond$$ = computed(() => this.selectedAsset$$()?.type === AssetType.BOND);

  protected readonly topAccounts$$ = computed(() =>
    this.getAccounts().map((account) => ({ id: String(account.id), title: account.title })),
  );

  protected readonly topCategoryItems$$ = computed(() =>
    this.getTransactionCategories().map((cat) => ({
      id: String(cat.id),
      label: this.getCategoryLabel(cat),
    })),
  );

  protected readonly topNoteItems$$ = computed(() => {
    const categoryIdValue = this.categoryId$$();
    const categoryId = categoryIdValue ? Number(categoryIdValue) : null;
    const notesFilter = this.notes$$().trim().toLowerCase();

    const oneYearAgo = new Date();
    oneYearAgo.setFullYear(oneYearAgo.getFullYear() - 1);
    const oneYearAgoISO = oneYearAgo.toISOString().slice(0, 10);

    const noteCount = new Map<string, number>();
    for (const tx of this.moneyService.transactions$$()) {
      if (!tx.notes || tx.dateISO < oneYearAgoISO) continue;
      if (categoryId != null && Number.isFinite(categoryId) && tx.categoryId !== categoryId) continue;
      noteCount.set(tx.notes, (noteCount.get(tx.notes) ?? 0) + 1);
    }

    const sorted = Array.from(noteCount.entries())
      .sort((a, b) => b[1] - a[1])
      .map(([note]) => note);

    if (!notesFilter) return sorted;
    return sorted.filter((note) => note.toLowerCase().includes(notesFilter));
  });

  protected readonly canEditInvestIdentity$$ = computed(() => !this.isEditing$$());

  protected readonly kindToggleItems$$ = computed(() => {
    const expenseLabel = this.isInvestMode$$() ? 'Buy' : 'Expense';
    const incomeLabel = this.isInvestMode$$() ? 'Sell' : 'Income';

    return [
      { id: TransactionKind.EXPENSE, label: expenseLabel },
      { id: TransactionKind.INCOME, label: incomeLabel },
      { id: TransactionKind.TRANSFER, label: 'Transfer' },
    ];
  });

  protected readonly assetItems$$ = computed(() => {
    const accountIdValue = this.accountId$$();
    const accountId = accountIdValue ? Number(accountIdValue) : null;
    const filteredAssets =
      accountId != null && Number.isFinite(accountId)
        ? this.moneyService.assets$$().filter((asset: Asset) => asset.accountIds.includes(accountId))
        : [];

    return filteredAssets.map((asset: Asset) => ({
      value: String(asset.id),
      label: `${asset.title} (${asset.ticker})`,
    }));
  });

  protected readonly investAmountDisplay$$ = computed(() => {
    const amount = this.computeInvestAmount();
    if (amount == null) return '';
    return String(amount);
  });

  protected readonly couponDividendLabel$$ = computed(() => (this.selectedAssetIsBond$$() ? 'Coupon' : 'Dividend'));

  private readonly transactionFormSyncEffect$$ = effect(() => {
    const date = this.dateIsoInput();
    const transaction = this.transactionInput();

    if (transaction) {
      this.prepFormWithTransaction(transaction);
    } else if (date) {
      this.prepFormWithDate(date);
    }
  });

  protected save(): void {
    if (!this.isFormValid()) return;

    if (this.kind$$() === TransactionKind.TRANSFER) {
      const parsedFromAmount = evaluateAmountExpression(this.amount$$());
      const parsedToAmount = evaluateAmountExpression(this.amountTo$$());
      if (parsedFromAmount === null || parsedToAmount === null) return;

      const normalizedFromAmount = this.normalizeAmount(parsedFromAmount);
      const normalizedToAmount = this.normalizeAmount(parsedToAmount);
      if (normalizedFromAmount === null || normalizedToAmount === null) return;

      const currentTransaction = this.transactionInput();
      const currentTwinId = currentTransaction?.twinId;

      if (currentTransaction?.id && currentTwinId) {
        this.moneyService
          .updateTransfer({
            id: currentTransaction.id,
            twinId: currentTwinId,
            dateISO: this.dateISO$$(),
            accountId: Number(this.accountId$$()),
            amount: normalizedFromAmount,
            twinAccountId: Number(this.accountToId$$()),
            twinAmount: normalizedToAmount,
            notes: this.notes$$() || undefined,
          })
          .subscribe((success) => {
            if (success) {
              this.savedOutput.emit();
            }
          });
      } else {
        this.moneyService
          .createTransfer({
            dateISO: this.dateISO$$(),
            accountId: Number(this.accountId$$()),
            amount: normalizedFromAmount,
            twinAccountId: Number(this.accountToId$$()),
            twinAmount: normalizedToAmount,
            notes: this.notes$$() || undefined,
          })
          .subscribe((success) => {
            if (success) {
              this.savedOutput.emit();
            }
          });
      }

      return;
    }

    if (this.isInvestMode$$()) {
      const currentTransaction = this.transactionInput();
      const accountId = currentTransaction?.accountId ?? Number(this.accountId$$());
      const persistedKind = this.persistedKind$$();
      const assetId = Number(this.assetId$$());

      if (!Number.isFinite(assetId) || assetId <= 0) return;

      const details: any = {
        assetId,
      };

      let submitAmount = this.normalizeAmount(evaluateAmountExpression(this.amount$$()) ?? NaN);

      if (persistedKind !== TransactionKind.INVEST_DIVIDEND) {
        const quantity = this.normalizeAmount(this.parsePlainNumber(this.quantity$$()) ?? NaN);
        const price = this.normalizeAmount(this.parsePlainNumber(this.price$$()) ?? NaN);
        const commissionAmount = this.normalizeAmount(this.parsePlainNumber(this.commissionAmount$$()) ?? 0) ?? 0;
        const accruedInterestAmount =
          this.normalizeAmount(this.parsePlainNumber(this.accruedInterestAmount$$()) ?? 0) ?? 0;

        if (quantity == null || quantity <= 0 || price == null || price <= 0) return;

        details.quantity = quantity;
        details.price = price;
        details.commissionAmount = commissionAmount;
        details.accruedInterestAmount = this.selectedAssetIsBond$$() ? accruedInterestAmount : 0;

        const computedAmount = this.computeInvestAmount();
        if (computedAmount == null || computedAmount <= 0) return;
        submitAmount = computedAmount;
      } else {
        submitAmount = this.normalizeAmount(evaluateAmountExpression(this.amount$$()) ?? NaN);
      }

      if (submitAmount == null || submitAmount <= 0) return;

      const transactionData: Transaction = {
        dateISO: this.dateISO$$(),
        accountId,
        amount: submitAmount,
        categoryId: null,
        kind: currentTransaction?.kind ?? persistedKind,
        isGift: false,
        notes: this.notes$$() || undefined,
        detailsJSON: details,
      };

      if (currentTransaction?.id) {
        transactionData.id = currentTransaction.id;
        this.moneyService.updateTransaction(transactionData).subscribe((success) => {
          if (success) {
            this.savedOutput.emit();
          }
        });
      } else {
        this.moneyService.createTransaction(transactionData).subscribe((success) => {
          if (success) {
            this.savedOutput.emit();
          }
        });
      }

      return;
    }

    const parsedAmount = evaluateAmountExpression(this.amount$$());
    if (parsedAmount === null) return;
    const normalizedAmount = this.normalizeAmount(parsedAmount);
    if (normalizedAmount === null) return;

    const currentTransaction = this.transactionInput();
    const accountId = currentTransaction?.accountId ?? Number(this.accountId$$());
    const kind = currentTransaction?.kind ?? this.kind$$();

    const transactionData: Transaction = {
      dateISO: this.dateISO$$(),
      accountId,
      amount: normalizedAmount,
      kind,
      isGift: this.isGift$$(),
      notes: this.notes$$() || undefined,
      categoryId: this.categoryId$$() ? Number(this.categoryId$$()) : null,
    };

    if (currentTransaction?.id) {
      transactionData.id = currentTransaction.id;
      this.moneyService.updateTransaction(transactionData).subscribe((success) => {
        if (success) {
          this.savedOutput.emit();
        }
      });
    } else {
      this.moneyService.createTransaction(transactionData).subscribe((success) => {
        if (success) {
          this.savedOutput.emit();
        }
      });
    }
  }

  protected cancel(): void {
    this.cancelledOutput.emit();
  }

  protected isEditing(): boolean {
    return Boolean(this.transactionInput()?.id);
  }

  protected isFormValid(): boolean {
    if (this.kind$$() === TransactionKind.TRANSFER) {
      const amountFrom = evaluateAmountExpression(this.amount$$());
      const amountTo = evaluateAmountExpression(this.amountTo$$());
      const normalizedFrom = amountFrom === null ? null : this.normalizeAmount(amountFrom);
      const normalizedTo = amountTo === null ? null : this.normalizeAmount(amountTo);

      return Boolean(
        this.dateISO$$() &&
          this.accountId$$() &&
          this.accountToId$$() &&
          this.accountId$$() !== this.accountToId$$() &&
          normalizedFrom &&
          normalizedFrom > 0 &&
          normalizedTo &&
          normalizedTo > 0,
      );
    }

    if (this.isInvestMode$$()) {
      const assetId = Number(this.assetId$$());
      if (!Number.isFinite(assetId) || assetId <= 0) return false;

      if (this.persistedKind$$() === TransactionKind.INVEST_DIVIDEND) {
        const amount = this.normalizeAmount(evaluateAmountExpression(this.amount$$()) ?? NaN);
        return Boolean(this.dateISO$$() && this.accountId$$() && amount && amount > 0);
      }

      const quantity = this.normalizeAmount(this.parsePlainNumber(this.quantity$$()) ?? NaN);
      const price = this.normalizeAmount(this.parsePlainNumber(this.price$$()) ?? NaN);
      const computedAmount = this.computeInvestAmount();

      return Boolean(
        this.dateISO$$() &&
          this.accountId$$() &&
          quantity &&
          quantity > 0 &&
          price &&
          price > 0 &&
          computedAmount &&
          computedAmount > 0,
      );
    }

    const amount = evaluateAmountExpression(this.amount$$());
    const normalizedAmount = amount === null ? null : this.normalizeAmount(amount);
    return Boolean(this.dateISO$$() && this.accountId$$() && normalizedAmount !== null && this.kind$$());
  }

  protected accountItems(): DropdownItem[] {
    return this.getAccounts().map((account) => ({
      value: String(account.id),
      label: account.title,
      rightLabel: this.getAccountBalanceLabel(account),
    }));
  }

  protected onKindToggleChange(value: string[]): void {
    const nextKind = value[0] as TransactionKind | undefined;
    this.kind$$.set(nextKind ?? TransactionKind.EXPENSE);
    this.categoryId$$.set(null);

    if (this.kind$$() !== TransactionKind.INCOME) {
      this.isCouponDividend$$.set(false);
    }

    if (this.kind$$() !== TransactionKind.TRANSFER) {
      this.accountToId$$.set(null);
      this.amountTo$$.set('');
    }
  }

  protected onAccountChange(value: string | null): void {
    this.accountId$$.set(value);
    this.categoryId$$.set(null);

    if (!this.isEditing$$() && value) {
      setTimeout(() => {
        if (!this.isInvestMode$$()) {
          const inputEl = this.amountInputElem()?.inputElement().nativeElement;
          inputEl?.focus();
          inputEl?.select();
        }
      });
    }

    const selectedAsset = this.selectedAsset$$();
    const accountId = value ? Number(value) : null;
    if (selectedAsset && (accountId == null || !selectedAsset.accountIds.includes(accountId))) {
      this.assetId$$.set(null);
      this.quantity$$.set('');
      this.price$$.set('');
      this.commissionAmount$$.set('');
      this.accruedInterestAmount$$.set('');
    }

    if (!this.isInvestMode$$() && !this.isEditing$$()) {
      this.assetId$$.set(null);
      this.quantity$$.set('');
      this.price$$.set('');
      this.commissionAmount$$.set('');
      this.accruedInterestAmount$$.set('');
      this.isCouponDividend$$.set(false);
    }
  }

  protected onAssetChange(value: string | null): void {
    this.assetId$$.set(value);
    if (!this.selectedAssetIsBond$$()) {
      this.accruedInterestAmount$$.set('');
    }
  }

  protected focusAmountInput(): void {
    this.amountInputElem()?.focus();
  }

  protected focusInvestDividendAmount(): void {
    this.investDividendAmountElem()?.focus();
  }

  protected focusAmountFrom(): void {
    this.amountFromElem()?.focus();
  }

  protected focusAmountTo(): void {
    this.amountToElem()?.focus();
  }

  protected shiftDate(days: number): void {
    const [year, month, day] = this.dateISO$$().split('-').map(Number);
    if (!year || !month || !day) return;

    const date = new Date(year, month - 1, day);
    date.setDate(date.getDate() + days);
    this.dateISO$$.set(dateToIsoNoTimeNoTZ(date));
  }

  protected onDateControlClick(): void {
    this.openNativeDatePicker(this.dateInputElem()?.nativeElement);
  }

  protected onDatePicked(event: Event): void {
    const input = event.target as HTMLInputElement | null;
    const dateIso = input?.value;
    if (!dateIso) return;
    this.dateISO$$.set(dateIso);
  }

  private getKindDisplayName(kind: TransactionKind): string {
    switch (kind) {
      case TransactionKind.INCOME:
        return 'Income';
      case TransactionKind.EXPENSE:
        return 'Expense';
      case TransactionKind.TRANSFER:
        return 'Transfer';
      default:
        return kind;
    }
  }

  protected kindToggleValue(): string[] {
    return [this.kind$$()];
  }

  private getAccounts(): Account[] {
    const now = new Date();
    const threeMonthsAgo = new Date(now.getFullYear(), now.getMonth() - 3, now.getDate()).toISOString().slice(0, 10);

    const usageCount = new Map<number, number>();
    for (const tx of this.moneyService.transactions$$()) {
      if (tx.dateISO >= threeMonthsAgo && tx.accountId) {
        usageCount.set(tx.accountId, (usageCount.get(tx.accountId) ?? 0) + 1);
      }
    }

    return this.moneyService
      .accounts$$()
      .filter((a) => !a.isArchived)
      .sort((a, b) => {
        const diff = (usageCount.get(b.id!) ?? 0) - (usageCount.get(a.id!) ?? 0);
        return diff !== 0 ? diff : a.title.localeCompare(b.title);
      });
  }

  private getSelectedCurrency(accountIdValue: string | null): Currency | null {
    if (!accountIdValue) return null;
    const accountId = Number(accountIdValue);
    if (!Number.isFinite(accountId)) return null;
    const account = this.moneyService.accounts$$().find((item) => item.id === accountId);
    if (!account) return null;
    return this.moneyService.currencies$$().find((item) => item.id === account.currencyId) ?? null;
  }

  protected getCurrencyPrefix(): string | null {
    const currency = this.getSelectedCurrency(this.accountId$$());
    if (!currency?.symbol) return null;
    if (currency.symbolPosEnum !== SymbolPosition.BEFORE) return null;
    const whitespace = currency.whitespace ? ' ' : '';
    return `${currency.symbol}${whitespace}`;
  }

  protected getCurrencyPostfix(): string | null {
    const currency = this.getSelectedCurrency(this.accountId$$());
    if (!currency?.symbol) return null;
    if (currency.symbolPosEnum !== SymbolPosition.AFTER) return null;
    const whitespace = currency.whitespace ? ' ' : '';
    return `${whitespace}${currency.symbol}`;
  }

  protected getCurrencyPrefixForAccount(accountIdValue: string | null): string | null {
    const currency = this.getSelectedCurrency(accountIdValue);
    if (!currency?.symbol) return null;
    if (currency.symbolPosEnum !== SymbolPosition.BEFORE) return null;
    const whitespace = currency.whitespace ? ' ' : '';
    return `${currency.symbol}${whitespace}`;
  }

  protected getCurrencyPostfixForAccount(accountIdValue: string | null): string | null {
    const currency = this.getSelectedCurrency(accountIdValue);
    if (!currency?.symbol) return null;
    if (currency.symbolPosEnum !== SymbolPosition.AFTER) return null;
    const whitespace = currency.whitespace ? ' ' : '';
    return `${whitespace}${currency.symbol}`;
  }

  private getTransactionCategories(): Category[] {
    const now = new Date();
    const threeMonthsAgo = new Date(now.getFullYear(), now.getMonth() - 3, now.getDate()).toISOString().slice(0, 10);

    const usageCount = new Map<number, number>();
    for (const tx of this.moneyService.transactions$$()) {
      if (tx.dateISO >= threeMonthsAgo && tx.categoryId) {
        usageCount.set(tx.categoryId, (usageCount.get(tx.categoryId) ?? 0) + 1);
      }
    }

    const categoryType = this.kind$$() === TransactionKind.INCOME ? CategoryType.INCOME : CategoryType.EXPENSE;
    return this.moneyService
      .categories$$()
      .filter((category) => category.categoryType === categoryType)
      .sort((a, b) => {
        const diff = (usageCount.get(b.id!) ?? 0) - (usageCount.get(a.id!) ?? 0);
        return diff !== 0 ? diff : a.name.localeCompare(b.name);
      });
  }

  protected categoryItems(): DropdownItem[] {
    return [
      { value: '', label: 'No category' },
      ...this.getTransactionCategories().map((category) => ({
        value: String(category.id),
        label: this.getCategoryLabel(category),
      })),
    ];
  }

  private getCategoryLabel(category: Category): string {
    if (!category.parentId) return category.name;

    const parentCategory = this.moneyService.categories$$().find((parent) => parent.id === category.parentId);
    if (!parentCategory) return category.name;

    return `${parentCategory.name} / ${category.name}`;
  }

  private prepFormWithTransaction(transaction: Transaction): void {
    this.dateISO$$.set(transaction.dateISO);
    this.accountId$$.set(String(transaction.accountId));
    this.amount$$.set(String(transaction.amount));
    this.kind$$.set(this.mapPersistedKindToUiKind(transaction.kind));
    this.notes$$.set(transaction.notes || '');
    this.isGift$$.set(Boolean(transaction.isGift));
    this.categoryId$$.set(transaction.categoryId ? String(transaction.categoryId) : null);

    const details = this.parseDetails(transaction.detailsJSON);
    this.assetId$$.set(details?.assetId != null ? String(details.assetId) : null);
    this.quantity$$.set(details?.quantity != null ? String(details.quantity) : '');
    this.price$$.set(details?.price != null ? String(details.price) : '');
    this.commissionAmount$$.set(details?.commissionAmount != null ? String(details.commissionAmount) : '');
    this.accruedInterestAmount$$.set(
      details?.accruedInterestAmount != null ? String(details.accruedInterestAmount) : '',
    );
    this.isCouponDividend$$.set(transaction.kind === TransactionKind.INVEST_DIVIDEND);

    if (transaction.kind === TransactionKind.TRANSFER) {
      const twin = this.getTwinTransaction(transaction);
      this.accountToId$$.set(twin?.accountId ? String(twin.accountId) : null);
      this.amountTo$$.set(twin?.amount ? String(twin.amount) : '');
      this.categoryId$$.set(null);
    } else {
      this.accountToId$$.set(null);
      this.amountTo$$.set('');
    }

    if (this.isInvestMode$$() && !this.isInvestDividendMode$$()) {
      this.amount$$.set(this.investAmountDisplay$$());
    }
  }

  private prepFormWithDate(dateInput: string): void {
    this.dateISO$$.set(dateInput);
    this.accountId$$.set(null);
    this.accountToId$$.set(null);
    this.amount$$.set('');
    this.amountTo$$.set('');
    this.kind$$.set(TransactionKind.EXPENSE);
    this.notes$$.set('');
    this.isGift$$.set(false);
    this.categoryId$$.set(null);
    this.assetId$$.set(null);
    this.quantity$$.set('');
    this.price$$.set('');
    this.commissionAmount$$.set('');
    this.accruedInterestAmount$$.set('');
    this.isCouponDividend$$.set(false);
  }

  private isPersistedInvestKind(kind: TransactionKind): boolean {
    return (
      kind === TransactionKind.INVEST_BUY || kind === TransactionKind.INVEST_SELL || kind === TransactionKind.INVEST_DIVIDEND
    );
  }

  private mapPersistedKindToUiKind(kind: TransactionKind): TransactionKind {
    if (kind === TransactionKind.INVEST_BUY) return TransactionKind.EXPENSE;
    if (kind === TransactionKind.INVEST_SELL || kind === TransactionKind.INVEST_DIVIDEND) return TransactionKind.INCOME;
    return kind;
  }

  private computeInvestAmount(): number | null {
    if (!this.isInvestMode$$()) return null;
    const persistedKind = this.persistedKind$$();
    if (persistedKind === TransactionKind.INVEST_DIVIDEND) {
      const amount = evaluateAmountExpression(this.amount$$());
      return amount == null ? null : this.normalizeAmount(amount);
    }

    const quantity = this.normalizeAmount(this.parsePlainNumber(this.quantity$$()) ?? NaN);
    const price = this.normalizeAmount(this.parsePlainNumber(this.price$$()) ?? NaN);
    const commissionAmount = this.normalizeAmount(this.parsePlainNumber(this.commissionAmount$$()) ?? 0) ?? 0;
    const accruedInterestAmount = this.normalizeAmount(this.parsePlainNumber(this.accruedInterestAmount$$()) ?? 0) ?? 0;

    if (quantity == null || quantity <= 0 || price == null || price <= 0) return null;

    const effectiveAccrued = this.selectedAssetIsBond$$() ? accruedInterestAmount : 0;

    if (persistedKind === TransactionKind.INVEST_BUY) {
      return quantity * price + commissionAmount + effectiveAccrued;
    }

    return quantity * price - commissionAmount + effectiveAccrued;
  }

  private parseDetails(detailsJSON: any): any {
    if (!detailsJSON) return null;
    if (typeof detailsJSON === 'object') return detailsJSON;

    if (typeof detailsJSON === 'string') {
      try {
        return JSON.parse(detailsJSON);
      } catch {
        return null;
      }
    }

    return null;
  }

  private readonly accountCashBalances$$ = computed((): Map<number, number> => {
    const balances = new Map<number, number>();
    this.moneyService.accounts$$().forEach((a) => {
      if (a.id) balances.set(a.id, 0);
    });
    for (const tx of this.moneyService.transactions$$()) {
      const delta = this.getAccountTxDelta(tx);
      balances.set(tx.accountId, (balances.get(tx.accountId) ?? 0) + delta);
    }
    return balances;
  });

  private getAccountTxDelta(tx: Transaction): number {
    if (tx.kind === TransactionKind.INCOME) return tx.amount;
    if (tx.kind === TransactionKind.EXPENSE) return -tx.amount;
    if (tx.kind === TransactionKind.INVEST_BUY) return -tx.amount;
    if (tx.kind === TransactionKind.INVEST_SELL || tx.kind === TransactionKind.INVEST_DIVIDEND) return tx.amount;
    if (tx.kind !== TransactionKind.TRANSFER) return 0;
    const details = this.parseDetails(tx.detailsJSON);
    if (details?.direction === 'out') return -tx.amount;
    if (details?.direction === 'in') return tx.amount;
    return 0;
  }

  private getAccountBalanceLabel(account: Account): string {
    if (!account.id) return '';
    const cash = this.accountCashBalances$$().get(account.id) ?? 0;
    const currency = this.moneyService.currencies$$().find((c) => c.id === account.currencyId) ?? null;
    const formatted = new Intl.NumberFormat('ru-RU', {
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(Math.round(cash));
    if (!currency?.symbol) return formatted;
    const ws = currency.whitespace ? ' ' : '';
    if (currency.symbolPosEnum === SymbolPosition.BEFORE) return `${currency.symbol}${ws}${formatted}`;
    return `${formatted}${ws}${currency.symbol}`;
  }

  protected getSelectedAccountBalanceLabel(accountId: string | null): string {
    if (!accountId) return '';
    const account = this.moneyService.accounts$$().find((a) => a.id === Number(accountId)) ?? null;
    if (!account) return '';
    return `Balance: ${this.getAccountBalanceLabel(account)}`;
  }

  private getTwinTransaction(transaction: Transaction): Transaction | null {
    if (!transaction.twinId) return null;
    return this.moneyService.transactions$$().find((item) => item.id === transaction.twinId) ?? null;
  }

  private parsePlainNumber(value: string): number | null {
    if (!value) return null;
    const normalized = normalizeAmountInput(value);
    if (!normalized || normalized === '-' || normalized === '+') return null;

    const parsed = Number(normalized);
    if (!Number.isFinite(parsed)) return null;

    return parsed;
  }

  private normalizeAmount(amount: number): number | null {
    if (!Number.isFinite(amount)) return null;
    return Math.abs(amount);
  }

  private openNativeDatePicker(input: HTMLInputElement | null | undefined): void {
    if (!input) return;

    const inputWithPicker = input as HTMLInputElement & { showPicker?: () => void };
    if (typeof inputWithPicker.showPicker === 'function') {
      inputWithPicker.showPicker();
      return;
    }

    input.focus();
    input.click();
  }
}
