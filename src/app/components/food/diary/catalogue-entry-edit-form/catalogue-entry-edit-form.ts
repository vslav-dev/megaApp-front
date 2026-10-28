import { HttpErrorResponse } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, computed, inject, OnInit, signal } from '@angular/core';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { AuthService } from '@app/services/auth.service';
import { FoodAddModalService } from '@app/services/food/food-add-modal.service';
import { FoodCatalogueService } from '@app/services/food/food-catalogue.service';
import { NotificationService } from '@app/services/notification.service';
import { DefaultModal } from '@app/shared/components/default-modal/default-modal';
import { CatalogueEntry, ProductPreviewData, ProductSaveRequest } from '@app/shared/types';
import { VButton } from '@ui-kit/components/v-button/v-button';
import { VCheckbox } from '@ui-kit/components/v-checkbox/v-checkbox';
import { IconName, VIcon } from '@ui-kit/components/v-icon/v-icon';
import { VInput } from '@ui-kit/components/v-input/v-input';

const FormMode = {
  Create: 'create',
  Edit: 'edit',
} as const;

type FormMode = (typeof FormMode)[keyof typeof FormMode];

const POSITIVE_INTEGER_PATTERN = /^\d+$/;
const POSITIVE_DECIMAL_PATTERN = /^\d*[.,]?\d*$/;

@Component({
  selector: 'catalogue-entry-edit-form',
  templateUrl: './catalogue-entry-edit-form.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [DefaultModal, ReactiveFormsModule, VButton, VCheckbox, VIcon, VInput],
})
export class CatalogueEntryEditForm implements OnInit {
  protected readonly Icon = IconName;

  private readonly authService = inject(AuthService);
  private readonly foodAddModalService = inject(FoodAddModalService);
  private readonly foodCatalogueService = inject(FoodCatalogueService);
  private readonly notificationService = inject(NotificationService);

  protected formMode = FormMode;
  protected readonly mode$$ = computed(() => {
    const selectedProduct = this.foodAddModalService.selectedProduct$$();
    return selectedProduct ? this.formMode.Edit : this.formMode.Create;
  });

  protected readonly productToEdit$$ = computed(() => this.foodAddModalService.selectedProduct$$());

  // Only an admin may archive, and only an existing product (a new one starts not archived).
  protected readonly canEditArchive$$ = computed(
    () => this.authService.isAdmin$$() && this.mode$$() === this.formMode.Edit,
  );
  protected readonly isArchived$$ = signal(false);

  protected readonly isLoadingPreview$$ = signal(false);
  protected readonly isSaving$$ = signal(false);
  protected readonly isDeleting$$ = signal(false);
  protected readonly isDeleteConfirmOpen$$ = signal(false);
  protected readonly error$$ = signal<string | null>(null);

  protected readonly searchQuery$$ = computed(() => this.foodAddModalService.searchQuery$$());

  // The picture is read from the catalogue, not from the selected product: that one is a snapshot and would not
  // pick up an image that arrives later over the WebSocket.
  protected readonly imageUrl$$ = computed(() => {
    const product = this.productToEdit$$();
    return product ? this.foodCatalogueService.getThumbImageUrl(product.id) : undefined;
  });
  protected readonly isImageGenerating$$ = computed(() => {
    const product = this.productToEdit$$();
    return product ? this.foodCatalogueService.isImageGenerating(product.id) : false;
  });
  protected readonly canRegenerateImage$$ = computed(
    () => this.authService.isAdmin$$() && this.mode$$() === this.formMode.Edit,
  );
  protected readonly regenerateButtonLabel$$ = computed(() => {
    if (this.isImageGenerating$$()) {
      return 'Генерация картинки...';
    }
    return this.imageUrl$$() ? 'Перегенерировать картинку' : 'Сгенерировать картинку';
  });
  protected readonly isRegenerateConfirmOpen$$ = signal(false);

