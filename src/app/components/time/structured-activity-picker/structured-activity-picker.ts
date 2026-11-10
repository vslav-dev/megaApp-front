import {
  afterNextRender,
  Component,
  computed,
  ElementRef,
  inject,
  input,
  OnInit,
  output,
  signal,
  viewChild,
} from '@angular/core';
import { TimeCatalogueService } from '@app/services/time/time-catalogue.service';
import { TimeDisplayPrefsService } from '@app/services/time/time-display-prefs.service';
import { TimeEntriesService } from '@app/services/time/time-entries.service';
import { CategoryOption, EntryOption } from '@app/shared/time-types';
import { VButton } from '@ui-kit/components/v-button/v-button';
import { VTopLayerDirective } from '@ui-kit/directives/top-layer.directive';
import { TimeOptionChips } from './time-option-chips/time-option-chips';

const VIEWPORT_MARGIN_PX = 8;

export interface StructuredActivitySelection {
  activityKindId: number;
  options: EntryOption[];
}

@Component({
  selector: 'structured-activity-picker',
  templateUrl: './structured-activity-picker.html',
  styleUrl: './structured-activity-picker.scss',
  host: {
    '(document:keydown.escape)': 'close()',
  },
  imports: [TimeOptionChips, VButton, VTopLayerDirective],
})
export class StructuredActivityPicker implements OnInit {
  public readonly x = input.required<number>();
  public readonly y = input.required<number>();
  // Edit mode: pass the entry's current selection so it's shown as-is
  // instead of a runtime preselect. Create mode: leave both at defaults.
  public readonly initialActivityKindId = input<number | null>(null);
  public readonly initialOptions = input<EntryOption[]>([]);

  public readonly confirmOutput = output<StructuredActivitySelection>();
  public readonly closeOutput = output<void>();

  private readonly timeCatalogueService = inject(TimeCatalogueService);
  private readonly timeEntriesService = inject(TimeEntriesService);
  protected readonly timeDisplayPrefsService = inject(TimeDisplayPrefsService);

  protected readonly panelElem = viewChild<ElementRef<HTMLElement>>('panelElem');

  protected readonly selectedKindId$$ = signal<number | null>(null);
  protected readonly selectedOptions$$ = signal<Map<number, number>>(new Map());
  protected readonly isPositioned$$ = signal(false);
  protected readonly fixedTop$$ = signal(0);
  protected readonly fixedLeft$$ = signal(0);

  protected readonly kindsByFrequency$$ = computed(() => {
    const kinds = this.timeCatalogueService.activityKinds$$().filter((kind) => !kind.isArchived);
    const usageCounts = new Map<number, number>();
    for (const entry of this.timeEntriesService.entries$$()) {
      usageCounts.set(entry.activityKindId, (usageCounts.get(entry.activityKindId) ?? 0) + 1);
    }
    return [...kinds].sort(
      (a, b) => (usageCounts.get(b.id) ?? 0) - (usageCounts.get(a.id) ?? 0) || a.name.localeCompare(b.name),
    );
  });

  protected readonly selectedKindName$$ = computed(
    () => this.timeCatalogueService.activityKindById$$().get(this.selectedKindId$$() ?? -1)?.name ?? '',
  );

  protected readonly applicableGroupIds$$ = computed(() => {
    const kindId = this.selectedKindId$$();
    if (kindId === null) return [];
    return this.timeCatalogueService.applicableGroupsByKindId$$().get(kindId) ?? [];
  });

  protected readonly canSubmit$$ = computed(() => {
    const kindId = this.selectedKindId$$();
    if (kindId === null) return false;
    const required = this.timeCatalogueService.requiredGroupIdsByKindId$$().get(kindId);
    if (!required) return true;
    const selected = this.selectedOptions$$();
    return [...required].every((groupId) => selected.has(groupId));
  });

  public constructor() {
    afterNextRender(() => this.updatePosition());
  }

  // Seeds edit-mode state from the entry's selection once — the caller creates a fresh instance
  // per open via @if, so later changes of the entry don't overwrite what the user picks here.
  // A create-mode instance has no initial kind and stays unselected until the user clicks one,
  // which goes through selectKind()'s runtime preselect.
  public ngOnInit(): void {
    const kindId = this.initialActivityKindId();
    if (kindId === null) return;
    this.selectedKindId$$.set(kindId);
    this.selectedOptions$$.set(new Map(this.initialOptions().map((option) => [option.groupId, option.optionId])));
  }

