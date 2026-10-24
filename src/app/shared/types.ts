//                                                                           APP

//                                                                          AUTH

export interface UserCreds {
  username: string;
  password: string;
}

export interface SessionResponse {
  authenticated: boolean;
  userId: number;
  username: string;
  isAdmin: boolean;
  expiresAt: string;
}

//                                                                            WS

export const WebSocketMessageType = {
  PING: 'PING',
  PONG: 'PONG',
  SYNC_STATUS: 'SYNC_STATUS',
  DIARY_ENTRY_CREATED: 'DIARY_ENTRY_CREATED',
  DIARY_ENTRY_UPDATED: 'DIARY_ENTRY_UPDATED',
  DIARY_ENTRY_DELETED: 'DIARY_ENTRY_DELETED',
  DIARY_DAY_DELETED: 'DIARY_DAY_DELETED',
  BODY_WEIGHT_UPDATED: 'BODY_WEIGHT_UPDATED',
  SEARCH_QUERY: 'SEARCH_QUERY',
  SEARCH_RESULTS: 'SEARCH_RESULTS',
  CATALOGUE_ENTRY_SAVED: 'CATALOGUE_ENTRY_SAVED',
  CATALOGUE_ENTRY_DELETED: 'CATALOGUE_ENTRY_DELETED',
  CATALOGUE_IMAGE_GENERATED: 'CATALOGUE_IMAGE_GENERATED',
  CATALOGUE_IMAGE_FAILED: 'CATALOGUE_IMAGE_FAILED',
  METRICS_HEALTH: 'METRICS_HEALTH',
  METRICS_SUBSCRIBE: 'METRICS_SUBSCRIBE',
  METRICS_UNSUBSCRIBE: 'METRICS_UNSUBSCRIBE',
  SETTINGS_UPDATED: 'SETTINGS_UPDATED',
} as const;

export type WebSocketMessageType = (typeof WebSocketMessageType)[keyof typeof WebSocketMessageType];

export interface PingWsMessage {
  type: typeof WebSocketMessageType.PING;
}

export interface PongWsMessage {
  type: typeof WebSocketMessageType.PONG;
}

export interface UserDataLastModifiedTs {
  userDataLastModifiedTs: number;
}

export interface SyncStatusWsMessage {
  type: typeof WebSocketMessageType.SYNC_STATUS;
  payload: UserDataLastModifiedTs;
}

export interface DiaryEntryToCreate extends DiaryEntry {}

export interface DiaryEntryCreatedWsMessage {
  type: typeof WebSocketMessageType.DIARY_ENTRY_CREATED;
  payload: DiaryEntryToCreate;
}

export interface DiaryEntryToUpdate {
  id: number;
  newFoodWeight: number;
  newKcals: number;
  newHistoryEntry: HistoryEntry;
  version: number;
}

export interface DiaryEntryUpdatedWsMessage {
  type: typeof WebSocketMessageType.DIARY_ENTRY_UPDATED;
  payload: DiaryEntryToUpdate;
}

export interface DiaryEntryToDelete {
  deletedDiaryEntryId: number;
}

export interface DiaryEntryDeletedWsMessage {
  type: typeof WebSocketMessageType.DIARY_ENTRY_DELETED;
  payload: DiaryEntryToDelete;
}

export interface DiaryDayToDelete {
  dateISO: string;
}

export interface DiaryEntryToRestore {
  foodCatalogueId: number;
  foodWeight: number;
  history: HistoryEntry[];
}

export interface DiaryEntryToEdit {
  id: number;
  foodCatalogueId: number;
  foodWeight: number;
  historyAction: HistoryEntryAction;
}

export interface DiaryDayRestoreRequest {
  entries: DiaryEntryToRestore[];
}

export interface DeletedDiaryDaySnapshot {
  dateISO: string;
  entries: DiaryEntry[];
}

export interface DiaryDayDeletedWsMessage {
  type: typeof WebSocketMessageType.DIARY_DAY_DELETED;
  payload: DiaryDayToDelete;
}

