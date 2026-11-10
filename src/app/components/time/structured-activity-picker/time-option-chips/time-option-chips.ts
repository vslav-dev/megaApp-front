import { Component, computed, input, model, signal } from '@angular/core';
import { CategoryOption } from '@app/shared/time-types';
import { VInput } from '@ui-kit/components/v-input/v-input';

const FILTER_THRESHOLD_DEFAULT = 8;

@Component({
  selector: 'time-option-chips',
  templateUrl: './time-option-chips.html',
  imports: [VInput],
})
export class TimeOptionChips {
  public readonly options = input.required<CategoryOption[]>();
  public readonly filterThreshold = input<number>(FILTER_THRESHOLD_DEFAULT);

  public readonly value = model<number | null>(null);

  protected readonly filterText$$ = signal('');

  protected readonly isFilterVisible$$ = computed(() => this.options().length > this.filterThreshold());

  protected readonly visibleOptions$$ = computed(() => {
    const filter = this.filterText$$().trim().toLowerCase();
    if (!filter) return this.options();
    return this.options().filter((option) => option.name.toLowerCase().includes(filter));
  });

  protected select(optionId: number): void {
    this.value.set(this.value() === optionId ? null : optionId);
  }

  protected clear(event: Event): void {
    event.stopPropagation();
    this.value.set(null);
  }
}
