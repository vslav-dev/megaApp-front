import { UserSettings } from './types';

export const FETCH_DAYS_RANGE_OFFSET: number = 10; // TODO: create settings item out of this constant

export const DEFAULT_INPUT_FIELD_PROGRESS_TIMER: number = 2000;

export const DEFAULT_REQUEST_STATUS_FADE_OUT_TIMER: number = 3000;

export const DEFAULT_SETTINGS: UserSettings = {
  selectedChapterFood: false,
  selectedChapterMoney: false,
  chartPaletteLight: null,
  chartPaletteDark: null,
  userName: '',
};

export const BACKGROUND_SYNC_RETRIES_MAX: number = 3;

export const BACKGROUND_SYNC_TIMEOUT_MS: number = 8000;

// How long an auto-save namespace store (NamespaceSettingsStore.set()) waits for a quiet period
// before flushing its buffered field changes as a single PUT — collapses a burst of rapid changes
// (e.g. dragging a range slider) into one request instead of one per intermediate value.
export const SETTINGS_AUTO_SAVE_DEBOUNCE_MS: number = 500;

// How long the food search waits for a pause in typing before asking the server — a burst of keystrokes
// becomes one request for the final text. Results already in the local cache are shown without waiting.
export const FOOD_SEARCH_SEND_DEBOUNCE_MS: number = 200;

// How long a requested image generation may stay "in progress" without a result event before the client lets
// the user try again — the live event can be lost (socket drop). Exceeds the server's longest run: three
// attempts of up to two minutes each plus the waits between them.
export const FOOD_IMAGE_GENERATION_FALLBACK_MS: number = 8 * 60 * 1000;

// Registered cache entities and their current schema version. Bumping one key's version
// invalidates only that key — unlike the old single global CACHE_SCHEMA_VERSION, which
// invalidated everything at once whenever any one entity's format changed.
// A baseKey missing here is treated as retired: buildCacheKey/buildDeviceCacheKey refuse it
// (dev-mode), and any leftover stored copy is swept up by the next purge pass — this is also
// how a genuinely removed key (renamed or dropped) gets cleaned out, no separate obsolete-list
// needed. `food_diary` (pre-IndexedDB-migration localStorage blob) is intentionally absent for
// that reason — any leftover copy just gets purged.
export const CACHE_KEY_VERSIONS: Readonly<Record<string, number>> = {
  settings_core: 1,
  settings_food: 1,
  settings_money: 1,
  settings_metrics: 1,
  food_stats: 4,
  food_catalogue: 4,
  food_catalogue_version: 1,
  food_search_cache: 4,
  food_personal_kcals: 4,
  food_diary_deleted_day_snapshot: 4,
  money_snapshot: 4,
  metrics_history_cursors: 1,
  metrics_granularity: 4,
  metrics_active_card_layout_mode: 4,
  metrics_active_tooltip_mode: 4,
  metrics_force_zero_baseline_enabled: 4,
  metrics_anomaly_corridor_enabled: 4,
  metrics_y_tick_count_card: 1,
  metrics_y_tick_count_full_width: 1,
  metrics_y_tick_snap_tolerance_percent: 1,
  telemetry_queue: 1,
  sync_pending_operation: 4,
  food_sync_checkpoint: 1,
  navbar_collapsed: 1,
  dark_theme: 1,
};

// Owned here (not in idb-cache.ts) so IDB_STORE_SCHEMA_CHECKPOINTS below can key off the same
// constant instead of a bare string literal that could silently drift out of sync with it.
export const DIARY_DAYS_STORE_NAME = 'foodDiaryDays';

// IndexedDB dedicated per-record stores (see idb-cache.ts) can't carry a version in their keys
// the way localStorage/kv entries do (their keys are business data — dates — not ours to
// suffix). Instead each store records the IndexedDB DB_VERSION at which its record shape last
// changed; onupgradeneeded wipes and recreates only stores whose checkpoint is newer than the
// DB's previous version, leaving every other store untouched.

// One record per (service, metricName, granularity) series — replaces the single
// metrics_detail blob in the generic kv store (dropped from CACHE_KEY_VERSIONS above,
// so the old blob is swept by the next purge pass). See
// plans/35-metrics-dashboard-viewport-rendering.implementation-plan.md §2.4.
export const METRIC_SERIES_STORE_NAME = 'metricSeries';

export const IDB_STORE_SCHEMA_CHECKPOINTS: Readonly<Record<string, number>> = {
  [DIARY_DAYS_STORE_NAME]: 2,
  [METRIC_SERIES_STORE_NAME]: 3,
};

export const SESSION_BOOTSTRAP_TIMEOUT_MS: number = 9000;

export const NOTIFICATION_PENDING_DELAY_MS: number = 1500;

export const NOTIFICATION_DEFAULT_DURATION_MS: number = 3000;