export interface BodyWeightToUpdate {
  dateISO: string;
  newBodyWeight: number;
}

export interface BodyWeightUpdatedWsMessage {
  type: typeof WebSocketMessageType.BODY_WEIGHT_UPDATED;
  payload: BodyWeightToUpdate;
}

// The part of the catalogue a search covers. Archived is admin-only; All is the history picker's.
export const SearchScope = {
  Active: 'active',
  Archived: 'archived',
  All: 'all',
} as const;

export type SearchScope = (typeof SearchScope)[keyof typeof SearchScope];

export interface SearchQueryWsMessage {
  type: typeof WebSocketMessageType.SEARCH_QUERY;
  query: string;
  scope: SearchScope;
  sequenceNumber: number;
}

export interface SearchResultsWsMessage {
  type: typeof WebSocketMessageType.SEARCH_RESULTS;
  payload: {
    query: string;
    // The scope the server actually applied: an archived request from a non-admin is answered as active.
    scope: SearchScope;
    catalogueIds: number[];
    timestamp: number;
    sequenceNumber: number;
  };
}

export interface CatalogueEntrySavedWsMessage {
  type: typeof WebSocketMessageType.CATALOGUE_ENTRY_SAVED;
  payload: CatalogueEntry;
}

export interface CatalogueEntryDeletedWsMessage {
  type: typeof WebSocketMessageType.CATALOGUE_ENTRY_DELETED;
  payload: {
    catalogueId: number;
  };
}

export interface CatalogueImageGeneratedWsMessage {
  type: typeof WebSocketMessageType.CATALOGUE_IMAGE_GENERATED;
  payload: {
    catalogueId: number;
    imageVersion: number;
  };
}

export interface CatalogueImageFailedWsMessage {
  type: typeof WebSocketMessageType.CATALOGUE_IMAGE_FAILED;
  payload: {
    catalogueId: number;
  };
}

export type MetricsHealthSeverity = 'ok' | 'warn' | 'error';

export interface ServiceHealth {
  service: string;
  severity: MetricsHealthSeverity;
}

export interface MetricsHealthStatus {
  services: ServiceHealth[];
}

export interface MetricsHealthWsMessage {
  type: typeof WebSocketMessageType.METRICS_HEALTH;
  payload: MetricsHealthStatus;
}

export interface ServiceLatest {
  service: string;
  lastBucket: number;
  metrics: Record<string, number>;
}

// Decoded from the METRICS_LATEST binary WS frame (see shared/metrics-wire.ts) —
// no longer a JSON WS message, hence no WebSocketMessageType.METRICS_LATEST
// entry: the frame carries a type-prefix byte instead (network.service.ts's
// MetricsBinaryFrameType), not a JSON "type" field.
export interface MetricsLatestSnapshot {
  services: ServiceLatest[];
}

export type MetricGranularity = 'minute' | 'hour' | 'day';

export const COMPOSITE_SERVICE_KEY = '__composite__';

export interface CompositeMetricDefinition {
  id: string;
  metricName: string;
  serviceA: string;
  serviceB: string;
  treatMissingAsZero?: boolean;
}

export interface MetricPoint {
  service: string;
  name: string;
  granularity: MetricGranularity;
  bucket: number;
  value: number;
}

// A metric never named here is never requested and never seen — there is no
// "whole service" wildcard, by design. See
// megaapp-front/plans/32-metrics-mobile-custom-only-mode.implementation-plan.md §4.1.
export interface MetricsScopeEntry {
  service: string;
  metricNames: string[];
}

export interface MetricsSubscribeWsMessage {
  type: typeof WebSocketMessageType.METRICS_SUBSCRIBE;
  payload: { scope: MetricsScopeEntry[] };
}

export interface MetricsUnsubscribeWsMessage {
  type: typeof WebSocketMessageType.METRICS_UNSUBSCRIBE;
}

//                                                                     TELEMETRY

