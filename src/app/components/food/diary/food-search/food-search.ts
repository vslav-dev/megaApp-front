import { ChangeDetectionStrategy, Component, effect, inject, viewChild } from '@angular/core';
import {
  FoodProductPicker,
  ProductPickerSelection,
} from '@app/components/food/diary/food-product-picker/food-product-picker';
import { FoodAddModalService, ModalState } from '@app/services/food/food-add-modal.service';
import { FoodDiaryService } from '@app/services/food/food-diary.service';
import { CatalogueEntry, DiaryEntry, HistoryEntryAction } from '@app/shared/types';

// Thin diary add-flow wrapper around the reusable FoodProductPicker: owns everything specific to
// "picking a product while adding a diary entry" (the shared modal state machine, the
// weight-in-query shortcut that creates the entry directly) — the picker itself knows nothing
// about diary entries or FoodAddModalService.
@Component({
  selector: 'food-search',
  templateUrl: './food-search.html',
  changeDetection: ChangeDetectionStrategy.Eager,
  imports: [FoodProductPicker],
})
export class FoodSearch {
  protected readonly foodAddModalService = inject(FoodAddModalService);
  private readonly foodDiaryService = inject(FoodDiaryService);

  private readonly pickerElem = viewChild(FoodProductPicker);

  private readonly focusOnOpenEffect$$ = effect(() => {
    if (this.foodAddModalService.currentState$$() === ModalState.SEARCH) {
      setTimeout(() => this.pickerElem()?.focusInput(), 200);
    }
  });

  private readonly clearSearchOnModalCloseEffect$$ = effect(() => {
    if (this.foodAddModalService.currentState$$() === ModalState.CLOSED) {
      this.foodAddModalService.searchQuery$$.set('');
    }
  });

  protected async onProductSelected(selection: ProductPickerSelection): Promise<void> {
    const { product, weight } = selection;

    const selectionCallback = this.foodAddModalService.productSelectionCallback$$();
    if (selectionCallback) {
      selectionCallback(product);
      this.foodAddModalService.closeModal();
      return;
    }

    // An archived product can't get a diary entry: it opens the add form (with the button disabled).
    if (weight !== null && weight > 0 && !product.archived) {
      await this.createDiaryEntryWithWeight(product, weight);
    } else {
      this.foodAddModalService.selectProduct(product);
    }
  }

  protected addProduct(): void {
    this.foodAddModalService.addProduct();
  }

  protected closeModal(): void {
    this.foodAddModalService.closeModal();
  }

  private async createDiaryEntryWithWeight(product: CatalogueEntry, weight: number): Promise<void> {
    const entry: DiaryEntry = {
      id: 0,
      dateISO: this.foodDiaryService.selectedDayIso$$(),
      foodCatalogueId: product.id,
      foodWeight: weight,
      kcals: 0,
      history: [{ action: HistoryEntryAction.INIT, value: weight }],
    };

    try {
      const response = await this.foodDiaryService.createDiaryEntry(entry);

      if (response?.result && response.diaryId) {
        this.foodAddModalService.submitSuccess();
      } else {
        this.foodAddModalService.selectProduct(product);
      }
    } catch (error) {
      console.error('Failed to create diary entry:', error);
      this.foodAddModalService.selectProduct(product);
    }
  }
}
