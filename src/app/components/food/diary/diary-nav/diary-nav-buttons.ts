import { CommonModule } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  ElementRef,
  inject,
  Signal,
  viewChild,
} from '@angular/core';
import { FormControl, ReactiveFormsModule } from '@angular/forms';
import { FOOD_DIARY_ACCORDION_GROUP_ID } from '@app/components/food/diary/food-diary-accordion';
import { FOOD_FAB_ROW_RIGHT_INSET_PX, FoodFabLayer, foodFabStackBottomPx } from '@app/components/food/food-fab-layout';
import { AuthService } from '@app/services/auth.service';
import { DeviceInfoService } from '@app/services/device-info.service';
import { FoodAddModalService } from '@app/services/food/food-add-modal.service';
import { FoodDiaryService } from '@app/services/food/food-diary.service';
import { FitTextOnOverflowDirective } from '@app/shared/directives/fit-text-on-overflow.directive';
import { calcDateWithUserTimeShift, calculateTodayIsoWithUserTimeShift, dateToIsoNoTimeNoTZ } from '@app/shared/utils';
import { VButton } from '@ui-kit/components/v-button/v-button';
import { IconName, VIcon } from '@ui-kit/components/v-icon/v-icon';
import { AccordionGroupService } from '@ui-kit/services/accordion-group.service';

@Component({
  selector: 'diary-nav-buttons',
  templateUrl: './diary-nav-buttons.html',
  styleUrl: './diary-nav-buttons.scss',
  changeDetection: ChangeDetectionStrategy.Eager,
  imports: [CommonModule, ReactiveFormsModule, FitTextOnOverflowDirective, VButton, VIcon],
})
export class DiaryNavButtons {
  private readonly accordionGroupService = inject(AccordionGroupService);

  protected readonly dateInputElem = viewChild<ElementRef<HTMLInputElement>>('dateInputElem');

  protected initDateTodayWithUserHourShift: Date = calcDateWithUserTimeShift(new Date());

  protected maxDateIso: string = dateToIsoNoTimeNoTZ(this.initDateTodayWithUserHourShift);

  protected readonly formCalendarSelectedDay: FormControl<string> = new FormControl<string>(this.maxDateIso, {
    nonNullable: true,
  });

  protected readonly weekdayFull$$: Signal<string> = computed(() =>
    this.formatWeekday(this.foodDiaryService.selectedDayIso$$(), 'long'),
  );

  protected readonly weekdayShort$$: Signal<string> = computed(() =>
    this.formatWeekday(this.foodDiaryService.selectedDayIso$$(), 'short'),
  );

  protected readonly dateFormatted$$: Signal<string> = computed(() =>
    this.formatDayMonth(this.foodDiaryService.selectedDayIso$$()),
  );

  protected readonly isTodaySelected$$: Signal<boolean> = computed(() => {
    return this.foodDiaryService.selectedDayIso$$() === calculateTodayIsoWithUserTimeShift();
  });

  // Undo arrow points left (back to today from the future); mirrored when today lies ahead.
  protected readonly isPastDaySelected$$: Signal<boolean> = computed(() => {
    return this.foodDiaryService.selectedDayIso$$() < calculateTodayIsoWithUserTimeShift();
  });

  protected readonly primaryActionIcon$$: Signal<IconName> = computed(() => {
    return this.isTodaySelected$$() ? IconName.CalendarMonth : IconName.Undo;
  });

  // Mirrors food-diary.ts's isAnyAccordionOpen$$ — hides the add-FAB while an accordion on
  // the food screen is expanded, since its "Сохранить"/panel controls sit right underneath
  // this FAB and users kept mis-tapping one for the other.
  protected readonly isAnyAccordionOpen$$: Signal<boolean> = computed(() =>
    this.accordionGroupService.isAnyOpen(FOOD_DIARY_ACCORDION_GROUP_ID),
  );