// Single unified shape for performance/error/log events, queued here and sent to the `telemetry` source of
// the backend's event intake (POST /api/ingest/telemetry, see IngestRequest).
// No discriminant field: the event's kind is read off the `operation` namespace prefix
// (`app.*`/`money.*`/... for performance, `error.*` for errors, `log.*` for structured logs).
export interface TelemetryEvent {
  eventId: string;
  timestampMs: number;
  sessionId: string;
  operation: string;
  elapsedMs?: number;
  renderMs?: number;
  route: string;
  trigger?: string;
  outcome?: 'success' | 'error' | 'cancelled';
  message?: string;
  stack?: string;
  attributes?: Record<string, string | number | boolean>;
  device: {
    platform: 'mobile' | 'tablet' | 'desktop';
    mobileDevice: boolean;
    mobileScreen: boolean;
    viewportWidth: number;
    viewportHeight: number;
    screenWidth: number;
    screenHeight: number;
    dpr: number;
    touchPoints: number;
    hardwareConcurrency?: number;
    deviceMemory?: number;
    connectionType?: string;
    connectionRtt?: number;
    userAgent: string;
  };
}

// The backend's event-intake contract (backend plan 42): the same envelope for every source.
// `id` is stable across retries of the same event (the server does not deduplicate), `stream` is a short
// lowercase label the server can filter by, `at` is Unix milliseconds, `data` is the client's own object.
export interface IngestEvent {
  id: string;
  stream: string;
  at: number;
  data: Record<string, unknown>;
}

export interface IngestRequest {
  events: IngestEvent[];
  // events lost on this side (queue overflow) before this batch
  dropped: number;
}

// 200 means the request was processed; individual events may still be rejected, by index.
export interface IngestResponse {
  received: number;
  stored: number;
  rejected: { index: number; code: string; message: string }[];
}

export interface SettingsUpdatedWsMessage {
  type: typeof WebSocketMessageType.SETTINGS_UPDATED;
  payload: {
    namespace: string;
    fields: Record<string, unknown>;
    // Server write commit time (ms). Two quick PUTs from the same user race their own broadcast
    // goroutines to the socket — this lets the recipient drop one that arrives out of order.
    updatedAt: number;
  };
}

export type IncomingWsMessage =
  | PingWsMessage
  | SyncStatusWsMessage
  | DiaryEntryCreatedWsMessage
  | DiaryEntryUpdatedWsMessage
  | DiaryEntryDeletedWsMessage
  | DiaryDayDeletedWsMessage
  | BodyWeightUpdatedWsMessage
  | MetricsHealthWsMessage
  | SearchResultsWsMessage
  | CatalogueEntrySavedWsMessage
  | CatalogueEntryDeletedWsMessage
  | CatalogueImageGeneratedWsMessage
  | CatalogueImageFailedWsMessage
  | SettingsUpdatedWsMessage;

export type OutgoingWsMessage = SearchQueryWsMessage | MetricsSubscribeWsMessage | MetricsUnsubscribeWsMessage;

//                                                                        SERVER

export interface ServerResponseBasic {
  result: boolean;
}

export interface ServerResponseWithData<T> extends ServerResponseBasic {
  data: T;
}

export interface ServerResponseWithMessage extends ServerResponseBasic {
  message?: string;
}

export interface ServerResponseWithDiaryId extends ServerResponseBasic {
  diaryId: number;
  kcals: number;
  version: number;
  appliedHistoryEntry?: HistoryEntry | null;
}

export interface ServerResponseWithDiaryEntries extends ServerResponseBasic {
  diaryEntries: DiaryEntry[];
}

export interface ServerResponseWithCatalogueEntry extends ServerResponseBasic {
  id?: number;
  name?: string;
  kcals?: number;
}

export interface ProductPreviewData {
  generalizedName: string;
  kcals: number;
  protein: number;
  fat: number;
  carbs: number;
  fiber: number;
  description: string;
  confidence: number;
}

export interface ServerResponseProductPreview extends ServerResponseBasic {
  data: ProductPreviewData;
}

export interface ProductSaveRequest {
  id?: number;
  name: string;
  kcals: number;
  protein: number;
  fat: number;
  carbs: number;
  fiber: number;
  description: string;
  // Sent only by an admin editing an existing product; the server rejects anyone else who sends it.
  archived?: boolean;
}

