import { afterNextRender, Component, computed, DestroyRef, ElementRef, inject, input, signal } from '@angular/core';
import { measureTextWidthPx } from '@app/shared/text-measure';

const MIN_GAP_PX = 4;
const NBSP = ' ';

type DisclosureLevel = 0 | 1 | 2 | 3;

@Component({
  selector: 'segment-label',
  templateUrl: './segment-label.html',
  styleUrl: './segment-label.scss',
})
export class SegmentLabel {
  public readonly name = input.required<string>();
  public readonly durationLabel = input.required<string>();
  public readonly startClock = input.required<string>();
  public readonly endClock = input.required<string>();
  public readonly isTrueStart = input.required<boolean>();
  public readonly isTrueEnd = input.required<boolean>();

  protected readonly nameText$$ = computed(() => (this.isTrueStart() ? '' : '◂ ') + this.name());
  // Leading char is NBSP, not a regular space — each chunk is its own flex
  // item, and a plain leading space there gets trimmed by CSS whitespace
  // collapsing at the box edge, making the dot look glued to the previous
  // chunk. NBSP isn't collapsible, so it survives.
  protected readonly durationChunkText$$ = computed(() => `${NBSP}· ${this.durationLabel()}`);
  protected readonly startChunkText$$ = computed(() => `${NBSP}· ${this.startClock()}`);
  protected readonly endText$$ = computed(() => this.endClock() + (this.isTrueEnd() ? '' : ' ▸'));

  protected readonly disclosureLevel$$ = computed<DisclosureLevel>(() => {
    const font = this.fontString$$();
    if (!font) return 0;

    const width = this.containerWidthPx$$();
    const nameW = measureTextWidthPx(this.nameText$$(), font);
    const durationW = measureTextWidthPx(this.durationChunkText$$(), font);
    const startW = measureTextWidthPx(this.startChunkText$$(), font);
    const endW = measureTextWidthPx(this.endText$$(), font);

    if (nameW + durationW + startW + MIN_GAP_PX + endW <= width) return 3;
    if (nameW + durationW + MIN_GAP_PX + endW <= width) return 2;
    if (nameW + durationW <= width) return 1;
    return 0;
  });

  private readonly hostElement = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;
  private readonly destroyRef = inject(DestroyRef);
  private readonly containerWidthPx$$ = signal(0);
  private readonly fontString$$ = signal('');

  public constructor() {
    afterNextRender(() => {
      this.containerWidthPx$$.set(this.hostElement.getBoundingClientRect().width);
      this.fontString$$.set(getComputedStyle(this.hostElement).font);

      const observer = new ResizeObserver((entries) => {
        const entry = entries[0];
        if (!entry) return;
        this.containerWidthPx$$.set(entry.contentRect.width);
        this.fontString$$.set(getComputedStyle(this.hostElement).font);
      });
      observer.observe(this.hostElement);
      this.destroyRef.onDestroy(() => observer.disconnect());
    });
  }
}
