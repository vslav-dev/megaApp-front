import { computed, Service, signal } from '@angular/core';

const EMPTY_KEY_SET: ReadonlySet<string> = new Set();

// Which metric cards show their large expanded chart is transient page state —
// never persisted — but shared here rather than kept local to each metric-card-grid
// instance, so every card on the page (across every block/row) can be expanded
// independently while a single "collapse all" control can still reach all of them.
// Card keys are already globally unique (`service:name`, see metricPointsIndexKey),
// so no per-grid namespacing is needed.
@Service()
export class MetricCardExpansionService {
  private readonly expandedKeysState$$ = signal<ReadonlySet<string>>(EMPTY_KEY_SET);

  public readonly expandedKeys$$ = this.expandedKeysState$$.asReadonly();
  public readonly hasExpanded$$ = computed(() => this.expandedKeysState$$().size > 0);

  public toggle(key: string): void {
    this.expandedKeysState$$.update((current) => {
      const next = new Set(current);
      if (!next.delete(key)) {
        next.add(key);
      }
      return next;
    });
  }

  // Called when a grid's own column count drops below 2 (expanding stops being
  // meaningful there) — only that grid's own keys are dropped, other grids'
  // expanded cards are untouched.
  public collapseKeys(keys: Iterable<string>): void {
    const keysToRemove = new Set(keys);
    if (keysToRemove.size === 0) return;

    this.expandedKeysState$$.update((current) => {
      let changed = false;
      const next = new Set(current);
      for (const key of keysToRemove) {
        if (next.delete(key)) changed = true;
      }
      return changed ? next : current;
    });
  }

  public collapseAll(): void {
    if (this.expandedKeysState$$().size === 0) return;
    this.expandedKeysState$$.set(EMPTY_KEY_SET);
  }
}