export interface ServerResponseProductSave extends ServerResponseBasic {
  data: {
    catalogueEntry: CatalogueEntry;
  };
  error?: string;
}

//                                                                      SETTINGS

// Default lightness and saturation (both 0-100) of chart category colors in one theme; a category's
// own values win over these (see categorical-palette.ts).
export interface PaletteTuning {
  lightness: number;
  // Share of the most vivid chroma the screen can show at that lightness and hue.
  saturation: number;
}

export interface UserSettings {
  selectedChapterFood: boolean;
  selectedChapterMoney: boolean;
  // null = the built-in default tuning.
  chartPaletteLight: PaletteTuning | null;
  chartPaletteDark: PaletteTuning | null;
  userName: string;
  isUserAdmin?: boolean; // TODO[068]: Think of a better way to work with admin privileges
}

export const KeyOfUserSettings = {
  selectedChapterFood: 'selectedChapterFood',
  selectedChapterMoney: 'selectedChapterMoney',
  chartPaletteLight: 'chartPaletteLight',
  chartPaletteDark: 'chartPaletteDark',
  userName: 'userName',
  isUserAdmin: 'isUserAdmin',
} as const;

export type KeyOfUserSettings = (typeof KeyOfUserSettings)[keyof typeof KeyOfUserSettings];

export type SettingsChapterNames = 'selectedChapterFood' | 'selectedChapterMoney' | '';

export type LocalStorageSettings = UserSettings | null;

//                                                                       NAVBARS

//                                                                          FOOD

export interface DiaryEntry {
  id: number;
  dateISO: string;
  foodCatalogueId: number;
  foodWeight: number;
  kcals: number;
  history: HistoryEntry[];
  version?: number;
}

export interface DiaryDay {
  ['food']: {
    [id: number]: DiaryEntry;
  };
  ['bodyWeight']: number | null; // TODO[116]: Extract to a separate interface/signal
  ['nutrients']: {
    // TODO[116]: This too? 🤔
    targetKcals: number;
    targetProtein: number;
    targetFat: number;
    targetCarbs: number;
    targetFiber: number;
    consumedKcals: number;
    consumedProtein: number;
    consumedFat: number;
    consumedCarbs: number;
    consumedFiber: number;
  };
}

export interface Diary {
  [dateISO: string]: DiaryDay;
}

export interface DiarySegment {
  start: string;
  end: string;
}

export interface DiaryEntryWithFullData extends DiaryEntry {
  foodName: string;
  isFoodArchived: boolean;
  foodKcals: number;
  foodPercent: string;
  foodKcalPercentageOfDaysNorm: number;
}

export interface DayTotals {
  kcalsConsumed: number;
  kcalsPercent: number;
  bodyWeight: number | null;
  targetKcals: number;
  targetProtein: number;
  targetFat: number;
  targetCarbs: number;
  targetFiber: number;
  consumedProtein: number;
  consumedFat: number;
  consumedCarbs: number;
  consumedFiber: number;
}

export interface UnifiedDiary {
  [dateISO: string]: {
    food: DiaryEntryWithFullData[];
    totals: DayTotals;
  };
}

export const HistoryEntryAction = {
  INIT: 'init',
  SET: 'set',
  ADD: 'add',
  SUBTRACT: 'subtract',
} as const;

export type HistoryEntryAction = (typeof HistoryEntryAction)[keyof typeof HistoryEntryAction];

export interface HistoryEntry {
  action: HistoryEntryAction;
  value: number;
}

export type CatalogueId = number;

export interface CatalogueEntry {
  id: number;
  name: string;
  legacyName?: string;
  kcals: number;
  protein: number;
  fat: number;
  carbs: number;
  fiber: number;
  description: string;
  // Absent in a catalogue cached before the archive feature — treated as not archived.
  archived?: boolean;
  imageVersion?: number;
  canDelete?: boolean;
}

export interface Catalogue {
  [id: number]: CatalogueEntry;
}

