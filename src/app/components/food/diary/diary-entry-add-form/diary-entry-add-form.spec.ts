import { Component, input, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { FoodAddModalService } from '@app/services/food/food-add-modal.service';
import { FoodCatalogueService } from '@app/services/food/food-catalogue.service';
import { FoodDiaryService } from '@app/services/food/food-diary.service';
import { FoodStatsService } from '@app/services/food/food-stats.service';
import { CatalogueEntry } from '@app/shared/types';
import { VRollingNumber } from '@ui-kit/components/v-rolling-number/v-rolling-number';
import { DiaryEntryAddForm } from './diary-entry-add-form';

const lollipops = { id: 7, name: 'Леденцы', archived: false } as CatalogueEntry;

@Component({ selector: 'v-rolling-number', template: '' })
class RollingNumberStub {
  public readonly textInput = input<string>('');
}

function setup() {
  const createDiaryEntry = vi.fn().mockResolvedValue({ result: true, diaryId: 1 });
  TestBed.configureTestingModule({
    providers: [
      {
        provide: FoodCatalogueService,
        useValue: { getCornerImageUrl: vi.fn(() => null), setSearchScope: vi.fn() },
      },
      {
        provide: FoodDiaryService,
        useValue: {
          selectedDayIso$$: signal('2026-10-30'),
          selectedDayTotals$$: signal({ kcalsPercent: 0 }),
          createDiaryEntry,
          setDraftEntryWeight: vi.fn(),
          clearDraftEntryWeight: vi.fn(),
        },
      },
      { provide: FoodStatsService, useValue: {} },
    ],
  });

  // The rolling number measures text ranges that jsdom cannot, and it is not what these tests are about.
  TestBed.overrideComponent(DiaryEntryAddForm, {
    remove: { imports: [VRollingNumber] },
    add: { imports: [RollingNumberStub] },
  });

  const modal = TestBed.inject(FoodAddModalService);
  modal.openModal();
  return { fixture: TestBed.createComponent(DiaryEntryAddForm), modal, createDiaryEntry };
}

async function submitWithWeight(fixture: ComponentFixture<DiaryEntryAddForm>, weight: string) {
  fixture.detectChanges();
  const input: HTMLInputElement = fixture.nativeElement.querySelector('input');
  input.value = weight;
  input.dispatchEvent(new Event('input'));
  await fixture.whenStable();
  fixture.nativeElement.querySelector('form').dispatchEvent(new Event('submit', { cancelable: true }));
  await fixture.whenStable();
}

describe('DiaryEntryAddForm passing the query of the pick', () => {
  it('creates the entry with the query the product was picked by', async () => {
    const { fixture, modal, createDiaryEntry } = setup();
    modal.selectProduct(lollipops, 'конфеты');

    await submitWithWeight(fixture, '40');

    expect(createDiaryEntry).toHaveBeenCalledWith(
      expect.objectContaining({ foodCatalogueId: 7, foodWeight: 40 }),
      'конфеты',
    );
  });

  it('creates the entry without a query for a product that was not picked from the results', async () => {
    const { fixture, modal, createDiaryEntry } = setup();
    modal.selectProduct(lollipops, null);

    await submitWithWeight(fixture, '40');

    expect(createDiaryEntry).toHaveBeenCalledWith(expect.objectContaining({ foodCatalogueId: 7 }), null);
  });
});