  protected readonly Icon = IconName;

  protected readonly authService = inject(AuthService);
  protected readonly deviceInfoService = inject(DeviceInfoService);
  private readonly foodDiaryService = inject(FoodDiaryService);
  private readonly foodAddModalService = inject(FoodAddModalService);

  // selectedDayIso$$ is the single source of truth (can change from outside this component, e.g.
  // a milestone "jump to date" button) — keep the native date input's control in sync with it
  // instead of tracking a parallel copy of the selected date here.
  private readonly syncCalendarInputEffect$$ = effect(() => {
    const selectedDayIso = this.foodDiaryService.selectedDayIso$$();
    if (this.formCalendarSelectedDay.value !== selectedDayIso) {
      this.formCalendarSelectedDay.setValue(selectedDayIso);
    }
  });

  protected readonly addFabBottomPx: string = foodFabStackBottomPx(FoodFabLayer.AddFood);
  protected readonly dateNavRowRightPx: string = `${FOOD_FAB_ROW_RIGHT_INSET_PX}px`;

  protected formatWeekday(dateIso: string, weekdayStyle: 'long' | 'short'): string {
    const date = new Date(dateIso);
    const result = date.toLocaleDateString('ru-RU', { weekday: weekdayStyle });
    return result[0].toUpperCase() + result.slice(1);
  }

  protected formatDayMonth(dateIso: string): string {
    const date = new Date(dateIso);
    const result = date.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' });

    const year = dateIso.slice(0, 4);
    const currentYear = calculateTodayIsoWithUserTimeShift().slice(0, 4);
    return year === currentYear ? result : `${result} ${year}`;
  }

  protected onDatePicked(event: Event): void {
    const input = event.target as HTMLInputElement | null;
    const dateIso = input?.value;
    if (!dateIso) return;

    this.foodDiaryService.selectedDayIso$$.set(dateIso);
  }

  protected onDateControlClick(): void {
    if (this.isTodaySelected$$()) {
      this.refreshTodayReference();
      this.openNativeDatePicker(this.dateInputElem()?.nativeElement);
      return;
    }

    this.goToToday();
  }

  protected goToPreviousDay(): void {
    this.switchCurrentDay(-1);
  }

  protected goToNextDay(): void {
    this.switchCurrentDay(1);
  }

  protected goToToday(): void {
    const todayDate = this.refreshTodayReference();
    const todayIso = dateToIsoNoTimeNoTZ(todayDate);
    this.foodDiaryService.selectedDayIso$$.set(todayIso);
  }

  private refreshTodayReference(): Date {
    const todayDate = calcDateWithUserTimeShift(new Date());
    this.initDateTodayWithUserHourShift = todayDate;
    this.maxDateIso = dateToIsoNoTimeNoTZ(todayDate);
    return todayDate;
  }

  private switchCurrentDay(dayShift: number): void {
    const oldDate = this.isoToDate(this.foodDiaryService.selectedDayIso$$());
    const newDate = new Date(oldDate);
    newDate.setDate(newDate.getDate() + dayShift);
    const newDateIso = dateToIsoNoTimeNoTZ(newDate);
    this.foodDiaryService.selectedDayIso$$.set(newDateIso);
  }

  private openNativeDatePicker(input: HTMLInputElement | null | undefined): void {
    if (!input) return;

    const inputWithPicker = input as HTMLInputElement & { showPicker?: () => void };
    if (typeof inputWithPicker.showPicker === 'function') {
      inputWithPicker.showPicker();
      return;
    }

    input.focus();
    input.click();
  }

  private isoToDate(iso: string): Date {
    const [year, month, day] = iso.split('-').map(Number);
    return new Date(year, month - 1, day);
  }

  protected openAddFoodModal(): void {
    this.accordionGroupService.closeAll(FOOD_DIARY_ACCORDION_GROUP_ID);
    this.foodAddModalService.openModal();
  }
}