// GET /api/food/catalogue response — version is a cheap "did anything change" signal for
// reconnect catch-up, checked without downloading the whole catalogue (GET /api/food/catalogue/version).
export interface CatalogueListResponse {
  version: number;
  entries: Catalogue;
}

export interface CatalogueVersionResponse {
  version: number;
}

export interface PersonalKcals {
  [id: number]: number;
}

export interface NutrientDelta {
  protein: number;
  fat: number;
  carbs: number;
  fiber: number;
}

export interface BodyWeightInterface {
  bodyWeight: string;
  dateISO: string;
}

//                                                                         STATS

export interface DayStats {
  weight: number;
  weightAvg: number;
  consumedKcal: number;
  targetKcal: number;
  hasNoData: boolean;
}

export interface Stats {
  [id: string]: DayStats;
}

export interface FoodStatsTopProduct {
  catalogueId: number;
  name: string;
  kcal: number;
  weight: number;
}

export interface FoodStatsWeightRecord {
  weight: number;
  dateISO: string;
}

export interface FoodStatsCaloricDayRecord {
  percent: number;
  dateISO: string;
}

export interface FoodStatsYearAgo {
  dateISO: string;
  weightThen: number;
  weightNow: number;
  deltaKg: number;
}

// All-time aggregates computed server-side over the full account history — unlike `days`, never
// trimmed to the default recent window (see backend StatsSummary / plan 28 "Находки в
// эксплуатации"), so it's correct in every /api/food/stats response regardless of the requested
// window.
export interface FoodStatsSummary {
  daysInDiary: number;
  minWeight: FoodStatsWeightRecord | null;
  maxWeight: FoodStatsWeightRecord | null;
  mostCaloricDay: FoodStatsCaloricDayRecord | null;
  leastCaloricDay: FoodStatsCaloricDayRecord | null;
  weightChangeSinceStartKg: number | null;
  yearAgo: FoodStatsYearAgo | null;
}

export interface FoodStatsResponse {
  days: Stats;
  summary?: FoodStatsSummary;
  topProductsByKcal: FoodStatsTopProduct[];
  topProductsByWeight: FoodStatsTopProduct[];
  topProductsWindowTotalKcal: number;
  topProductsWindowTotalWeight: number;
  totalEntries: number;
}

export interface ProductHistoryEntry {
  dateISO: string;
  foodCatalogueId: number;
  foodWeight: number;
  kcal: number;
  percentOfNorm: number;
}

// Per-day numeric series of the food stats charts. The list is the single source of truth for the
// series the generic slicing/aggregation in stats-chart-data.ts walks, so a new series is one
// entry here (plus the code that fills and draws it) and never a new copy of the aggregation.
// kcalsSelected is the part of kcalsFactual that comes from the products tracked in the product history.
export const STATS_CHART_SERIES = ['weights', 'weightsAvg', 'kcalsFactual', 'kcalsSelected', 'kcalsTarget'] as const;

export type StatsChartSeries = (typeof STATS_CHART_SERIES)[number];

export type StatsChartData = Record<StatsChartSeries, number[]> & {
  dates: string[];
  hasNoData: boolean[];
};

//                                                                         MONEY

export const SymbolPosition = {
  BEFORE: 'before',
  AFTER: 'after',
} as const;

export type SymbolPosition = (typeof SymbolPosition)[keyof typeof SymbolPosition];

export interface Currency {
  id?: number;
  title: string;
  ticker: string;
  symbol: string;
  symbolPosEnum: SymbolPosition;
  whitespace: boolean;
}

export const CategoryType = {
  INCOME: 'income',
  EXPENSE: 'expense',
} as const;

export type CategoryType = (typeof CategoryType)[keyof typeof CategoryType];

export interface Category {
  id?: number;
  name: string;
  parentId?: number | null;
  categoryType: CategoryType;
  // Chart-related properties. Optional only because a snapshot cached before they existed lacks
  // them (read as: shown on charts, automatic color).
  hiddenOnCharts?: boolean;
  // Chart color: hue 0-360, lightness and saturation 0-100. null = automatic (hue) or the user's
  // palette default (lightness, saturation).
  hue?: number | null;
  lightness?: number | null;
  saturation?: number | null;
}

