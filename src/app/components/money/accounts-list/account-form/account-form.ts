import { Component, effect, inject, input, output, signal } from '@angular/core';
import { MoneyService } from '@app/services/money.service';
import { Account, AccountKind, Currency, Organization } from '@app/shared/types';
import { VButton } from '@ui-kit/components/v-button/v-button';
import { VCheckbox } from '@ui-kit/components/v-checkbox/v-checkbox';
import { DropdownItem, VDropdown } from '@ui-kit/components/v-dropdown/v-dropdown';
import { VInput } from '@ui-kit/components/v-input/v-input';

@Component({
  selector: 'account-form',
  templateUrl: './account-form.html',
  imports: [VButton, VDropdown, VCheckbox, VInput],
})
export class AccountForm {
  public readonly accountInput = input<Account | null>(null);
  public readonly currenciesInput = input<Currency[]>([]);
  public readonly organizationsInput = input<Organization[]>([]);

  public readonly savedOutput = output<void>();
  public readonly cancelledOutput = output<void>();

  private readonly moneyService = inject(MoneyService);

  protected readonly title$$ = signal('');
  protected readonly currencyId$$ = signal<string | null>(null);
  protected readonly isInvest$$ = signal(false);
  protected readonly isArchived$$ = signal(false);
  protected readonly kind$$ = signal<AccountKind | ''>('');
  protected readonly organizationId$$ = signal<string | null>(null);

  public constructor() {
    effect(() => {
      const currentAccount = this.accountInput();
      if (currentAccount) {
        this.fillForm(currentAccount);
      } else {
        this.resetForm();
      }
    });
  }

  protected async save(): Promise<void> {
    if (!this.isFormValid()) return;

    const accountData: Account = {
      title: this.title$$(),
      currencyId: Number(this.currencyId$$()),
      isInvest: this.isInvest$$(),
      isArchived: this.isArchived$$(),
      kind: this.kind$$() as AccountKind,
      organizationId: this.organizationId$$() ? Number(this.organizationId$$()) : null,
    };

    const currentAccount = this.accountInput();
    if (currentAccount?.id) {
      accountData.id = currentAccount.id;
      if (await this.moneyService.updateAccount(accountData)) {
        this.savedOutput.emit();
      }
    } else {
      if (await this.moneyService.createAccount(accountData)) {
        this.savedOutput.emit();
      }
    }
  }

  protected cancel(): void {
    this.cancelledOutput.emit();
  }

  protected isEditing(): boolean {
    return Boolean(this.accountInput()?.id);
  }

  protected isFormValid(): boolean {
    return Boolean(this.title$$() && this.currencyId$$() && this.kind$$());
  }

  protected currencyItems(): DropdownItem[] {
    return this.currenciesInput().map((currency) => ({
      value: String(currency.id),
      label: `${currency.title} (${currency.ticker})`,
    }));
  }

  protected organizationItems(): DropdownItem[] {
    return [
      { value: '', label: 'None' },
      ...this.organizationsInput().map((org) => ({
        value: String(org.id),
        label: org.title,
      })),
    ];
  }

  protected kindItems(): DropdownItem[] {
    return this.getKindValues().map((kind) => ({
      value: kind,
      label: this.getKindDisplayName(kind),
    }));
  }

  private getKindValues(): AccountKind[] {
    return Object.values(AccountKind);
  }

  private getKindDisplayName(kind: AccountKind): string {
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

  private fillForm(account: Account): void {
    this.title$$.set(account.title);
    this.currencyId$$.set(String(account.currencyId));
    this.isInvest$$.set(account.isInvest);
    this.isArchived$$.set(account.isArchived);
    this.kind$$.set(account.kind);
    this.organizationId$$.set(account.organizationId ? String(account.organizationId) : null);
  }

  private resetForm(): void {
    this.title$$.set('');
    this.currencyId$$.set(null);
    this.isInvest$$.set(false);
    this.isArchived$$.set(false);
    this.kind$$.set('');
    this.organizationId$$.set(null);
  }
}
