import { Component, computed, inject, signal } from '@angular/core';
import { TimeCatalogueService } from '@app/services/time/time-catalogue.service';
import { FormModal } from '@app/shared/components/form-modal/form-modal';
import { ActivityKind } from '@app/shared/time-types';
import { VButton } from '@ui-kit/components/v-button/v-button';
import { VCard } from '@ui-kit/components/v-card/v-card';
import { IconName, VIcon } from '@ui-kit/components/v-icon/v-icon';
import { ICON_BUTTON } from '@app/components/time/time.const';
import { ActivityKindForm } from './activity-kind-form/activity-kind-form';

@Component({
  selector: 'activity-kinds-list',
  templateUrl: './activity-kinds-list.html',
  imports: [ActivityKindForm, FormModal, VButton, VCard, VIcon],
})
export class ActivityKindsList {
  protected readonly Icon = IconName;
  protected readonly iconButton = ICON_BUTTON;

  private readonly timeCatalogueService = inject(TimeCatalogueService);

  protected readonly activityKinds$$ = computed(() =>
    [...this.timeCatalogueService.activityKinds$$()].sort((a, b) => a.name.localeCompare(b.name)),
  );

  protected readonly showForm$$ = signal(false);
  protected readonly editingKind$$ = signal<ActivityKind | null>(null);

  protected showCreateForm(): void {
    this.editingKind$$.set(null);
    this.showForm$$.set(true);
  }

  protected editKind(kind: ActivityKind): void {
    this.editingKind$$.set(kind);
    this.showForm$$.set(true);
  }

  protected onSaved(): void {
    this.showForm$$.set(false);
    this.editingKind$$.set(null);
  }

  protected onCancelled(): void {
    this.showForm$$.set(false);
    this.editingKind$$.set(null);
  }
}
