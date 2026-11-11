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
  public readonly nameInput = input.required<string>();
  public readonly durationLabelInput = input.required<string>();
  public readonly startClockInput = input.required<string>();
  public readonly endClockInput = input.required<string>();
  public readonly isTrueStartInput = input.required<boolean>();
  public readonly isTrueEndInput = input.required<boolean>();

  protected readonly nameText$$ = computed(() => (this.isTrueStartInput() ? '' : '◂ ') + this.nameInput());
  // Leading char is NBSP, not a regular space — each chunk is its own flex
  // item, and a plain leading space there gets trimmed by CSS whitespace
  // collapsing at the box edge, making the dot look glued to the previous
  // chunk. NBSP isn't collapsible, so it survives.
  protected readonly durationChunkText$$ = computed(() => `${NBSP}· ${this.durationLabelInput()}`);
  protected readonly startChunkText$$ = computed(() => `${NBSP}· ${this.startClockInput()}`);
  protected readonly endText$$ = computed(() => this.endClockInput() + (this.isTrueEndInput() ? '' : ' ▸'));

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
