import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { MoneyService } from '@app/services/money.service';
import { DefaultModal } from '@app/shared/components/default-modal/default-modal';
import { FormModal } from '@app/shared/components/form-modal/form-modal';
import { convertAmount } from '@app/shared/money-utils';
import { Account, AccountKind, Currency, SymbolPosition, Transaction, TransactionKind } from '@app/shared/types';
import { VButton } from '@ui-kit/components/v-button/v-button';
import { VCard } from '@ui-kit/components/v-card/v-card';
import { IconName, VIcon } from '@ui-kit/components/v-icon/v-icon';
import { ICON_BUTTON } from '../money.const';
import { AccountForm } from './account-form/account-form';

interface AccountBalance {
  cash: number;
  virtual: number | null;
}

@Component({
  selector: 'accounts-list',
  templateUrl: './accounts-list.html',
  imports: [AccountForm, DefaultModal, FormModal, VButton, VCard, VIcon],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AccountsList {
  protected readonly Icon = IconName;
  protected readonly iconButton = ICON_BUTTON;

  private readonly fxTickers = new Set(['USD', 'EUR']);

  private readonly moneyService = inject(MoneyService);

  protected readonly accounts$$ = computed(() => this.moneyService.accounts$$());
  protected readonly activeAccounts$$ = computed(() => this.accounts$$().filter((a) => !a.isArchived));
  protected readonly archivedAccounts$$ = computed(() => this.accounts$$().filter((a) => a.isArchived));
  protected readonly currencies$$ = computed(() => this.moneyService.currencies$$());
  protected readonly organizations$$ = computed(() => this.moneyService.organizations$$());
  private readonly assets$$ = computed(() => this.moneyService.assets$$());
  private readonly transactions$$ = computed(() => this.moneyService.transactions$$());

  protected readonly showForm$$ = signal(false);
  protected readonly editingAccount$$ = signal<Account | null>(null);
  protected readonly isDeleteConfirmOpen$$ = signal(false);
  protected readonly showArchivedAccounts$$ = signal(false);

  private readonly pendingDeleteId$$ = signal<number | null>(null);

  private readonly accountBalances$$ = computed((): Map<number, AccountBalance> => {
    const accounts = this.accounts$$();
    const transactions = this.transactions$$();
    const assets = this.assets$$();

    const balances = new Map<number, number>();
    const brokerUnitsByAsset = new Map<string, number>();
    const assetsById = new Map<number, string>();

    assets.forEach((asset) => {
      if (asset.id) assetsById.set(asset.id, asset.ticker);
    });

    accounts.forEach((account) => {
      if (account.id) balances.set(account.id, 0);
    });

    const sorted = [...transactions].sort((a, b) => a.dateISO.localeCompare(b.dateISO));
    sorted.forEach((transaction) => {
      const delta = this.getTransactionDelta(transaction);
      const current = balances.get(transaction.accountId) ?? 0;
      balances.set(transaction.accountId, current + delta);
      this.applyBrokerPositionDelta(transaction, brokerUnitsByAsset);
    });

    const today = new Date().toISOString().substring(0, 10);
    const rates = this.moneyService.getRatesForDate(today);

    const result = new Map<number, AccountBalance>();
    accounts.forEach((account) => {
      if (!account.id) return;
      const cash = balances.get(account.id) ?? 0;
      if (this.isBrokerAccount(account)) {
        const virtual = this.computeBrokerVirtual(
          account.id,
          account.currencyId,
          brokerUnitsByAsset,
          assetsById,
          rates,
        );
        result.set(account.id, { cash, virtual });
      } else {
        result.set(account.id, { cash, virtual: null });
      }
    });

    return result;
  });

  protected showCreateForm(): void {
    this.editingAccount$$.set(null);
    this.showForm$$.set(true);
  }

  protected editAccount(account: Account): void {
    this.editingAccount$$.set(account);
    this.showForm$$.set(true);
  }

  protected deleteAccount(id: number): void {
    if (!this.canDeleteAccount(id)) return;
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
    if (!this.canDeleteAccount(id)) return;
    void this.moneyService.deleteAccount(id);
  }

  protected onSaved(): void {
    this.showForm$$.set(false);
    this.editingAccount$$.set(null);
  }

  protected onCancelled(): void {
    this.showForm$$.set(false);
    this.editingAccount$$.set(null);
  }

  protected toggleArchivedAccounts(): void {
    this.showArchivedAccounts$$.update((v) => !v);
  }

  protected getAccountKindLabel(account: Account): string {
    const kindLabel = this.getKindLabel(account.kind);
    return account.isInvest ? `Investment ${kindLabel}` : kindLabel;
  }

  protected getCurrencyTicker(currencyId: number): string {
    return this.currencies$$().find((c) => c.id === currencyId)?.ticker ?? '';
  }

  protected getFormattedBalance(account: Account): string {
    if (!account.id) return '';
    const balance = this.accountBalances$$().get(account.id);
    if (!balance) return '';
    const currency = this.getCurrencyById(account.currencyId);
    const cashStr = this.formatAmount(balance.cash, currency);
    if (balance.virtual === null) return cashStr;
    const virtualStr = this.formatAmount(balance.virtual, currency);
    return `${cashStr} + ${virtualStr}`;
  }

  protected canDeleteAccount(accountId: number): boolean {
    const hasTransactions = this.transactions$$().some((transaction) => transaction.accountId === accountId);
    if (hasTransactions) return false;

    const hasAssets = this.assets$$().some((asset) => asset.accountIds.includes(accountId));
    return !hasAssets;
  }

  private getKindLabel(kind: AccountKind): string {
    switch (kind) {
      case AccountKind.CASH:
        return 'Cash';
      case AccountKind.CARD:
        return 'Card';
      case AccountKind.CHECKING:
        return 'Checking';
      case AccountKind.DEPOSIT:
        return 'Deposit';
      case AccountKind.BROKERAGE:
        return 'Brokerage';
      case AccountKind.CRYPTO:
        return 'Crypto';
      default:
        return kind;
    }
  }

  private isBrokerAccount(account: Account): boolean {
    return account.kind === AccountKind.BROKERAGE || account.kind === AccountKind.CRYPTO;
  }

  private getCurrencyById(currencyId: number): Currency | null {
    return this.currencies$$().find((c) => c.id === currencyId) ?? null;
  }

  private formatAmount(amount: number, currency: Currency | null): string {
    const formatted = new Intl.NumberFormat('ru-RU', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(amount);
    if (!currency?.symbol) return formatted;
    const whitespace = currency.whitespace ? ' ' : '';
    if (currency.symbolPosEnum === SymbolPosition.BEFORE) {
      return `${currency.symbol}${whitespace}${formatted}`;
    }
    return `${formatted}${whitespace}${currency.symbol}`;
  }

  private computeBrokerVirtual(
    accountId: number,
    currencyId: number,
    brokerUnitsByAsset: Map<string, number>,
    assetsById: Map<number, string>,
    rates: Record<string, number> | null,
  ): number {
    if (!rates) return 0;
    const currency = this.getCurrencyById(currencyId);
    const targetTicker = currency?.ticker ?? 'RUB';
    let total = 0;
    brokerUnitsByAsset.forEach((units, key) => {
      if (units <= 0) return;
      const [rawAccountId, rawAssetId] = key.split(':');
      if (Number(rawAccountId) !== accountId) return;
      const assetId = Number(rawAssetId);
      if (!Number.isFinite(assetId)) return;
      const ticker = assetsById.get(assetId);
      if (!ticker) return;
      const quoteUsd = rates[ticker];
      if (typeof quoteUsd !== 'number' || quoteUsd <= 0) return;
      total += convertAmount(units * quoteUsd, 'USD', targetTicker, rates);
    });
    return total;
  }

  private getTransactionDelta(transaction: Transaction): number {
    if (transaction.kind === TransactionKind.INCOME) return transaction.amount;
    if (transaction.kind === TransactionKind.EXPENSE) return -transaction.amount;
    if (transaction.kind === TransactionKind.INVEST_BUY) return -transaction.amount;
    if (transaction.kind === TransactionKind.INVEST_SELL || transaction.kind === TransactionKind.INVEST_DIVIDEND) {
      return transaction.amount;
    }
    if (transaction.kind !== TransactionKind.TRANSFER) return 0;
    const direction = this.getTransferDirection(transaction);
    if (direction === 'out') return -transaction.amount;
    if (direction === 'in') return transaction.amount;
    return 0;
  }

  private getTransferDirection(transaction: Transaction): 'out' | 'in' | null {
    const detailsJSON = transaction.detailsJSON;
    if (!detailsJSON) return null;
    let parsed: any = detailsJSON;
    if (typeof detailsJSON === 'string') {
      try {
        parsed = JSON.parse(detailsJSON);
      } catch {
        return null;
      }
    }
    const direction = parsed?.direction ?? null;
    if (direction === 'out' || direction === 'in') return direction;
    return null;
  }

  private applyBrokerPositionDelta(transaction: Transaction, brokerUnitsByAsset: Map<string, number>): void {
    if (transaction.kind !== TransactionKind.INVEST_BUY && transaction.kind !== TransactionKind.INVEST_SELL) return;
    const details = this.parseDetails(transaction.detailsJSON);
    const assetId = this.toPositiveNumber(details?.assetId);
    const quantity = this.toPositiveNumber(details?.quantity);
    if (assetId == null || quantity == null) return;
    const key = `${transaction.accountId}:${assetId}`;
    const current = brokerUnitsByAsset.get(key) ?? 0;
    if (transaction.kind === TransactionKind.INVEST_BUY) {
      brokerUnitsByAsset.set(key, current + quantity);
      return;
    }
    const next = current - quantity;
    brokerUnitsByAsset.set(key, next > 0 ? next : 0);
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

  private toPositiveNumber(value: unknown): number | null {
    const numeric = Number(value);
    if (!Number.isFinite(numeric) || numeric <= 0) return null;
    return numeric;
  }
}
