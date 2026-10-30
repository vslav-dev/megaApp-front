import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { AuthService } from '@app/services/auth.service';
import { DeviceInfoService } from '@app/services/device-info.service';
import { FoodAddModalService, ModalState } from '@app/services/food/food-add-modal.service';
import { FoodCatalogueService } from '@app/services/food/food-catalogue.service';
import { FoodDiaryService } from '@app/services/food/food-diary.service';
import { CatalogueEntry, SearchScope } from '@app/shared/types';
import { FoodSearch } from './food-search';

const lollipops = { id: 7, name: 'Леденцы', archived: false } as CatalogueEntry;

function setup(pickedQuery: string | null = 'конфеты') {
  const createDiaryEntry = vi.fn().mockResolvedValue({ result: true, diaryId: 1 });
  const foodCatalogueFake = {
    isLegacySearch$$: signal(false),
    searchScope$$: signal(SearchScope.Active),
    searchResults$$: signal([lollipops]),
    legacySearchResults$$: signal([]),
    searchProducts: vi.fn(),
    legacySearchProducts: vi.fn(),
    clearSearch: vi.fn(),
    setSearchScope: vi.fn(),
    getThumbImageUrl: vi.fn(() => null),
    pickProduct: vi.fn(() => pickedQuery),
  };

  TestBed.configureTestingModule({
    providers: [
      { provide: FoodCatalogueService, useValue: foodCatalogueFake },
      { provide: FoodDiaryService, useValue: { selectedDayIso$$: signal('2026-10-30'), createDiaryEntry } },
      { provide: AuthService, useValue: { isAdmin$$: signal(false) } },
      { provide: DeviceInfoService, useValue: { isMobileScreen$$: signal(false) } },
    ],
  });

  const modal = TestBed.inject(FoodAddModalService);
  modal.openModal();
  const fixture = TestBed.createComponent(FoodSearch);
  return { fixture, modal, createDiaryEntry, foodCatalogueFake };
}

async function typeQuery(fixture: ComponentFixture<FoodSearch>, modal: FoodAddModalService, text: string) {
  modal.searchQuery$$.set(text);
  fixture.detectChanges();
  await fixture.whenStable();
}

async function clickFirstCard(fixture: ComponentFixture<FoodSearch>) {
  fixture.nativeElement.querySelector('v-card').click();
  await fixture.whenStable();
}

describe('FoodSearch passing the query of the pick', () => {
  it('creates the entry at once with the query when the weight is typed in the search', async () => {
    const { fixture, modal, createDiaryEntry } = setup();
    await typeQuery(fixture, modal, 'конфеты 40');

    await clickFirstCard(fixture);

    expect(createDiaryEntry).toHaveBeenCalledWith(
      expect.objectContaining({ foodCatalogueId: 7, foodWeight: 40 }),
      'конфеты',
    );
    expect(modal.currentState$$()).toBe(ModalState.CLOSED);
  });

  it('keeps the query with the product while the weight is asked in the add form', async () => {
    const { fixture, modal, createDiaryEntry } = setup();
    await typeQuery(fixture, modal, 'конфеты');

    await clickFirstCard(fixture);

    expect(createDiaryEntry).not.toHaveBeenCalled();
    expect(modal.currentState$$()).toBe(ModalState.ADD_DIARY_ENTRY);
    expect(modal.selectedProduct$$()).toBe(lollipops);
    expect(modal.selectedProductQuery$$()).toBe('конфеты');
  });

  it('sends no query for a pick in the legacy search', async () => {
    const { fixture, modal, createDiaryEntry } = setup(null);
    await typeQuery(fixture, modal, 'конфеты 40');

    await clickFirstCard(fixture);

    expect(createDiaryEntry).toHaveBeenCalledWith(expect.objectContaining({ foodWeight: 40 }), null);
  });

  it('keeps the query when the quick create fails and the add form opens instead', async () => {
    const { fixture, modal, createDiaryEntry } = setup();
    createDiaryEntry.mockResolvedValue({ result: false, diaryId: 0 });
    await typeQuery(fixture, modal, 'конфеты 40');

    await clickFirstCard(fixture);

    expect(modal.currentState$$()).toBe(ModalState.ADD_DIARY_ENTRY);
    expect(modal.selectedProductQuery$$()).toBe('конфеты');
  });
});
