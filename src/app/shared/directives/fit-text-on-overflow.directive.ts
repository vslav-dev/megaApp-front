import { Directive, ElementRef, OnDestroy, OnInit, effect, input, signal } from '@angular/core';

@Directive({
  selector: '[fitTextOnOverflow]',
  exportAs: 'fitTextOnOverflow',
})
export class FitTextOnOverflowDirective implements OnInit, OnDestroy {
  public readonly fullText = input.required<string>();
  public readonly shortText = input.required<string>();
  // 'width' fits horizontal text into a fixed-width box (the original use case).
  // 'height' fits vertical (writing-mode) text into a fixed-height box instead —
  // the element must already have its height constrained by its layout (e.g. an
  // absolutely-positioned label inside a sized wrapper), otherwise clientHeight
  // just grows to match scrollHeight and the comparison never trips.
  public readonly fitTextOnOverflowAxis = input<'width' | 'height'>('width');

  // The text this directive last decided fits (fullText or shortText). Simple
  // usages don't need this — the directive already writes the chosen text into
  // its own element (below). It exists for the case where the element being
  // measured can't also be the one displayed (e.g. a sticky label, whose own
  // box can't be stretched to the full height needed for measurement) — bind a
  // template reference (#ref="fitTextOnOverflow") to the measuring element and
  // read ref.text() on the separate display element instead.
  public readonly text = signal('');

  private readonly element: HTMLElement;
  private isInitialized = false;
  private resizeObserver?: ResizeObserver;
  private rafId: number | null = null;
  private windowResizeListener?: () => void;

  private readonly inputsEffect = effect(() => {
    this.fullText();
    this.shortText();
    this.fitTextOnOverflowAxis();

    if (!this.isInitialized) return;

    this.scheduleUpdate();
  });

  constructor(el: ElementRef<HTMLElement>) {
    this.element = el.nativeElement;
  }

  public ngOnInit(): void {
    this.isInitialized = true;
    this.setupResizeObserver();
    this.scheduleUpdate();
  }

  public ngOnDestroy(): void {
    if (this.resizeObserver) {
      this.resizeObserver.disconnect();
      this.resizeObserver = undefined;
    }

    if (this.windowResizeListener) {
      window.removeEventListener('resize', this.windowResizeListener);
      this.windowResizeListener = undefined;
    }

    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
  }

  private setupResizeObserver(): void {
    if (typeof ResizeObserver === 'undefined') {
      this.windowResizeListener = () => this.scheduleUpdate();
      window.addEventListener('resize', this.windowResizeListener);
      return;
    }

    this.resizeObserver = new ResizeObserver(() => {
      this.scheduleUpdate();
    });

    this.resizeObserver.observe(this.element);
  }

  private scheduleUpdate(): void {
    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId);
    }

    this.rafId = requestAnimationFrame(() => {
      this.rafId = null;
      this.updateText();
    });
  }

  private updateText(): void {
    const fullText = this.fullText();
    const shortText = this.shortText();

    if (this.element.textContent !== fullText) {
      this.element.textContent = fullText;
    }

    const isOverflowing =
      this.fitTextOnOverflowAxis() === 'height'
        ? this.element.scrollHeight > this.element.clientHeight
        : this.element.scrollWidth > this.element.clientWidth;
    const nextText = isOverflowing ? shortText : fullText;

    if (this.element.textContent !== nextText) {
      this.element.textContent = nextText;
    }
    this.text.set(nextText);
  }
}
