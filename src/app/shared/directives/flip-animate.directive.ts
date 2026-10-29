import { Directive, ElementRef, OnDestroy, OnInit, inject, input } from '@angular/core';

interface ElementPosition {
  element: HTMLElement;
  rect: DOMRect;
  key: string;
}

interface AnimationOptions {
  duration: number;
  easing: string;
}

@Directive({
  selector: '[flipAnimate]',
})
export class FlipAnimateDirective implements OnInit, OnDestroy {
  readonly flipAnimateDuration = input(200);
  readonly flipAnimateEasing = input('ease-out');
  readonly flipAnimateChildSelector = input('*');

  private mutationObserver?: MutationObserver;
  private previousPositions = new Map<string, ElementPosition>();
  private debounceTimeout?: ReturnType<typeof setTimeout>;
  private isAnimating = false;

  private readonly elementRef = inject(ElementRef<HTMLElement>);

  public ngOnInit(): void {
    this.captureInitialPositions();
    this.setupMutationObserver();
  }

  public ngOnDestroy(): void {
    this.cleanup();
  }

  private setupMutationObserver(): void {
    this.mutationObserver = new MutationObserver(() => {
      this.handleMutation();
    });

    this.mutationObserver.observe(this.elementRef.nativeElement, {
      childList: true,
      subtree: true,
      attributes: false,
    });
  }

  private handleMutation(): void {
    if (this.debounceTimeout) {
      clearTimeout(this.debounceTimeout);
    }

    this.debounceTimeout = setTimeout(() => {
      this.performFlipAnimation();
    }, 16); // ~1 frame delay
  }

  private captureInitialPositions(): void {
    this.captureCurrentPositions();
  }

  private captureCurrentPositions(): void {
    const children = this.getChildElements();
    this.previousPositions.clear();

    children.forEach((element) => {
      const key = this.getElementKey(element);
      const rect = element.getBoundingClientRect();

      this.previousPositions.set(key, {
        element,
        rect,
        key,
      });
    });
  }

  private performFlipAnimation(): void {
    if (this.isAnimating) {
      return;
    }

    this.isAnimating = true;

    try {
      const currentChildren = this.getChildElements();
      const newPositions = new Map<string, ElementPosition>();

      currentChildren.forEach((element) => {
        const key = this.getElementKey(element);
        const rect = element.getBoundingClientRect();

        newPositions.set(key, {
          element,
          rect,
          key,
        });
      });

      this.animateElements(newPositions);

      setTimeout(() => {
        this.previousPositions = newPositions;
        this.isAnimating = false;
      }, this.flipAnimateDuration());
    } catch (error) {
      console.error('FLIP animation error:', error);
      this.isAnimating = false;
    }
  }

  private animateElements(newPositions: Map<string, ElementPosition>): void {
    const animationOptions: AnimationOptions = {
      duration: this.flipAnimateDuration(),
      easing: this.flipAnimateEasing(),
    };

    newPositions.forEach((newPos, key) => {
      const oldPos = this.previousPositions.get(key);

      if (oldPos) {
        this.animateMovement(newPos.element, oldPos.rect, newPos.rect, animationOptions);
      } else {
        this.animateEntry(newPos.element, animationOptions);
      }
    });

    this.previousPositions.forEach((oldPos, key) => {
      if (!newPositions.has(key)) {
        this.animateExit(oldPos.element, animationOptions);
      }
    });
  }

  private animateMovement(element: HTMLElement, oldRect: DOMRect, newRect: DOMRect, options: AnimationOptions): void {
    const deltaX = oldRect.left - newRect.left;
    const deltaY = oldRect.top - newRect.top;

    if (deltaX === 0 && deltaY === 0) {
      return;
    }

    element.animate([{ transform: `translate(${deltaX}px, ${deltaY}px)` }, { transform: 'translate(0px, 0px)' }], {
      duration: options.duration,
      easing: options.easing,
      fill: 'both',
    });
  }

  private animateEntry(element: HTMLElement, options: AnimationOptions): void {
    element.animate(
      [
        {
          opacity: 0,
          transform: 'scale(0.8) translateY(10px)',
        },
        {
          opacity: 1,
          transform: 'scale(1) translateY(0px)',
        },
      ],
      {
        duration: options.duration * 0.8,
        easing: options.easing,
        fill: 'both',
      },
    );
  }

  private animateExit(element: HTMLElement, options: AnimationOptions): void {
    if (element.parentElement) {
      element.animate(
        [
          {
            opacity: 1,
            transform: 'scale(1) translateY(0px)',
          },
          {
            opacity: 0,
            transform: 'scale(0.8) translateY(-10px)',
          },
        ],
        {
          duration: options.duration * 0.6,
          easing: 'ease-in',
          fill: 'both',
        },
      );
    }
  }

  private getChildElements(): HTMLElement[] {
    const container = this.elementRef.nativeElement;
    const selector = this.flipAnimateChildSelector();

    if (selector === '*') {
      return Array.from(container.children) as HTMLElement[];
    } else {
      return Array.from(container.querySelectorAll(selector)) as HTMLElement[];
    }
  }

  private getElementKey(element: HTMLElement): string {
    const dataKey = element.getAttribute('data-flip-key');
    if (dataKey) {
      return dataKey;
    }

    const id = element.getAttribute('id');
    if (id) {
      return `id:${id}`;
    }

    const index = Array.from(element.parentElement?.children || []).indexOf(element);
    const tagName = element.tagName.toLowerCase();
    return `${tagName}:${index}:${element.textContent?.slice(0, 20) || ''}`;
  }

  private cleanup(): void {
    if (this.mutationObserver) {
      this.mutationObserver.disconnect();
    }

    if (this.debounceTimeout) {
      clearTimeout(this.debounceTimeout);
    }
  }
}
