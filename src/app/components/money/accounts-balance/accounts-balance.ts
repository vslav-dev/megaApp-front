import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { MoneyService } from '@app/services/money.service';
import { convertAmount } from '@app/shared/money-utils';
import { groupNumberText } from '@app/shared/number-format';
import { Account, AccountKind, Organization, SymbolPosition, Transaction, TransactionKind } from '@app/shared/types';
import { VCard } from '@ui-kit/components/v-card/v-card';
import { IconName, VIcon } from '@ui-kit/components/v-icon/v-icon';

@Component({
  selector: 'accounts-balance',
  templateUrl: './accounts-balance.html',
  imports: [VCard, VIcon],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AccountsBalance {
  // Edit this array to control the display order of accounts (by account ID).
  // Accounts not listed here will appear at the end in their default order.
  private readonly ACCOUNT_DISPLAY_ORDER: readonly number[] = [3, 15, 16, 1, 14];

  private readonly moneyService = inject(MoneyService);

  protected readonly convertToUnifiedCurrency$$ = computed(() => this.moneyService.convertToUnifiedCurrency$$());
  private readonly displayCurrency$$ = computed(() => this.moneyService.displayCurrency$$());
  private readonly today = new Date().toISOString().substring(0, 10);
  private readonly latestRates$$ = computed(() => this.moneyService.getRatesForDate(this.today) ?? {});

  private readonly accounts$$ = computed(() => this.moneyService.accounts$$());
  private readonly currencies$$ = computed(() => this.moneyService.currencies$$());
  private readonly organizations$$ = computed(() => this.moneyService.organizations$$());

  protected readonly activeAccounts$$ = computed(() => {
    const accounts = this.accounts$$().filter((a) => !a.isArchived);
    if (!this.ACCOUNT_DISPLAY_ORDER.length) return accounts;
    const orderMap = new Map(this.ACCOUNT_DISPLAY_ORDER.map((id, idx) => [id, idx]));
    return [...accounts].sort((a, b) => {
      const ia = a.id != null ? (orderMap.get(a.id) ?? Infinity) : Infinity;
      const ib = b.id != null ? (orderMap.get(b.id) ?? Infinity) : Infinity;
      return ia - ib;
    });
  });

  private readonly balancesMap$$ = computed((): Map<number, number> => {
    const balances = new Map<number, number>();
    this.accounts$$().forEach((a) => {
      if (a.id) balances.set(a.id, 0);
    });
    for (const tx of this.moneyService.transactions$$()) {
      const delta = this.getTxDelta(tx);
      balances.set(tx.accountId, (balances.get(tx.accountId) ?? 0) + delta);
    }
    return balances;
  });

  protected getKindIcon(account: Account): IconName {
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

  protected getOrgLogoSrc(account: Account): string | null {
    if (!account.organizationId) return null;
    const org = this.organizations$$().find((o: Organization) => o.id === account.organizationId);
    if (!org?.logoBase64) return null;
    return `data:image/png;base64,${org.logoBase64}`;
  }

  protected getBalance(account: Account): string {
    if (!account.id) return '';
    const balance = this.balancesMap$$().get(account.id) ?? 0;
    const currency = this.currencies$$().find((c) => c.id === account.currencyId);
    if (!currency) return this.formatNumber(balance);

    if (!this.convertToUnifiedCurrency$$() || currency.ticker === this.displayCurrency$$()) {
      const ws = currency.whitespace ? ' ' : '';
      const formatted = this.formatNumber(balance);
      if (currency.symbolPosEnum === SymbolPosition.BEFORE) return `${currency.symbol}${ws}${formatted}`;
      return `${formatted}${ws}${currency.symbol}`;
    }

    const displayTicker = this.displayCurrency$$();
    const converted = convertAmount(balance, currency.ticker, displayTicker, this.latestRates$$());
    const displayCurrency = this.currencies$$().find((c) => c.ticker === displayTicker);
    if (!displayCurrency) return this.formatNumber(converted);
    const ws = displayCurrency.whitespace ? ' ' : '';
    const formatted = this.formatNumber(converted);
    if (displayCurrency.symbolPosEnum === SymbolPosition.BEFORE) return `${displayCurrency.symbol}${ws}${formatted}`;
    return `${formatted}${ws}${displayCurrency.symbol}`;
  }

  private formatNumber(amount: number): string {
    return groupNumberText(amount.toFixed(2));
  }

  private getTxDelta(tx: Transaction): number {
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
}
