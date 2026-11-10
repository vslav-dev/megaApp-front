import { inject, Service, signal, WritableSignal } from '@angular/core';
import { CatalogueEntry, SearchScope } from '@app/shared/types';
import { FoodCatalogueService } from './food-catalogue.service';

export const ModalState = {
  CLOSED: 'CLOSED',
  SEARCH: 'SEARCH',
  ADD_DIARY_ENTRY: 'ADD_DIARY_ENTRY',
  CREATE_NEW_PRODUCT: 'CREATE_NEW_PRODUCT',
  EDIT_PRODUCT: 'EDIT_PRODUCT',
  CAMERA_PREVIEW: 'CAMERA_PREVIEW',
} as const;

export type ModalState = (typeof ModalState)[keyof typeof ModalState];

const ModalEvent = {
  OPEN: 'OPEN',
  CLOSE: 'CLOSE',
  SELECT_PRODUCT: 'SELECT_PRODUCT',
  ADD_PRODUCT: 'ADD_PRODUCT',
  EDIT_PRODUCT: 'EDIT_PRODUCT',
  DELETE_PRODUCT: 'DELETE_PRODUCT',
  GO_BACK: 'GO_BACK',
  SUBMIT_SUCCESS: 'SUBMIT_SUCCESS',
  TAKE_PHOTO: 'TAKE_PHOTO',
} as const;

type ModalEvent = (typeof ModalEvent)[keyof typeof ModalEvent];

interface ModalContext {
  from: ModalState;
  to: ModalState;
  payload?: CatalogueEntry | undefined;
}

type StateTransitionMap = {
  [state in ModalState]?: {
    [event in ModalEvent]?: ModalState;
  };
};

@Service()
export class FoodAddModalService {
  private readonly foodCatalogueService = inject(FoodCatalogueService);

  public readonly currentState$$: WritableSignal<ModalState> = signal(ModalState.CLOSED);

  public readonly searchQuery$$: WritableSignal<string> = signal('');

  public readonly selectedProduct$$: WritableSignal<CatalogueEntry | null> = signal(null);

  // The query of the search results the selected product was picked from; it lives and dies with the
  // selection, and stays when the product is edited. Null for a product made in the modal.
  public readonly selectedProductQuery$$: WritableSignal<string | null> = signal(null);

  // Set by callers that want to reuse this same search modal for something other than the default
  // "select a product → add a diary entry" flow (e.g. product-history's "track this product" picker).
  // When set, FoodSearch routes the picked product here instead of transitioning to ADD_DIARY_ENTRY.
  public readonly productSelectionCallback$$: WritableSignal<((product: CatalogueEntry) => void) | null> = signal(null);

  private readonly stateTransitions: StateTransitionMap = {
    [ModalState.CLOSED]: {
      [ModalEvent.OPEN]: ModalState.SEARCH,
    },
    [ModalState.SEARCH]: {
      [ModalEvent.SELECT_PRODUCT]: ModalState.ADD_DIARY_ENTRY,
      [ModalEvent.ADD_PRODUCT]: ModalState.CREATE_NEW_PRODUCT,
      [ModalEvent.TAKE_PHOTO]: ModalState.CAMERA_PREVIEW,
      [ModalEvent.SUBMIT_SUCCESS]: ModalState.CLOSED,
      [ModalEvent.CLOSE]: ModalState.CLOSED,
    },
    [ModalState.ADD_DIARY_ENTRY]: {
      [ModalEvent.GO_BACK]: ModalState.SEARCH,
      [ModalEvent.EDIT_PRODUCT]: ModalState.EDIT_PRODUCT,
      [ModalEvent.SUBMIT_SUCCESS]: ModalState.CLOSED,
      [ModalEvent.CLOSE]: ModalState.CLOSED,
    },
    [ModalState.CREATE_NEW_PRODUCT]: {
      [ModalEvent.GO_BACK]: ModalState.SEARCH,
      [ModalEvent.SUBMIT_SUCCESS]: ModalState.ADD_DIARY_ENTRY,
      [ModalEvent.CLOSE]: ModalState.CLOSED,
    },
    [ModalState.EDIT_PRODUCT]: {
      [ModalEvent.GO_BACK]: ModalState.ADD_DIARY_ENTRY,
      [ModalEvent.DELETE_PRODUCT]: ModalState.SEARCH,
      [ModalEvent.SUBMIT_SUCCESS]: ModalState.ADD_DIARY_ENTRY,
      [ModalEvent.CLOSE]: ModalState.CLOSED,
    },
    [ModalState.CAMERA_PREVIEW]: {
      [ModalEvent.GO_BACK]: ModalState.SEARCH,
      [ModalEvent.SUBMIT_SUCCESS]: ModalState.SEARCH,
      [ModalEvent.CLOSE]: ModalState.CLOSED,
    },
  };

