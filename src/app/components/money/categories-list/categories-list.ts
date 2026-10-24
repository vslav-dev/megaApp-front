import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { ChartThemeService } from '@app/services/chart-theme.service';
import { MoneyComputeService } from '@app/services/money-compute.service';
import { MoneyService } from '@app/services/money.service';
import { seriesColorById } from '@app/shared/categorical-palette';
import { DefaultModal } from '@app/shared/components/default-modal/default-modal';
import { FormModal } from '@app/shared/components/form-modal/form-modal';
import { Category, CategoryType } from '@app/shared/types';
import { VButton } from '@ui-kit/components/v-button/v-button';
import { VCard } from '@ui-kit/components/v-card/v-card';
import { IconName, VIcon } from '@ui-kit/components/v-icon/v-icon';
import { ICON_BUTTON } from '../money.const';
import { CategoryForm } from './category-form/category-form';

@Component({
  selector: 'categories-list',
  templateUrl: './categories-list.html',
  imports: [CategoryForm, DefaultModal, FormModal, VButton, VCard, VIcon],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CategoriesList {
  protected readonly Icon = IconName;
  protected readonly iconButton = ICON_BUTTON;

  private readonly moneyService = inject(MoneyService);
  private readonly moneyComputeService = inject(MoneyComputeService);
  private readonly chartThemeService = inject(ChartThemeService);

  protected readonly categories$$ = computed(() => this.moneyService.categories$$());
  private readonly transactions$$ = computed(() => this.moneyService.transactions$$());

  protected readonly showForm$$ = signal(false);
  protected readonly editingCategory$$ = signal<Category | null>(null);
  // While a color slider in the form is held, the form's backdrop is lifted so the charts behind it
  // can be seen changing.
  protected readonly isSliderHeld$$ = signal(false);
  protected readonly isBackdropDimmed$$ = computed(() => !this.isSliderHeld$$());
  protected readonly isDeleteConfirmOpen$$ = signal(false);

  private readonly pendingDeleteId$$ = signal<number | null>(null);

  protected showCreateForm(): void {
    this.editingCategory$$.set(null);
    this.showForm$$.set(true);
  }

  protected editCategory(category: Category): void {
    this.editingCategory$$.set(category);
    this.showForm$$.set(true);
  }

  protected deleteCategory(id: number): void {
    if (!this.canDeleteCategory(id)) return;
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
    if (!this.canDeleteCategory(id)) return;
    this.moneyService.deleteCategory(id).subscribe((success) => {});
  }

  protected onSaved(): void {
    this.showForm$$.set(false);
    this.editingCategory$$.set(null);
  }

  protected onCancelled(): void {
    this.showForm$$.set(false);
    this.editingCategory$$.set(null);
  }

  protected getCategoryTypes(): CategoryType[] {
    return Object.values(CategoryType);
  }

  protected getCategoryTypeDisplayName(categoryType: CategoryType): string {
    switch (categoryType) {
      case CategoryType.INCOME:
        return 'Income';
      case CategoryType.EXPENSE:
        return 'Expense';
      default:
        return categoryType;
    }
  }

  // The color the category's chart series actually gets (its own hue, or the automatic one).
  protected getCategoryColor(category: Category): string {
    const seriesColors =
      category.categoryType === CategoryType.EXPENSE
        ? this.moneyComputeService.expenseSeriesColors$$()
        : this.moneyComputeService.incomeSeriesColors$$();
    return seriesColorById(seriesColors, category.id!, this.chartThemeService.colors$$());
  }

  protected getRootCategories(categoryType: CategoryType): Category[] {
    return this.categories$$()
      .filter((category) => category.categoryType === categoryType && !category.parentId)
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  protected getChildCategories(parentId: number): Category[] {
    return this.categories$$()
      .filter((category) => category.parentId === parentId)
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  private hasChildCategories(categoryId: number): boolean {
    return this.categories$$().some((category) => category.parentId === categoryId);
  }

  private hasLinkedTransactions(categoryId: number): boolean {
    return this.transactions$$().some((transaction) => transaction.categoryId === categoryId);
  }

  protected canDeleteCategory(categoryId: number): boolean {
    return !this.hasChildCategories(categoryId) && !this.hasLinkedTransactions(categoryId);
  }
}
