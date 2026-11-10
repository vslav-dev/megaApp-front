import { Component, computed, effect, inject, input, output, signal } from '@angular/core';
import { TimeCatalogueService } from '@app/services/time/time-catalogue.service';
import { CategoryGroup, CategoryGroupInput, CategoryGroupKind } from '@app/shared/time-types';
import { VButton } from '@ui-kit/components/v-button/v-button';
import { VCheckbox } from '@ui-kit/components/v-checkbox/v-checkbox';
import { IconName, VIcon } from '@ui-kit/components/v-icon/v-icon';
import { VInput } from '@ui-kit/components/v-input/v-input';
import { VTooltip } from '@ui-kit/components/v-tooltip/v-tooltip';

@Component({
  selector: 'category-group-form',
  templateUrl: './category-group-form.html',
  imports: [VButton, VCheckbox, VIcon, VInput, VTooltip],
})
export class CategoryGroupForm {
  public readonly categoryGroupInput = input<CategoryGroup | null>(null);

  public readonly savedOutput = output<void>();
  public readonly cancelledOutput = output<void>();

  protected readonly Icon = IconName;

  protected readonly name$$ = signal('');
  protected readonly isArea$$ = signal(false);
  protected readonly isArchived$$ = signal(false);

  private readonly timeCatalogueService = inject(TimeCatalogueService);

  // Archiving is blocked server-side while a non-archived ActivityKind still
  // binds this group (see service.ensureGroupNotBoundToActiveKind) — surface
  // the same rule here so the toggle can't even be turned on, instead of the
  // user discovering it through a 409 after clicking Save.
  private readonly blockingKindNames$$ = computed(() => {
    const group = this.categoryGroupInput();
    if (!group) return [];
    return this.timeCatalogueService
      .activityKinds$$()
      .filter((kind) => !kind.isArchived && kind.groupBindings.some((binding) => binding.groupId === group.id))
      .map((kind) => kind.name);
  });

  protected readonly isArchiveBlocked$$ = computed(() => this.blockingKindNames$$().length > 0);

  // Un-archiving is never blocked — only disable the toggle while it's off
  // and turning it on would be rejected; an already-archived group stays freely editable.
  protected readonly isArchiveToggleDisabled$$ = computed(() => !this.isArchived$$() && this.isArchiveBlocked$$());

  protected readonly archiveBlockedTooltip$$ = computed(
    () =>
      `Can't archive — still bound to active activity kind(s): ${this.blockingKindNames$$().join(', ')}. Unbind it there first.`,
  );

  // Only one non-archived kind='area' group is allowed per user (see
  // service.ensureAreaUniqueness) — surface the same rule here so the
  // toggle can't even be turned on, instead of the user discovering it
  // through a 409 after clicking Save. Excludes the group being edited,
  // so re-saving the current area group itself is never blocked.
  private readonly conflictingAreaGroupName$$ = computed(() => {
    const currentId = this.categoryGroupInput()?.id;
    return (
      this.timeCatalogueService
        .categoryGroups$$()
        .find((group) => group.kind === CategoryGroupKind.Area && !group.isArchived && group.id !== currentId)?.name ??
      null
    );
  });

  protected readonly isAreaBlocked$$ = computed(() => this.conflictingAreaGroupName$$() !== null);

  // Turning the flag off is never blocked — only disable turning it on while
  // another group already holds it.
  protected readonly isAreaToggleDisabled$$ = computed(() => !this.isArea$$() && this.isAreaBlocked$$());

  protected readonly areaBlockedTooltip$$ = computed(
    () => `Can't set as area group — "${this.conflictingAreaGroupName$$()}" already is. Unset it there first.`,
  );

  public constructor() {
    effect(() => {
      const group = this.categoryGroupInput();
      if (group) {
        this.fillForm(group);
      } else {
        this.resetForm();
      }
    });
  }

  protected async save(): Promise<void> {
    if (!this.name$$()) return;

    const input: CategoryGroupInput = {
      name: this.name$$(),
      kind: this.isArea$$() ? CategoryGroupKind.Area : null,
      isArchived: this.isArchived$$(),
    };

    const current = this.categoryGroupInput();
    const isSaved = current
      ? await this.timeCatalogueService.updateCategoryGroup(current.id, input)
      : await this.timeCatalogueService.createCategoryGroup(input);
    if (isSaved) {
      this.savedOutput.emit();
    }
  }

  protected cancel(): void {
    this.cancelledOutput.emit();
  }

  protected isEditing(): boolean {
    return Boolean(this.categoryGroupInput());
  }

  private fillForm(group: CategoryGroup): void {
    this.name$$.set(group.name);
    this.isArea$$.set(group.kind === CategoryGroupKind.Area);
    this.isArchived$$.set(group.isArchived);
  }

  private resetForm(): void {
    this.name$$.set('');
    this.isArea$$.set(false);
    this.isArchived$$.set(false);
  }
}