  // Prefers dropping below the click point; flips above only if it doesn't
  // fit below, then clamps to the viewport on both axes as a last resort.
  private updatePosition(): void {
    const panel = this.panelElem()?.nativeElement;
    if (!panel) return;
    const rect = panel.getBoundingClientRect();

    const fitsBelow = this.y() + rect.height + VIEWPORT_MARGIN_PX <= window.innerHeight;
    const top = fitsBelow ? this.y() : Math.max(VIEWPORT_MARGIN_PX, this.y() - rect.height);

    const maxLeft = window.innerWidth - rect.width - VIEWPORT_MARGIN_PX;
    const left = Math.min(Math.max(this.x(), VIEWPORT_MARGIN_PX), Math.max(maxLeft, VIEWPORT_MARGIN_PX));

    this.fixedTop$$.set(top);
    this.fixedLeft$$.set(left);
    this.isPositioned$$.set(true);
  }

  protected isKindSelected(kindId: number): boolean {
    return this.selectedKindId$$() === kindId;
  }

  protected groupName(groupId: number): string {
    return this.timeCatalogueService.groupById$$().get(groupId)?.name ?? '';
  }

  protected isRequired(groupId: number): boolean {
    const kindId = this.selectedKindId$$();
    if (kindId === null) return false;
    return this.timeCatalogueService.requiredGroupIdsByKindId$$().get(kindId)?.has(groupId) ?? false;
  }

  protected optionsForGroup(groupId: number): CategoryOption[] {
    const currentlySelected = this.selectedOptions$$().get(groupId);
    return (this.timeCatalogueService.optionsByGroupId$$().get(groupId) ?? []).filter(
      (option) => !option.isArchived || option.id === currentlySelected,
    );
  }

  protected selectKind(kindId: number): void {
    if (this.selectedKindId$$() === kindId) return;
    this.selectedKindId$$.set(kindId);
    this.selectedOptions$$.set(this.computePreselect(kindId));
  }

  protected setOption(groupId: number, optionId: number | null): void {
    this.selectedOptions$$.update((current) => {
      const next = new Map(current);
      if (optionId === null) {
        next.delete(groupId);
      } else {
        next.set(groupId, optionId);
      }
      return next;
    });
  }

  protected confirm(): void {
    const kindId = this.selectedKindId$$();
    if (kindId === null || !this.canSubmit$$()) return;
    const options: EntryOption[] = [...this.selectedOptions$$().entries()].map(([groupId, optionId]) => ({
      groupId,
      optionId,
    }));
    this.confirmOutput.emit({ activityKindId: kindId, options });
  }

  protected close(): void {
    this.closeOutput.emit();
  }

  // Runtime preselect (plan: "Runtime preselect") — a local UI hint derived
  // from history, never persisted as a catalog default. For each group
  // applicable to kindId, pick the option most frequently selected on past
  // entries of that kind; if "left empty" beats or ties the best option,
  // leave the group unselected. Archived options are never preselected.
  private computePreselect(kindId: number): Map<number, number> {
    const applicableGroupIds = this.timeCatalogueService.applicableGroupsByKindId$$().get(kindId) ?? [];
    const historyEntries = this.timeEntriesService.entries$$().filter((entry) => entry.activityKindId === kindId);
    const optionsById = new Map(this.timeCatalogueService.categoryOptions$$().map((option) => [option.id, option]));

    const result = new Map<number, number>();
    for (const groupId of applicableGroupIds) {
      const countsByOptionId = new Map<number, number>();
      let emptyCount = 0;
      for (const entry of historyEntries) {
        const selected = entry.options.find((option) => option.groupId === groupId);
        if (!selected) {
          emptyCount++;
          continue;
        }
        countsByOptionId.set(selected.optionId, (countsByOptionId.get(selected.optionId) ?? 0) + 1);
      }

      let bestOptionId: number | null = null;
      let bestCount = -1;
      for (const [optionId, count] of countsByOptionId) {
        if (optionsById.get(optionId)?.isArchived) continue;
        if (count > bestCount) {
          bestCount = count;
          bestOptionId = optionId;
        }
      }

      if (bestOptionId !== null && bestCount > emptyCount) {
        result.set(groupId, bestOptionId);
      }
    }
    return result;
  }
}
