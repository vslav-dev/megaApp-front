import { TestBed } from '@angular/core/testing';
import { SearchScope } from '@app/shared/types';
import { FoodAddModalService } from './food-add-modal.service';
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

  it('keeps the scope when the modal goes between its own states', () => {
    const { service, setSearchScope } = setup();

    service.openModal();
    service.addProduct();

    expect(setSearchScope).toHaveBeenCalledTimes(1);
  });
});
