import { Component, effect, inject, input, output, signal } from '@angular/core';
import { VButton } from '@ui-kit/components/v-button/v-button';
import { VCheckbox } from '@ui-kit/components/v-checkbox/v-checkbox';
import { DropdownItem, VDropdown } from '@ui-kit/components/v-dropdown/v-dropdown';
import { VInput } from '@ui-kit/components/v-input/v-input';
import { MoneyService } from '@app/services/money.service';
import { Currency, SymbolPosition } from '@app/shared/types';

@Component({
  selector: 'currency-form',
  templateUrl: './currency-form.html',
  imports: [VButton, VDropdown, VCheckbox, VInput],
})
export class CurrencyForm {
  public readonly currencyInput = input<Currency | null>(null);

  public readonly savedOutput = output<void>();
  public readonly cancelledOutput = output<void>();

  private readonly moneyService = inject(MoneyService);

  protected readonly title$$ = signal('');
  protected readonly ticker$$ = signal('');
  protected readonly symbol$$ = signal('');
  protected readonly symbolPosEnum$$ = signal<SymbolPosition>(SymbolPosition.BEFORE);
  protected readonly whitespace$$ = signal(false);

  public constructor() {
    effect(() => {
      const currentCurrency = this.currencyInput();
      if (currentCurrency) {
        this.fillForm(currentCurrency);
      } else {
        this.resetForm();
      }
    });
  }

  private fillForm(currency: Currency): void {
    this.title$$.set(currency.title);
    this.ticker$$.set(currency.ticker);
    this.symbol$$.set(currency.symbol);
    this.symbolPosEnum$$.set(currency.symbolPosEnum);
    this.whitespace$$.set(Boolean(currency.whitespace));
  }

  protected async save(): Promise<void> {
    if (!this.title$$() || !this.ticker$$() || !this.symbol$$()) return;

    const currencyData: Currency = {
      title: this.title$$(),
      ticker: this.ticker$$(),
      symbol: this.symbol$$(),
      symbolPosEnum: this.symbolPosEnum$$(),
      whitespace: Boolean(this.whitespace$$()),
    };

    const currentCurrency = this.currencyInput();
    if (currentCurrency?.id) {
      currencyData.id = currentCurrency.id;
      if (await this.moneyService.updateCurrency(currencyData)) {
        this.savedOutput.emit();
      }
    } else {
      if (await this.moneyService.createCurrency(currencyData)) {
        this.savedOutput.emit();
      }
    }
  }

  protected cancel(): void {
    this.cancelledOutput.emit();
  }

  protected isEditing(): boolean {
    return Boolean(this.currencyInput()?.id);
  }

  protected symbolPositionItems(): DropdownItem[] {
    return [
      { value: SymbolPosition.BEFORE, label: 'Before' },
      { value: SymbolPosition.AFTER, label: 'After' },
    ];
  }

  private resetForm(): void {
    this.title$$.set('');
    this.ticker$$.set('');
    this.symbol$$.set('');
    this.symbolPosEnum$$.set(SymbolPosition.BEFORE);
    this.whitespace$$.set(false);
  }
}
