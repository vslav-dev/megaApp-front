import {
  Component,
  computed,
  effect,
  inject,
  input,
  model,
  output,
  signal,
} from '@angular/core';
import { AuthService } from '@app/services/auth.service';
import { DeviceInfoService } from '@app/services/device-info.service';
import { FoodCatalogueService } from '@app/services/food/food-catalogue.service';
import { ANIMATION_CLASSES } from '@app/shared/animations';
import { CatalogueEntry, SearchScope } from '@app/shared/types';
import { VButton } from '@ui-kit/components/v-button/v-button';
import { VCard } from '@ui-kit/components/v-card/v-card';
import { IconName, VIcon } from '@ui-kit/components/v-icon/v-icon';
import { VInput } from '@ui-kit/components/v-input/v-input';
import { FlipAnimateDirective } from '@ui-kit/directives/flip-animate.directive';

export interface ProductPickerSelection {
  product: CatalogueEntry;
  weight: number | null;
}

// Presentational catalogue search: type text, get a live results grid, pick a product. No
// dependency on the diary add-flow's FoodAddModalService and no side effect of its own (it never
// creates a diary entry) — callers wire productSelected/createNewProductRequested/closeRequested
// to whatever "selecting a product" means for them.
@Component({
  selector: 'food-product-picker',
  templateUrl: './food-product-picker.html',
  styleUrl: './food-product-picker.scss',
  imports: [VInput, VButton, VIcon, VCard, FlipAnimateDirective],
})
export class FoodProductPicker {
  public readonly query = model<string>('');
  public readonly allowCreateNewProduct = input<boolean>(true);

  public readonly productSelected = output<ProductPickerSelection>();
  public readonly createNewProductRequested = output<void>();
  public readonly closeRequested = output<void>();

  protected readonly Icon = IconName;
  protected readonly AnimationClass = ANIMATION_CLASSES;
  protected readonly deviceInfoService = inject(DeviceInfoService);
  protected readonly isLegacySearch$$ = computed(() => this.foodCatalogueService.isLegacySearch$$());
  protected readonly searchScope$$ = computed(() => this.foodCatalogueService.searchScope$$());
  protected readonly isArchiveSearch$$ = computed(() => this.searchScope$$() === SearchScope.Archived);
  // The scope All already includes the archive, so there is nothing to switch to.
  protected readonly isArchiveSearchAvailable$$ = computed(
    () => this.searchScope$$() !== SearchScope.All && this.authService.isAdmin$$(),
  );
  protected readonly searchResults$$ = computed(() =>
    this.isLegacySearch$$()
      ? this.foodCatalogueService.legacySearchResults$$()
      : this.foodCatalogueService.searchResults$$(),
  );
  protected readonly hasSearchResults$$ = computed(() => this.searchResults$$().length > 0);
  protected readonly extractedWeight$$ = signal<number | null>(null);

  private readonly authService = inject(AuthService);
  private readonly foodCatalogueService = inject(FoodCatalogueService);
  private readonly searchEffect$$ = effect(() => {
    const query = this.query();
    const isLegacy = this.isLegacySearch$$();
    this.searchScope$$(); // read to re-run the search when the search scope is switched

    if (query && query.trim()) {
      const { text, weight } = this.parseQuery(query);
      this.extractedWeight$$.set(weight);

      if (isLegacy) {
        this.foodCatalogueService.legacySearchProducts(text);
      } else {
        this.foodCatalogueService.searchProducts(text);
      }
    } else {
      this.extractedWeight$$.set(null);
      this.foodCatalogueService.clearSearch();
    }
  });

  public focusInput(): void {
    const inputEl = document.querySelector('v-input.catalogue-entry-name-input input') as HTMLInputElement;
    if (inputEl) inputEl.focus();
  }

  protected toggleLegacySearch(): void {
    this.foodCatalogueService.toggleLegacySearch();
  }

  protected toggleArchiveSearch(): void {
    this.foodCatalogueService.toggleArchiveSearch();
  }

  protected onClearClick(): void {
    this.query.set('');
  }

  protected onEnterPressed(event: KeyboardEvent): void {
    if (event.isComposing) return;

    const first = this.searchResults$$()[0];
    if (!first) return;

    event.preventDefault();
    event.stopPropagation();
    this.selectProduct(first);
  }

  protected selectProduct(product: CatalogueEntry): void {
    this.productSelected.emit({ product, weight: this.extractedWeight$$() });
  }

  protected requestCreateNewProduct(): void {
    this.createNewProductRequested.emit();
  }

  protected requestClose(): void {
    this.closeRequested.emit();
  }

  protected getDisplayName(catalogueEntry: CatalogueEntry): string {
    return this.isLegacySearch$$() ? catalogueEntry.legacyName || catalogueEntry.name : catalogueEntry.name;
  }

  protected getImageUrl(catalogueEntry: CatalogueEntry): string | null {
    return this.foodCatalogueService.getThumbImageUrl(catalogueEntry.id) ?? null;
  }

  private parseQuery(query: string): { text: string; weight: number | null } {
    const trimmedQuery = query.trim();
    const words = trimmedQuery.split(/\s+/); // Whitespaces

    const lastWord = words[words.length - 1];
    const weightMatch = lastWord?.match(/^(\d+)$/); // Digits only

    if (weightMatch && words.length > 1) {
      const weight = parseInt(weightMatch[1], 10);

      if (weight > 0) {
        const textWithoutWeight = words.slice(0, -1).join(' ').trim();
        return { text: textWithoutWeight, weight };
      }
    }

    return { text: trimmedQuery, weight: null };
  }
}
