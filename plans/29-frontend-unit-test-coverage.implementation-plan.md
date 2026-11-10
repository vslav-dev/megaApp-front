# Юнит-тесты фронта: покрытие логики, которая может тихо сломаться

## Что делаем и зачем

На фронте — 0 тестов, при этом раннер настроен на устаревший Karma (см. «Раннер» ниже). Бэк тестами покрыт, фронт — нет. Цель не «покрыть всё», а закрыть код, где регресс не будет замечен глазами: чистые вычисления, агрегации, форматирование, ретраи. Компоненты и UI-kit — сознательно вне охвата (см. «Не входит»).

Критерий отбора файла: (а) в нём реальная логика/ветвления/арифметика, не текстовый шаблон, и (б) баг в нём не проявится визуально сразу — типичный тихий регресс.

## Раннер: Karma → Vitest (сделать до написания тестов)

Angular официально переводит тестирование на Vitest: начиная с Angular 21 (наша версия — `21.1.0`) Vitest — дефолтный раннер для новых проектов, Karma помечен deprecated командой Angular. Источники: [angular.dev — Migrating from Karma to Vitest](https://angular.dev/guide/testing/migrating-to-vitest), [Vitest: The New Default Testing Solution in Angular](https://devm.io/angular/vitest-the-new-default-testing-solution-in-angular).

Наш `angular.json` сейчас (`architect.test.builder`) — `@angular/build:karma`. Раз `*.spec.ts` файлов ещё 0 — конвертировать нечего, миграция раннера бесплатна и без риска. Писать сейчас на Karma и переносить позже — двойная работа.

**Проверено по факту в проекте** (не только по документации):
- `karma.conf.js` и `src/test.ts` — в проекте не существуют физически: билдер `@angular/build:karma` — современный, config-free, файлы не нужны. Удалять нечего.
- `angular.json` → `architect.build.configurations` называются `dev`/`test`/`prod`, а не `development`. `@angular/build:unit-test` по умолчанию резолвит `buildTarget` как `::development` (буквально имя конфигурации `development`) — с нашими именами это молча не найдёт конфиг. **Обязательно явно прописать `"buildTarget": "megaapp:build:dev"`** в тест-таргете — по аналогии с тем, как это уже сделано в `architect.serve.configurations.dev.buildTarget`.
- `@angular/build:unit-test` **не принимает** `polyfills`/`assets`/`styles`/`inlineStyleLanguage` внутри самого тест-таргета (в отличие от старого `@angular/build:karma`) — он полностью наследует их из указанного `buildTarget` (т.е. из `architect.build.configurations.dev`, где Tailwind/SCSS уже настроены). Задавать их повторно в тест-таргете — ошибка конфигурации, не подстраховка.
- `tsconfig.spec.json` сейчас: `"types": ["jasmine"]`. Меняем на `"types": ["vitest/globals"]` — так `describe`/`it`/`expect` доступны глобально без импорта. `@types/jasmine` из зависимостей убираем вместе с самим `jasmine-core`.

Что меняется в конфиге:
- `angular.json`: `architect.test.builder` → `@angular/build:unit-test`, `architect.test.options.buildTarget` → `megaapp:build:dev`.
- `package.json`: убрать `karma`, `karma-chrome-launcher`, `karma-coverage`, `karma-jasmine`, `karma-jasmine-html-reporter`, `jasmine-core`, `@types/jasmine`; добавить `vitest`, `jsdom`, `@vitest/coverage-v8` (замена `karma-coverage`, если coverage-отчёт нужен).
- `tsconfig.spec.json`: `types` → `["vitest/globals"]`.

Как писать тесты, чтобы не переписывать их через полгода:
- Синтаксис `describe`/`it`/`expect` (BDD) — общий с Jasmine, писать как обычно, отдельного обучения не требует.
- Моки/шпионы — **это Vitest, а не Jasmine**, даже если по виду похоже: `vi.fn()` вместо `jasmine.createSpy`, `vi.spyOn()` вместо `spyOn()`, `expect.objectContaining`/`expect.any` вместо `jasmine.objectContaining`/`jasmine.any`.
- HTTP-моки — через актуальный функциональный API: `provideHttpClientTesting()` + `HttpTestingController` из `@angular/common/http/testing`. Старый `HttpClientTestingModule` — deprecated, в план не берём даже для скорости.
- **Таймеры — ключевая ловушка.** `fakeAsync`/`tick()`/`waitForAsync` в Vitest-раннере не работают «из коробки»: раннер не оборачивает тест в Angular test zone, без патча `zone.js/plugins/vitest-patch` в полифиллах падает с `ProxyZone`-ошибкой, и сама Angular-команда рекомендует не тянуть этот патч, а сразу писать тесты на нативный `async`/`await` + `vi.useFakeTimers()`/`vi.advanceTimersByTimeAsync()`. Везде ниже, где встречается `setTimeout`/`setInterval` — только так, `fakeAsync` не используем вообще.
- Официальный конвертер `ng g @schematics/angular:refactor-jasmine-vitest` существует, но переписывает уже существующие `*.spec.ts` с Jasmine-паттернов на Vitest — у нас 0 файлов для конвертации, схематик не нужен, просто пишем сразу на Vitest-API.
- Статус миграции у самого Angular — экспериментальный (без semver-гарантий на билдер), но откатывать назад через полгода-год не придётся: мы не мигрируем существующие тесты туда-обратно, а стартуем сразу на нём с нуля.

## Текущая реализация (обзор)

- `angular.json`/`package.json` — тестовый раннер настроен на устаревший Karma, `ng test` работает, но не на том стеке, который дальше будет поддерживаться (см. «Раннер» выше).
- `*.spec.ts` в проекте — отсутствуют полностью.
- Логика фронта живёт в основном в `shared/*.ts` (чистые функции, без Angular) и `services/*.service.ts` (Angular-сервисы на signals — часть только деривует данные из чужих сигналов, часть управляет side-effects: HTTP/WS/localStorage/таймеры).
- Компоненты (`components/**`) — в подавляющем большинстве тонкий слой над сервисами (форма → вызов сервиса, шаблон → сигнал), логики внутри почти нет.

## Как классифицируем файлы и как их тестировать

Ось классификации — не «нужен ли TestBed» (Angular-сервису он нужен всегда, это не показатель сложности сам по себе), а **что за объект тестируем и что тест обязан доказать**:

- **Группа A — чистые функции.** Не `@Injectable`, не используют `inject()`. Вызываем напрямую, без Angular вообще, без TestBed.
- **Группа B — Angular-сервисы, деривация данных.** Берут сигналы других сервисов и детерминированно вычисляют производный результат (график, агрегат, статус). Весь смысл файла — в этом вычислении, поэтому его стоит покрыть исчерпывающе, табличными тестами (та же конвенция, что и в бэкенд `go test`).
- **Группа C — Angular-сервисы, стейтфул-оркестрация.** Управляют side-effects: HTTP-запросы, ретраи, таймеры, персистентная очередь, localStorage. Полное покрытие файла не имеет смысла (там нет одной чистой функции «вход → выход») — покрываем точечно: конкретные ветвления, где легко ошибиться (граница ретрая, идемпотентность, дебаунс).

**Единое правило для Групп B и C — TestBed нужен, но остаётся дешёвым:**
Angular-сервисы в этом проекте активно используют `inject()` как field initializer (а не только в конструкторе), поэтому `new Service()` вне DI-контекста гарантированно упадёт с `NG0203`. Решение — не «избегать TestBed», а **всегда мокать прямые зависимости на уровне DI-провайдера** (`TestBed.configureTestingModule({ providers: [{ provide: X, useValue: fakeX }] })`), и никогда не давать TestBed конструировать реальную транзитивную цепочку. Тогда стоимость теста определяется числом *прямых* зависимостей сервиса (обычно 1-4), а не глубиной графа за ними — не важно, что прячется на 3 уровня глубже.

Конкретно это важно для `PerformanceMetricsService` и `AuthService` — оба сами по себе тяжёлые (`PerformanceMetricsService` инжектирует `Router`/`DeviceInfoService`/`LocalStorageService`/`NetworkService`, заводит `effect()` и таймеры прямо в конструкторе; `AuthService` инжектирует `NetworkService`/`HttpClient`/`Router`/`SyncEngineService`/`NotificationService`/`IndexedDbCacheService`) и фигурируют как прямая зависимость сразу в нескольких файлах Группы B/C ниже. Их **всегда мокаем через DI-провайдер**, никогда не позволяем создаться по-настоящему — тогда их собственные тяжёлые зависимости тест вообще не касаются. Для `PerformanceMetricsService` достаточно одного переиспользуемого лёгкого фейка (`measure` вызывает переданную функцию вычисления и возвращает её результат, `record`/`recordAfterPaint` — no-op) — общего на все тесты Групп B/C, где он встречается.

Итог: тесты Группы B и C тестируем через `TestBed.inject()`, а не `new Service()`, и мокаем ровно прямых соседей по конструктору/`inject()` — не больше и не меньше. Проверяем поведение только через публичный API сервиса (публичные сигналы, публичные методы) — не лезем в приватные методы через `(service as any)`: приватная реализация может рефакториться, а тест не должен от неё зависеть.

## Группа A — чистые функции

- `shared/money-utils.ts` — `convertAmount`: кросс-курс через USD, нулевые/отсутствующие rates, `fromTicker === toTicker`.
- `shared/utils.ts` — `isoDaysBefore`, `dateToIsoNoTimeNoTZ`, `epochToIsoNoTimeNoTZ`, `calcDateWithUserTimeShift`, `fitColumnsToWidth`, `getRuDeclension`, `isDeepEqual`, `splitNumber`, `divideNumberWithWhitespaces`.
- `shared/food-day-band.ts` — `resolveFoodDayBand`: граничные значения порогов (49/50%, 101/102%, 124/125%).
- `shared/metrics-aggregation.ts` — `aggregateMetricValues`: avg/max/sum/last, округление для целочисленных метрик.
- `shared/metric-units.ts` — `formatMetricUnitValue` и приватные форматтеры bytes/duration/money.
- `shared/categorical-palette.ts` — `circularHueDistance`, `isStatusExcluded`, детерминированность `createCategoricalPalette()` (один и тот же `key` всегда даёт один и тот же hue).
- `ui-kit/components/v-input/validators.ts` — `rangeValidator`, `weightValidator`.
- `shared/decorators/*.ts` (`cached-request`, `exhaust-request`, `throttled`) — расшаренная инфраструктура: баг здесь бьёт по всем сервисам, которые их используют, сразу.

## Группа B — Angular-сервисы: деривация данных

- `services/money-compute.service.ts` — самый рискованный файл фронта: помесячные бакеты (`buildBuckets`), FIFO-матчинг лотов покупки/продажи (`buildPositionLotRows`), сборка данных для графиков баланса/дохода/расхода. Прямые зависимости — `MoneyService` (мок сигналов `transactions$$`/`accounts$$`/`currencies$$`/`categories$$`/`assets$$`/`displayCurrency$$`/`investAssetTrades$$` и метода `getRatesForDate()`) и `PerformanceMetricsService` (общий фейк, см. выше). Проверяем через публичные `balanceChartData$$`/`incomeChartData$$`/`expenseChartData$$`.
- `services/food/food-stats.service.ts` — агрегация день/неделя/месяц (`prepareAggregatedData`), бинарный поиск среза диапазона, расчёт видимого окна (`getClipRange`, `resolveGranularity`). Прямые зависимости — `HttpClient`, `LocalStorageService`, `NetworkService`, `SyncEngineService` (конструктор) плюс `FoodSettingsService`, `FoodDiaryService`, `AuthService`, `PerformanceMetricsService` (`inject()`) — все мокаются на уровне провайдера. Данные в приватный `stats$$` попадают только через конструктор (`loadStatsFromLocalStorageOnInit()` читает `LocalStorageService` синхронно) — мокаем `LocalStorageService`, чтобы отдать заранее заданный `FoodStatsResponse`, дальше окно двигаем через публичные `selectedDateIdxStart$$`/`selectedDateIdxEnd$$` и проверяем `statsChartDataClipped$$`/`getClipRange`. HTTP/`getStats()` в этих тестах не участвует — не нужен для проверки чистой агрегации. Конструктор также заводит `effect()` (сброс состояния при потере сессии) — не мешает целевым тестам, т.к. `AuthService` замокан и не эмитит `Guest` без явной команды теста.
- `services/food/food-stats-insights.service.ts` — стрик (`current`/`record`), доля топ-продуктов. Единственная прямая зависимость — `FoodStatsService`, которую здесь не поднимаем реальной (см. выше — она сама тяжёлая), а подменяем лёгким фейком с ровно теми сигналами, что нужны инсайтам: `statsChartData$$`, `topProductsByKcal$$`/`topProductsByWeight$$`, `topProductsWindowTotalKcal$$`/`topProductsWindowTotalWeight$$`, `summary$$`, `totalEntries$$`. Проверяем через публичные `streak$$`, `topProductsByKcalWithShare$$`/`topProductsByWeightWithShare$$`, `milestones$$`.
- `services/metrics-health.service.ts` — резолв ok/warn/error по возрасту данных и порогам. Прямые зависимости — `NetworkService` (мок `wsMessages$` как управляемый `Subject`) и `MetricsSettingsService` (мок порогов). Конструктор заводит `setInterval` на 30 секунд (тик `now$$`) — в тестах используем `vi.useFakeTimers()`/`vi.advanceTimersByTimeAsync()`, никогда `fakeAsync`. Проверяем через публичные `services$$`/`overallSeverity$$`.

## Группа C — Angular-сервисы: стейтфул-оркестрация

Не весь файл целиком — только ветвления, где легко ошибиться. HTTP — через `provideHttpClientTesting()` + `HttpTestingController`, таймеры — только через `vi.useFakeTimers()`.

- `services/sync-engine.service.ts` — какие HTTP-статусы ретраятся, а какие терминальны (`isRetryable`/`normalizeSyncError`), ретрай-бэкофф (`sleep`, `1000 * retryCount`), персистентность незавершённой операции через `LocalStorageService` и её восстановление после релоада.
- `services/auth.service.ts` — переходы `sessionState$$` (Unknown → Authenticated/Guest), идемпотентность `invalidateSession()` (двойной вызов не должен дублировать сайд-эффекты), `scheduleRenewal` (клиппинг отрицательного delay в 0).
- `services/metrics.service.ts` — дедупликация точек (`pointKey`/`insertPoint`), merge истории (`mergeHistories`), pruning (`prunePoints`).
- `services/settings/namespace-settings-store.ts` + `services/settings/persisted-signal.ts` — pending/rollback механика (`set`/`flushPendingSet`, дебаунс через `pendingFlushTimer`), привязка перечитывания к `sessionGeneration$$` (не должно триггериться повторно на renewal, должно — на новый логин после logout).

## Не входит (сознательно)

- **Компоненты** (`components/**`) — тонкий слой над уже покрытыми сервисами. Angular TestBed + DOM-рендер — дорого, ловит мало нового сверх Групп A-C.
- **UI-kit визуальные компоненты** (`v-button`, `v-card`, `v-toggle`, `v-modal` и т.п.) — презентационные, ломаются визуально, юнит-тест не поймает.
- **`shared/chart-config.ts`** — почти целиком билдеры конфигов Chart.js (структуры данных, не логика). Исключение — `rgbToRgba`/`formatMonthYearLabel`, можно докинуть в Группу A при случае, не приоритет.
- **`services/network.service.ts`** — не разобран в деталях в рамках анализа; при следующем проходе проверить reconnect-логику на предмет включения в Группу B/C.
- **UI-kit wheel-компоненты** (`v-wheel-input`, `v-wheel-select`, `v-date-wheel-input`) — не разобраны; если планируется трогать их логику руками — оценить отдельно перед рефакторингом, вслепую в этот план не включаю.

## Область охвата

Файлы Групп A, B, C выше. Ничего в `components/**` и `ui-kit/components/**` (кроме `validators.ts`, который не компонент).

## Чеклист

**Раннер (сделать первым):**
- ✅ `angular.json`: `architect.test.builder` → `@angular/build:unit-test`, явно прописан `architect.test.options.buildTarget` → `megaapp:build:dev` (дефолтный `::development` не резолвится — наша конфигурация называется `dev`). Дополнительно пришлось сузить `include` до `["**/*.spec.ts"]` — дефолтный glob Vitest (`**/*.spec.ts` + `**/*.test.ts`) подхватывал `src/environments/environment.test.ts` (файл окружения для конфигурации `test`, не тест) как пустой test-suite и падал.
- ✅ `package.json`: `karma`/`karma-chrome-launcher`/`karma-coverage`/`karma-jasmine`/`karma-jasmine-html-reporter`/`jasmine-core`/`@types/jasmine` удалены; `vitest`/`jsdom`/`@vitest/coverage-v8` добавлены (версия `^4.0.8` — `@angular/build@21.1.0` требует именно `vitest ^4.0.8` через peer dependency, не `^3.x`).
- ✅ `tsconfig.spec.json`: `types` → `["vitest/globals"]` (было `["jasmine"]`).
- ✅ `ng test` запускается и зелёный (98 тестов, Tailwind/SCSS из `build:dev` подхватываются, раннер работает).

**Группа A (чистые функции):**
- ✅ `shared/money-utils.ts` — `convertAmount`
- ✅ `shared/utils.ts` — набор утилит
- ✅ `shared/food-day-band.ts` — `resolveFoodDayBand`
- ✅ `shared/metrics-aggregation.ts` — `aggregateMetricValues`
- ✅ `shared/metric-units.ts` — `formatMetricUnitValue`
- ✅ `shared/categorical-palette.ts` — hue-функции (через публичный `createCategoricalPalette()`, `isStatusExcluded`/`circularHueDistance` не экспортированы — проверены косвенно по наблюдаемому поведению)
- ✅ `ui-kit/components/v-input/validators.ts` — валидаторы
- ✅ `shared/decorators/*.ts` — три декоратора (обнаружено: `cache`/`lastCall` живут в замыкании дескриптора, общем на все инстансы класса — учтено в тестах объявлением класса внутри каждого `it`)

**Группа B (Angular-сервисы, деривация данных, TestBed + мок прямых зависимостей):**
- ✅ Общий лёгкий фейк `PerformanceMetricsService` — `src/app/testing/performance-metrics.fake.ts`, переиспользован во всех тестах группы.
- ✅ `services/money-compute.service.ts` — бакеты, FIFO-лоты, три графика
- ✅ `services/food/food-stats.service.ts` — агрегация/срез/окно, данные — через мок `LocalStorageService`
- ✅ `services/food/food-stats-insights.service.ts` — стрик, доли топ-продуктов, `FoodStatsService` — через лёгкий фейк с нужными сигналами
- ✅ `services/metrics-health.service.ts` — резолв severity, таймер тика — через `vi.useFakeTimers()`

**Группа C (Angular-сервисы, стейтфул-оркестрация, точечное покрытие):**
- ✅ `services/sync-engine.service.ts` — ретраи/очередь/персистентность, HTTP — через `provideHttpClientTesting()`, таймеры — через `vi.useFakeTimers()`
- ✅ `services/auth.service.ts` — переходы состояния сессии
- ✅ `services/metrics.service.ts` — дедуп/merge/pruning точек
- ✅ `services/settings/namespace-settings-store.ts` + `persisted-signal.ts` — pending/rollback, sessionGeneration (проверено через `TestBed.runInInjectionContext()` — обе конструкции не `@Injectable`, вызывают `inject()`/`effect()` напрямую)

**Общее:**
- ✅ `ng test` зелёный: 19 файлов, 159 тестов.
- ✅ `ng build --configuration dev` зелёный (конфиг тест-раннера не задел прод-сборку).
- ⭕ `services/network.service.ts` — отдельно оценить на предмет добавления в план (не входит в текущий охват).
