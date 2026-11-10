import { Component, computed, inject, signal } from '@angular/core';
import { TimeCatalogueService } from '@app/services/time/time-catalogue.service';
import { DefaultModal } from '@app/shared/components/default-modal/default-modal';
import { FormModal } from '@app/shared/components/form-modal/form-modal';
import { CategoryGroup, CategoryGroupKind, CategoryOption } from '@app/shared/time-types';
import { VButton } from '@ui-kit/components/v-button/v-button';
import { VCard } from '@ui-kit/components/v-card/v-card';
import { IconName, VIcon } from '@ui-kit/components/v-icon/v-icon';
import { ICON_BUTTON } from '@app/components/time/time.const';
import { CategoryGroupForm } from './category-group-form/category-group-form';
import { CategoryOptionForm } from './category-option-form/category-option-form';

@Component({
  selector: 'category-groups-list',
  templateUrl: './category-groups-list.html',
  styleUrl: './category-groups-list.scss',
  imports: [CategoryGroupForm, CategoryOptionForm, DefaultModal, FormModal, VButton, VCard, VIcon],
})
export class CategoryGroupsList {
  protected readonly Icon = IconName;
  protected readonly iconButton = ICON_BUTTON;

  private readonly timeCatalogueService = inject(TimeCatalogueService);

  protected readonly groups$$ = computed(() =>
    [...this.timeCatalogueService.categoryGroups$$()].sort((a, b) => a.name.localeCompare(b.name)),
  );

  // ---------- Group form/delete ----------

  protected readonly showGroupForm$$ = signal(false);
  protected readonly editingGroup$$ = signal<CategoryGroup | null>(null);
  protected readonly isDeleteGroupConfirmOpen$$ = signal(false);

  private readonly pendingDeleteGroupId$$ = signal<number | null>(null);

  protected showCreateGroupForm(): void {
    this.editingGroup$$.set(null);
    this.showGroupForm$$.set(true);
  }

  protected editGroup(group: CategoryGroup): void {
    this.editingGroup$$.set(group);
    this.showGroupForm$$.set(true);
  }

  protected deleteGroup(id: number): void {
    this.pendingDeleteGroupId$$.set(id);
    this.isDeleteGroupConfirmOpen$$.set(true);
  }

  protected closeDeleteGroupConfirm(): void {
    this.isDeleteGroupConfirmOpen$$.set(false);
    this.pendingDeleteGroupId$$.set(null);
  }

  protected onDeleteGroupConfirmed(): void {
    const id = this.pendingDeleteGroupId$$();
    this.isDeleteGroupConfirmOpen$$.set(false);
    this.pendingDeleteGroupId$$.set(null);
    if (!id) return;
    void this.timeCatalogueService.deleteCategoryGroup(id);
  }

  protected onGroupSaved(): void {
    this.showGroupForm$$.set(false);
    this.editingGroup$$.set(null);
  }

  protected onGroupCancelled(): void {
    this.showGroupForm$$.set(false);
    this.editingGroup$$.set(null);
  }

  protected groupLabel(group: CategoryGroup): string {
    return group.kind === CategoryGroupKind.Area ? `${group.name} · area` : group.name;
  }

  // ---------- Options (inline per group, no separate list component) ----------

  protected readonly showOptionForm$$ = signal(false);
  protected readonly editingOption$$ = signal<CategoryOption | null>(null);
  protected readonly optionFormGroupId$$ = signal<number | null>(null);
  protected readonly isDeleteOptionConfirmOpen$$ = signal(false);

  private readonly pendingDeleteOptionId$$ = signal<number | null>(null);

  protected optionsForGroup(groupId: number): CategoryOption[] {
    return [...(this.timeCatalogueService.optionsByGroupId$$().get(groupId) ?? [])].sort((a, b) =>
      a.name.localeCompare(b.name),
    );
  }

  protected showCreateOptionForm(groupId: number): void {
    this.optionFormGroupId$$.set(groupId);
    this.editingOption$$.set(null);
    this.showOptionForm$$.set(true);
  }

  protected editOption(option: CategoryOption): void {
    this.optionFormGroupId$$.set(option.groupId);
    this.editingOption$$.set(option);
    this.showOptionForm$$.set(true);
  }

  protected deleteOption(id: number): void {
    this.pendingDeleteOptionId$$.set(id);
    this.isDeleteOptionConfirmOpen$$.set(true);
  }

  protected closeDeleteOptionConfirm(): void {
    this.isDeleteOptionConfirmOpen$$.set(false);
    this.pendingDeleteOptionId$$.set(null);
  }

  protected onDeleteOptionConfirmed(): void {
    const id = this.pendingDeleteOptionId$$();
    this.isDeleteOptionConfirmOpen$$.set(false);
    this.pendingDeleteOptionId$$.set(null);
    if (!id) return;
    void this.timeCatalogueService.deleteCategoryOption(id);
  }

  protected onOptionSaved(): void {
    this.showOptionForm$$.set(false);
    this.editingOption$$.set(null);
    this.optionFormGroupId$$.set(null);
  }

  protected onOptionCancelled(): void {
    this.showOptionForm$$.set(false);
    this.editingOption$$.set(null);
    this.optionFormGroupId$$.set(null);
  }
}
