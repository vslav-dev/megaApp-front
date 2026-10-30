import { TestBed } from '@angular/core/testing';
import { CatalogueEntry, SearchScope } from '@app/shared/types';
import { FoodAddModalService, ModalState } from './food-add-modal.service';
import { FoodCatalogueService } from './food-catalogue.service';

function setup() {
  const setSearchScope = vi.fn();
  TestBed.configureTestingModule({
    providers: [{ provide: FoodCatalogueService, useValue: { setSearchScope } }],
  });
  return { service: TestBed.inject(FoodAddModalService), setSearchScope };
}

describe('FoodAddModalService search scope', () => {
  it('searches only the products in use when the modal opens to add a diary entry', () => {
    const { service, setSearchScope } = setup();

    service.openModal();

    expect(setSearchScope).toHaveBeenLastCalledWith(SearchScope.Active);
  });

  it('searches archived products too when the modal opens to pick a product', () => {
    const { service, setSearchScope } = setup();

    service.openForProductSelection(vi.fn());

    expect(setSearchScope).toHaveBeenLastCalledWith(SearchScope.All);
  });

  it('decides the scope again for every modal session', () => {
    const { service, setSearchScope } = setup();

    service.openForProductSelection(vi.fn());
    service.closeModal();
    service.openModal();

    expect(setSearchScope).toHaveBeenLastCalledWith(SearchScope.Active);
  });

  it('keeps the query of the picked product while the product is edited, and drops it with the selection', () => {
    const { service } = setup();
    const product = { id: 1, name: 'Леденцы' } as CatalogueEntry;

    service.openModal();
    service.selectProduct(product, 'конфеты');
    expect(service.selectedProductQuery$$()).toBe('конфеты');

    service.editProduct(product);
    service.submitSuccess();
    expect(service.currentState$$()).toBe(ModalState.ADD_DIARY_ENTRY);
    expect(service.selectedProductQuery$$()).toBe('конфеты');

    service.goBackToSearch();
    expect(service.selectedProductQuery$$()).toBeNull();
  });

  it('forgets the query when the modal closes', () => {
    const { service } = setup();

    service.openModal();
    service.selectProduct({ id: 1, name: 'Леденцы' } as CatalogueEntry, 'конфеты');
    service.closeModal();

    expect(service.selectedProductQuery$$()).toBeNull();
  });

  it('does not give a product made in the modal the query of an earlier pick', () => {
    const { service } = setup();
    const made = { id: 2, name: 'Новый' } as CatalogueEntry;

    service.openModal();
    service.selectProduct({ id: 1, name: 'Леденцы' } as CatalogueEntry, 'конфеты');
    service.goBackToSearch();
    service.addProduct();
    service.transition('SUBMIT_SUCCESS', made);

    expect(service.selectedProduct$$()).toBe(made);
    expect(service.selectedProductQuery$$()).toBeNull();
  });

  it('keeps the scope when the modal goes between its own states', () => {
    const { service, setSearchScope } = setup();

    service.openModal();
    service.addProduct();

    expect(setSearchScope).toHaveBeenCalledTimes(1);
  });
});