  protected catalogueEditForm: FormGroup = new FormGroup({
    name: new FormControl<string>('', [Validators.required, Validators.minLength(1), Validators.maxLength(100)]),
    kcals: new FormControl<string | null>(null, [
      Validators.required,
      Validators.pattern(POSITIVE_INTEGER_PATTERN),
      Validators.min(0),
      Validators.max(1000),
    ]),
    protein: new FormControl<string | null>(null, [
      Validators.required,
      Validators.pattern(POSITIVE_DECIMAL_PATTERN),
      Validators.min(0),
      Validators.max(100),
    ]),
    fat: new FormControl<string | null>(null, [
      Validators.required,
      Validators.pattern(POSITIVE_DECIMAL_PATTERN),
      Validators.min(0),
      Validators.max(100),
    ]),
    carbs: new FormControl<string | null>(null, [
      Validators.required,
      Validators.pattern(POSITIVE_DECIMAL_PATTERN),
      Validators.min(0),
      Validators.max(100),
    ]),
    fiber: new FormControl<string | null>(null, [
      Validators.required,
      Validators.pattern(POSITIVE_DECIMAL_PATTERN),
      Validators.min(0),
      Validators.max(50),
    ]),
    description: new FormControl<string>('', [
      Validators.required,
      Validators.minLength(1),
      Validators.maxLength(2000),
    ]),
  });

  public async ngOnInit(): Promise<void> {
    const mode = this.mode$$();

    if (mode === this.formMode.Edit) {
      await this.loadExistingProductData();
    } else {
      await this.loadProductPreview();
    }
  }

  private async loadExistingProductData(): Promise<void> {
    const product = this.productToEdit$$();

    console.log('[CatalogueEditForm] Loading existing product data:', product);

    if (!product) {
      this.error$$.set('No product selected for editing');
      return;
    }

    this.patchFormWithProduct(product);

    try {
      const freshProduct = await this.foodCatalogueService.getProductById(product.id);
      this.foodAddModalService.selectedProduct$$.set(freshProduct);
      this.patchFormWithProduct(freshProduct);
    } catch (error) {
      console.error('Failed to refresh product before editing:', error);
    }
  }

  private patchFormWithProduct(product: CatalogueEntry): void {
    this.catalogueEditForm.patchValue({
      name: product.name,
      kcals: String(product.kcals),
      protein: String(product.protein),
      fat: String(product.fat),
      carbs: String(product.carbs),
      fiber: String(product.fiber),
      description: product.description,
    });
    this.isArchived$$.set(Boolean(product.archived));

    console.log('[CatalogueEditForm] Form values after patching:', this.catalogueEditForm.value);
  }

  private async loadProductPreview(): Promise<void> {
    const query = this.searchQuery$$();

    if (!query || query.trim().length === 0) {
      this.error$$.set('Search query is empty');
      return;
    }

    this.isLoadingPreview$$.set(true);
    this.error$$.set(null);

    try {
      const previewData = await this.foodCatalogueService.generateProductPreview(query);
      this.fillFormWithPreviewData(previewData);
    } catch (error: any) {
      console.error('Failed to load product preview:', error);
      this.error$$.set('Failed to generate product data. Please try again.');
    } finally {
      this.isLoadingPreview$$.set(false);
    }
  }

  private fillFormWithPreviewData(data: ProductPreviewData): void {
    this.catalogueEditForm.patchValue({
      name: data.generalizedName,
      kcals: String(data.kcals),
      protein: String(data.protein),
      fat: String(data.fat),
      carbs: String(data.carbs),
      fiber: String(data.fiber),
      description: data.description,
    });
  }

  protected isFormValid(): boolean {
    return this.catalogueEditForm.valid;
  }