export const AccountKind = {
  CASH: 'cash',
  CARD: 'card',
  CHECKING: 'checking',
  DEPOSIT: 'deposit',
  BROKERAGE: 'brokerage',
  CRYPTO: 'crypto',
} as const;

export type AccountKind = (typeof AccountKind)[keyof typeof AccountKind];

export interface Organization {
  id?: number;
  title: string;
  logoBase64?: string | null;
}

export interface Account {
  id?: number;
  title: string;
  currencyId: number;
  isInvest: boolean;
  isArchived: boolean;
  kind: AccountKind;
  organizationId?: number | null;
}

export const AssetType = {
  STOCK: 'stock',
  BOND: 'bond',
  CRYPTO: 'crypto',
} as const;

export type AssetType = (typeof AssetType)[keyof typeof AssetType];

export interface Asset {
  id?: number;
  title: string;
  ticker: string;
  type: AssetType;
  accountIds: number[];
  suspendedSince?: string | null;
  suspendedUntil?: string | null;
}

export const TransactionKind = {
  INCOME: 'income',
  EXPENSE: 'expense',
  TRANSFER: 'transfer',
  INVEST_BUY: 'invest_buy',
  INVEST_SELL: 'invest_sell',
  INVEST_DIVIDEND: 'invest_dividend',
} as const;

export type TransactionKind = (typeof TransactionKind)[keyof typeof TransactionKind];

export interface Transaction {
  id?: number;
  dateISO: string;
  accountId: number;
  amount: number;
  categoryId?: number | null;
  kind: TransactionKind;
  isGift: boolean;
  notes?: string;
  detailsJSON?: any;
  twinId?: number | null;
  version?: number;
}

export interface MoneyRateHistory {
  id?: number;
  dateISO: string;
  ratesJson: Record<string, number> | string;
}

export interface BalanceChartAccountSeries {
  accountId: number;
  accountTitle: string;
  values: number[];
  suspendedValues: number[];
  isSuspended: boolean;
}

export interface BalanceChartData {
  dates: string[];
  totals: number[];
  accountSeries: BalanceChartAccountSeries[];
}

export interface IncomeChartCategorySeries {
  // Series id: a category id, or a negative virtual series id (see money-series.ts).
  categoryId: number;
  categoryName: string;
  values: number[];
}

export interface DividendRow {
  dateISO: string;
  amount: number;
}

export interface IncomeChartData {
  months: string[];
  categorySeries: IncomeChartCategorySeries[];
}

export interface ExpenseCategory {
  id: number;
  name: string;
}

export interface ExpenseRow {
  period: string;
  categoryAmounts: Record<number, number>;
  total: number;
  uncategorizedAmount: number;
}

export interface ExpenseChartData {
  categories: ExpenseCategory[];
  monthRows: ExpenseRow[];
}

// One chart series' part of the whole (0-1), used to size its color in the category form preview.
export interface SeriesShare {
  id: number;
  name: string;
  share: number;
}

// export interface Notification {
//   id: number;
//   message: string;
//   bgColour: string;
//   textColour: string;
//   borderColour: string;
//   time: number;
// }

// export interface Transaction {
//   id: number;
//   date: string;
//   amount: number;
//   account_id: number;
//   category_id: number;
//   kind: string;
//   is_gift: boolean;
//   notes: string | null;
//   twin_transaction_id: number | null;
//   target_account_id: number | null;
//   target_account_amount: number | null;
// }

// export interface DateTimeFormatOptions {
//   weekday?: 'long' | 'short' | 'narrow';
//   month?: 'numeric' | '2-digit' | 'long' | 'short' | 'narrow';
//   day?: 'numeric' | '2-digit';
// }

//                                                                            UI

export interface CapturedPhoto {
  file: File;
  dataUrl: string;
}

// export interface InputWithProgressSubmitData {
//   value: string;
//   resolve: () => void;
//   reject: () => void;
// }
