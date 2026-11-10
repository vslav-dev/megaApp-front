import { Component, computed, inject, signal } from '@angular/core';
import { VButton } from '@ui-kit/components/v-button/v-button';
import { VCard } from '@ui-kit/components/v-card/v-card';
import { IconName, VIcon } from '@ui-kit/components/v-icon/v-icon';
import { MoneyService } from '@app/services/money.service';
import { DefaultModal } from '@app/shared/components/default-modal/default-modal';
import { FormModal } from '@app/shared/components/form-modal/form-modal';
import { Currency } from '@app/shared/types';
import { ICON_BUTTON } from '@app/components/money/money.const';
import { CurrencyForm } from './currency-form/currency-form';

@Component({
  selector: 'currencies-list',
  templateUrl: './currencies-list.html',
  imports: [CurrencyForm, DefaultModal, FormModal, VButton, VCard, VIcon],
})
export class CurrenciesList {
  protected readonly Icon = IconName;
  protected readonly iconButton = ICON_BUTTON;

  private readonly moneyService = inject(MoneyService);

  protected readonly currencies$$ = computed(() => this.moneyService.currencies$$());
  private readonly accounts$$ = computed(() => this.moneyService.accounts$$());

  protected readonly showForm$$ = signal(false);
  protected readonly editingCurrency$$ = signal<Currency | null>(null);
  protected readonly isDeleteConfirmOpen$$ = signal(false);

  private readonly pendingDeleteId$$ = signal<number | null>(null);

  protected showCreateForm(): void {
    this.editingCurrency$$.set(null);
    this.showForm$$.set(true);
  }

  protected editCurrency(currency: Currency): void {
    this.editingCurrency$$.set(currency);
    this.showForm$$.set(true);
  }

  protected onSaved(): void {
    this.showForm$$.set(false);
    this.editingCurrency$$.set(null);
  }

  protected onCancelled(): void {
    this.showForm$$.set(false);
    this.editingCurrency$$.set(null);
  }

  protected deleteCurrency(id: number): void {
    if (!this.canDeleteCurrency(id)) return;
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
    if (!this.canDeleteCurrency(id)) return;
    void this.moneyService.deleteCurrency(id);
  }

  protected canDeleteCurrency(currencyId: number): boolean {
    return !this.accounts$$().some((account) => account.currencyId === currencyId);
  }
}