  protected async submitForm(): Promise<void> {
    if (!this.isFormValid() || this.isSaving$$() || this.isDeleting$$()) {
      return;
    }

    this.isSaving$$.set(true);
    this.error$$.set(null);

    try {
      const formValue = this.catalogueEditForm.value;
      const mode = this.mode$$();
      const productToEdit = this.productToEdit$$();

      const productData: ProductSaveRequest = {
        name: formValue.name,
        kcals: Number(formValue.kcals) || 0,
        protein: Number(String(formValue.protein).replace(',', '.')) || 0,
        fat: Number(String(formValue.fat).replace(',', '.')) || 0,
        carbs: Number(String(formValue.carbs).replace(',', '.')) || 0,
        fiber: Number(String(formValue.fiber).replace(',', '.')) || 0,
        description: formValue.description,
      };

      console.log('[CatalogueEditForm] Product data to save:', productData);

      if (mode === this.formMode.Edit && productToEdit) {
        productData.id = productToEdit.id;
      }

      if (this.canEditArchive$$()) {
        productData.archived = this.isArchived$$();
      }

      const savedProduct = await this.foodCatalogueService.saveProduct(productData);

      console.log('[CatalogueEditForm] Product saved successfully:', savedProduct);
      console.log('[CatalogueEditForm] Mode:', mode);

      this.foodAddModalService.selectedProduct$$.set(savedProduct);

      if (mode === this.formMode.Create) {
        this.foodCatalogueService.searchProducts(this.searchQuery$$());
      }

      this.notificationService.addNotification(
        'success',
        mode === this.formMode.Create ? 'Продукт добавлен' : 'Продукт обновлён',
      );
      this.foodAddModalService.submitSuccess();
    } catch (error: any) {
      console.error('Failed to save product:', error);

      if (error?.body?.error?.includes('already exists')) {
        this.error$$.set('Product with this name already exists. Please use a different name.');
      } else {
        this.error$$.set('Failed to save product. Please try again.');
      }
    } finally {
      this.isSaving$$.set(false);
    }
  }

  protected goBack(): void {
    this.foodAddModalService.goBackToSearch();
  }

  // Replacing an existing picture asks first: the old one is dropped once the new one is ready.
  protected onRegenerateClick(): void {
    if (this.isImageGenerating$$()) {
      return;
    }

    if (this.imageUrl$$()) {
      this.isRegenerateConfirmOpen$$.set(true);
    } else {
      void this.regenerateImage();
    }
  }

  protected closeRegenerateConfirmation(): void {
    this.isRegenerateConfirmOpen$$.set(false);
  }

  protected onRegenerateConfirmed(): void {
    this.isRegenerateConfirmOpen$$.set(false);
    void this.regenerateImage();
  }

  private async regenerateImage(): Promise<void> {
    const product = this.productToEdit$$();

    if (!product) {
      return;
    }

    try {
      await this.foodCatalogueService.regenerateProductImage(product.id);
    } catch (error: unknown) {
      console.error('Failed to start image generation:', error);
      const status = error instanceof HttpErrorResponse ? error.status : 0;

      if (status === 404) {
        this.notificationService.addNotification('error', 'Продукт не найден');
        this.foodAddModalService.deletedProduct();
        return;
      }

      this.notificationService.addNotification('error', this.getRegenerateErrorMessage(status));
    }
  }

  private getRegenerateErrorMessage(status: number): string {
    switch (status) {
      case 403:
        return 'Генерировать картинки может только администратор';
      case 409:
        return 'Генерация картинок выключена на сервере';
      case 429:
        return 'Очередь генерации картинок переполнена, попробуйте позже';
      default:
        return 'Не удалось запустить генерацию картинки';
    }
  }

  protected openDeleteConfirmation(): void {
    if (!this.productToEdit$$()?.canDelete || this.isSaving$$() || this.isDeleting$$()) {
      return;
    }

    this.isDeleteConfirmOpen$$.set(true);
  }

  protected closeDeleteConfirmation(): void {
    this.isDeleteConfirmOpen$$.set(false);
  }

  protected onDeleteConfirmed(): void {
    this.isDeleteConfirmOpen$$.set(false);
    void this.deleteProduct();
  }

  private async deleteProduct(): Promise<void> {
    const product = this.productToEdit$$();

    if (!product?.canDelete || this.isDeleting$$()) {
      return;
    }

    this.isDeleting$$.set(true);
    this.error$$.set(null);

    try {
      await this.foodCatalogueService.deleteProduct(product.id);
      this.notificationService.addNotification('success', 'Продукт удалён');
      this.foodAddModalService.deletedProduct();
    } catch (error: any) {
      console.error('Failed to delete product:', error);

      if (error?.body?.error === 'product is used in diary entries') {
        this.error$$.set('Продукт уже используется в дневнике и не может быть удалён.');
        this.foodAddModalService.selectedProduct$$.set({
          ...product,
          canDelete: false,
        });
      } else if (error?.body?.error === 'product not found') {
        this.foodAddModalService.deletedProduct();
      } else {
        this.error$$.set('Не удалось удалить продукт. Попробуйте ещё раз.');
      }
    } finally {
      this.isDeleting$$.set(false);
    }
  }
}