  public transition(event: ModalEvent, payload?: CatalogueEntry): void {
    const currentState = this.currentState$$();
    const nextState = this.stateTransitions[currentState]?.[event];

    if (!nextState) {
      console.warn(`[FoodAddModalService] Invalid transition: ${currentState} + ${event}`);
      return;
    }

    const context: ModalContext = {
      from: currentState,
      to: nextState,
      payload,
    };

    this.executeTransitionSideEffects(context);
    this.currentState$$.set(nextState);
  }

  private executeTransitionSideEffects(context: ModalContext): void {
    const { from, to, payload } = context;

    switch (to) {
      case ModalState.SEARCH:
        if (from === ModalState.CLOSED) {
          this.searchQuery$$.set('');
          // The search scope lasts for one modal session. Picking a product to track in the history may
          // pick an archived one too, while a diary entry can only be added with a product in use.
          this.foodCatalogueService.setSearchScope(
            this.productSelectionCallback$$() ? SearchScope.All : SearchScope.Active,
          );
        }
        if (
          from === ModalState.ADD_DIARY_ENTRY ||
          from === ModalState.CREATE_NEW_PRODUCT ||
          from === ModalState.EDIT_PRODUCT
        ) {
          this.selectedProduct$$.set(null);
          this.selectedProductQuery$$.set(null);
        }
        break;

      case ModalState.ADD_DIARY_ENTRY:
        if (payload) {
          this.selectedProduct$$.set(payload);
        }
        break;

      case ModalState.CLOSED:
        this.searchQuery$$.set('');
        this.selectedProduct$$.set(null);
        this.selectedProductQuery$$.set(null);
        this.productSelectionCallback$$.set(null);
        break;
    }
  }

  public openModal(): void {
    this.productSelectionCallback$$.set(null);
    this.transition(ModalEvent.OPEN);
  }

  // Opens the same search modal but redirects the picked product to onSelect instead of the
  // default add-diary-entry flow. Closed the same way as any other modal state (X button, backdrop,
  // Escape) — the callback is cleared on close regardless of how it was reached.
  public openForProductSelection(onSelect: (product: CatalogueEntry) => void): void {
    this.productSelectionCallback$$.set(onSelect);
    this.transition(ModalEvent.OPEN);
  }

  public closeModal(): void {
    this.transition(ModalEvent.CLOSE);
  }

  public selectProduct(product: CatalogueEntry, query: string | null): void {
    this.selectedProductQuery$$.set(query);
    this.transition(ModalEvent.SELECT_PRODUCT, product);
  }

  public goBackToSearch(): void {
    this.transition(ModalEvent.GO_BACK);
  }

  public addProduct(): void {
    this.transition(ModalEvent.ADD_PRODUCT);
  }

  public takePhoto(): void {
    this.transition(ModalEvent.TAKE_PHOTO);
  }

  public submitSuccess(): void {
    this.transition(ModalEvent.SUBMIT_SUCCESS);
  }

  public editProduct(product: CatalogueEntry): void {
    this.transition(ModalEvent.EDIT_PRODUCT, product);
  }

  public deletedProduct(): void {
    this.transition(ModalEvent.DELETE_PRODUCT);
  }
}
