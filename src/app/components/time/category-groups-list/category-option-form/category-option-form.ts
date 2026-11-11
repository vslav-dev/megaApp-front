import { Component, computed, effect, inject, input, output, signal } from '@angular/core';
import { TimeCatalogueService } from '@app/services/time/time-catalogue.service';
import { CategoryGroupKind, CategoryOption, CategoryOptionInput } from '@app/shared/time-types';
import { VButton } from '@ui-kit/components/v-button/v-button';
import { VCheckbox } from '@ui-kit/components/v-checkbox/v-checkbox';
import { VColorPicker } from '@ui-kit/components/v-color-picker/v-color-picker';
import { VInput } from '@ui-kit/components/v-input/v-input';

@Component({
  selector: 'category-option-form',
  templateUrl: './category-option-form.html',
  imports: [VButton, VCheckbox, VColorPicker, VInput],
})
export class CategoryOptionForm {
  public readonly categoryOptionInput = input<CategoryOption | null>(null);
  public readonly groupIdInput = input.required<number>();

  public readonly savedOutput = output<void>();
  public readonly cancelledOutput = output<void>();

  protected readonly name$$ = signal('');
  protected readonly color$$ = signal<string | null>(null);
  protected readonly isArchived$$ = signal(false);

  private readonly timeCatalogueService = inject(TimeCatalogueService);

  // Color only ever affects the board: the segment's color comes from the
  // kind='area' group's selected option — a color on an option from any other
  // group is never read anywhere, so the field is pointless there.
  protected readonly isAreaGroup$$ = computed(
    () => this.timeCatalogueService.groupById$$().get(this.groupIdInput())?.kind === CategoryGroupKind.Area,
  );

  public constructor() {
    effect(() => {
      const option = this.categoryOptionInput();
      if (option) {
        this.fillForm(option);
      } else {
        this.resetForm();
      }
    });
  }

  protected async save(): Promise<void> {
    if (!this.name$$()) return;

    const input: CategoryOptionInput = {
      groupId: this.groupIdInput(),
      name: this.name$$(),
      color: this.isAreaGroup$$() ? this.color$$() : null,
      isArchived: this.isArchived$$(),
    };

    const current = this.categoryOptionInput();
    const isSaved = current
      ? await this.timeCatalogueService.updateCategoryOption(current.id, input)
      : await this.timeCatalogueService.createCategoryOption(input);
    if (isSaved) {
      this.savedOutput.emit();
    }
  }

  protected cancel(): void {
    this.cancelledOutput.emit();
  }

  protected isEditing(): boolean {
    return Boolean(this.categoryOptionInput());
  }

  private fillForm(option: CategoryOption): void {
    this.name$$.set(option.name);
    this.color$$.set(option.color);
    this.isArchived$$.set(option.isArchived);
  }

  private resetForm(): void {
    this.name$$.set('');
    this.color$$.set(null);
    this.isArchived$$.set(false);
  }
}
