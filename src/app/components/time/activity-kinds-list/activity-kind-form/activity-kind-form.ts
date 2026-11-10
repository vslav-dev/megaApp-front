import { Component, computed, effect, inject, input, output, signal } from '@angular/core';
import { TimeCatalogueService } from '@app/services/time/time-catalogue.service';
import { ActivityKind, ActivityKindInput, GroupBinding } from '@app/shared/time-types';
import { VButton } from '@ui-kit/components/v-button/v-button';
import { VCheckbox } from '@ui-kit/components/v-checkbox/v-checkbox';
import { VInput } from '@ui-kit/components/v-input/v-input';

@Component({
  selector: 'activity-kind-form',
  templateUrl: './activity-kind-form.html',
  imports: [VButton, VCheckbox, VInput],
})
export class ActivityKindForm {
  public readonly activityKindInput = input<ActivityKind | null>(null);

  public readonly savedOutput = output<void>();
  public readonly cancelledOutput = output<void>();

  private readonly timeCatalogueService = inject(TimeCatalogueService);

  protected readonly groups$$ = computed(() => this.timeCatalogueService.categoryGroups$$());

  protected readonly name$$ = signal('');
  protected readonly isArchived$$ = signal(false);
  // groupId -> required. Presence in the map means the group is bound.
  protected readonly bindings$$ = signal<Map<number, boolean>>(new Map());

  public constructor() {
    effect(() => {
      const kind = this.activityKindInput();
      if (kind) {
        this.fillForm(kind);
      } else {
        this.resetForm();
      }
    });
  }

  protected isBound(groupId: number): boolean {
    return this.bindings$$().has(groupId);
  }

  protected isRequired(groupId: number): boolean {
    return this.bindings$$().get(groupId) ?? false;
  }

  protected toggleBound(groupId: number, isBound: boolean): void {
    this.bindings$$.update((current) => {
      const next = new Map(current);
      if (isBound) {
        next.set(groupId, false);
      } else {
        next.delete(groupId);
      }
      return next;
    });
  }

  protected toggleRequired(groupId: number, isRequired: boolean): void {
    this.bindings$$.update((current) => {
      if (!current.has(groupId)) return current;
      const next = new Map(current);
      next.set(groupId, isRequired);
      return next;
    });
  }

  protected async save(): Promise<void> {
    if (!this.name$$()) return;

    const groupBindings: GroupBinding[] = [...this.bindings$$().entries()].map(([groupId, required]) => ({
      groupId,
      required,
    }));
    const input: ActivityKindInput = {
      name: this.name$$(),
      isArchived: this.isArchived$$(),
      groupBindings,
    };

    const current = this.activityKindInput();
    const isSaved = current
      ? await this.timeCatalogueService.updateActivityKind(current.id, input)
      : await this.timeCatalogueService.createActivityKind(input);
    if (isSaved) {
      this.savedOutput.emit();
    }
  }

  protected cancel(): void {
    this.cancelledOutput.emit();
  }

  protected isEditing(): boolean {
    return Boolean(this.activityKindInput());
  }

  private fillForm(kind: ActivityKind): void {
    this.name$$.set(kind.name);
    this.isArchived$$.set(kind.isArchived);
    this.bindings$$.set(new Map(kind.groupBindings.map((binding) => [binding.groupId, binding.required])));
  }

  private resetForm(): void {
    this.name$$.set('');
    this.isArchived$$.set(false);
    this.bindings$$.set(new Map());
  }
}
