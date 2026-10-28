# Metrics Dashboard — Implementation Plan (Frontend)

Frontend-часть единого плана [`METRICS._implementation-plan.md`](../../METRICS._implementation-plan.md) в корне проекта — туда читать общую архитектуру и контракты. Здесь — конкретно по коду `megaapp-front`.

## Как сейчас

- `src/app/services/network.service.ts` — WebSocket-клиент: подключение к `/api/ws` с токеном в URL, reconnect с backoff, входящие сообщения текут через `wsMessages$: Subject<IncomingWsMessage>`.
- `src/app/services/food/food-diary.service.ts` (`subscribeToRealtimeUpdates`, ~строка 928) — эталонный паттерн подписки: `switch` по `WebSocketMessageType`, type-guard на payload, отдельный handler-метод на каждый тип. `SYNC_STATUS` (`userDataLastModifiedTs`) — уже существующий курсорный механизм, на него и ориентироваться для метрик.
- Графики: `chart.js` v4.4.1, готовые конфиги в `src/app/shared/chart-config.ts` (weight/kcals/balance/income/expense), эталонный компонент-потребитель — `src/app/components/money/balances-chart/balances-chart.ts`.
- Локальный кэш: `src/app/services/local-storage.service.ts` + `cache.ts` (`buildCacheKey` с версией схемы, `purgeStaleCacheVersions`), `food-base.service.ts` оборачивает это в `saveToLocalStorage`/`loadFromLocalStorage`. Это и есть готовая инфраструктура для скользящего окна, отдельный механизм кэширования не нужен.
- Админ: `UserSettings.isUserAdmin?: boolean` (`types.ts:239`) — поле есть в типах с TODO-комментарием, но не приходит реально с бэка (бэк его не отдаёт, см. backend-план) и не используется ни в одном guard/`@if`. По факту — заглушка без эффекта.
- `AuthService` (`auth.service.ts`) — единственное место, владеющее identity/session: `sessionState$$`/`isAuthenticated$$` сигналы, токены в `localStorage`. `bootstrap()` (вызывается через `ensureBootstrapped()` на старте приложения, до отрисовки основного UI) дёргает `GET /api/auth/verify`, но **полностью игнорирует тело ответа** — ждёт только успешный статус. `login()` читает тело `AuthResponse` (`accessToken`/`refreshToken`), `refreshToken()` аналогично. Бэк на `/api/auth/verify` уже отдаёт `{authenticated, userId, username}` в JSON (`internal/auth/http.go`), просто фронт это не читает.

## Как должно быть

Два независимых канала с разным жизненным циклом (см. backend-план, Этап 2) — фронт зеркалит это двумя независимыми сервисами, не одним:

- **Health (всегда активен для админа, лёгкий)**:
  - Новый входящий тип `WebSocketMessageType.METRICS_HEALTH` в `types.ts`.
  - `metrics-health.service.ts`: подписка на `networkService.wsMessages$` сразу при создании сервиса (по факту — на весь сеанс, как только пользователь залогинен как админ), хранение последнего статуса (ok/warn/error) в сигнале. Никакой подписки/отписки не требует — сервер сам решает слать или нет, основываясь на `isAdmin`.
  - Компонент-виджет в сайдбаре (зелёная/жёлтая/красная точка), читает сигнал из `metrics-health.service.ts`, виден везде, не зависит от текущей страницы.
- **Detail (по подписке на странице дашборда, тяжёлый)**:
  - Новые типы: входящий `METRICS_UPDATE`, исходящие `METRICS_SUBSCRIBE` (несёт курсор — timestamp последнего полученного bucket) / `METRICS_UNSUBSCRIBE`.
  - `metrics.service.ts` по образцу `food-diary.service.ts`: обработка `METRICS_UPDATE`, хранение state в сигнале.
  - Подписка отправляется через существующий `networkService.sendMessage(...)` при входе на страницу дашборда (`ngOnInit`/инициализация компонента) и отзывается (`METRICS_UNSUBSCRIBE`) при выходе со страницы (`ngOnDestroy`).
  - Переподписка при реконнекте: подписаться на переход `networkService.isConnected$$` в `true` (через `effect`/`toObservable`) и, если страница дашборда всё ещё открыта, повторно отправить `METRICS_SUBSCRIBE` с тем же курсором — отдельный таймер "подтверди интерес" не нужен (см. backend-план: эта проверка живости уже целиком на стороне `ws.Hub`).
  - Кэш — скользящее окно 24–48ч одним JSON-блобом через уже существующий `LocalStorageService`/`cache.ts` (та же версионируемая `buildCacheKey`), полная перезапись при каждом обновлении. Глубже история — обычный HTTP-запрос диапазона.
  - Графики — новые записи в `chart-config.ts` по аналогии с `balance`/`income`, новый компонент-дашборд по образцу `balances-chart.ts`.
- **Доступ известен заранее, ещё до открытия страницы метрик** — без новой инфраструктуры, на базе уже существующего `AuthService`:
  - Новый сигнал `isAdmin$$` прямо на `AuthService`, рядом с `sessionState$$`/`isAuthenticated$$` — отдельный сервис под одно поле не нужен.
  - `bootstrap()` начинает читать тело ответа `/api/auth/verify` (сейчас оно игнорируется) и выставлять `isAdmin$$` из поля `isAdmin`. Раз `ensureBootstrapped()` уже awaitится на старте приложения до рендера основного UI — `isAdmin$$` гарантированно известен раньше, чем отрисуется хоть один компонент, в том числе кнопка метрик. Это и закрывает требование "знать заранее, до всяких запросов".
  - `login()`/`refreshToken()` — `AuthResponse` (`types.ts`) получает новое поле `isAdmin: boolean`, оба места тоже проставляют `isAdmin$$` сразу по ответу, не дожидаясь отдельного `verify`.
  - `terminateSession()` сбрасывает `isAdmin$$` в `false` вместе с остальным сессионным state.
  - Использование — `@if (authService.isAdmin$$())` в сайдбар-виджете и в пункте меню/роуте дашборда. Без отдельной route-guard инфраструктуры, текущий масштаб задачи (один булевый флаг) её не требует.
- **Сознательно не делаем через cookies (в т.ч. httpOnly).** Любой флаг, который JS использует для решения "что рисовать", по определению читаем тем же JS — значит, спуфится в любом хранилище (переменная/сигнал/localStorage/обычная кука) одинаково легко через консоль браузера, это не специфика конкретного хранилища. `httpOnly`-кука нечитаема из JS вообще, а значит не может использоваться для рендер-решения — противоречие. Защита от спуфинга `isUserAdmin` на фронте и не нужна: реальная защита данных — на бэке (рассылка по known admin userID, см. выше), спуфинг флага на фронте даёт максимум пустой дашборд в своём же аккаунте, чужих данных не открывает. Это стандартный паттерн (GitHub/GitLab/AWS console): флаг с бэка → `@if` для UI, проверка прав — на каждом запросе на сервере.

## Отклонения от плана, найденные в процессе реализации

- **Route guard инфраструктура уже существует** (`auth.guard.ts`, `is-chapter-selected.guard.ts`) — раннее "без отдельной route-guard инфраструктуры" было неверно: это уже идиоматичный паттерн в проекте (`CanActivateFn`), не лишняя сложность. Добавлен `admin-only.guard.ts` по тому же образцу, маршрут `/metrics` гейтится через `[authGuard, settingsReadyGuard, adminOnlyGuard]`.
- Кнопка "Метрики" добавлена в `NavigationService.buttons` (новое поле `adminOnly?: boolean`, отфильтровывается в `prepButtons` по `authService.isAdmin$$()`) — обычный пункт меню, а не отдельная плитка.
- Health-виджет вставлен только в десктопный сайдбар (`navigation.html`, рядом с кнопкой свёртывания), не в мобильное меню — мобильный вариант не реализован в этой итерации, чисто по нехватке отдельного подходящего места в текущей мобильной раскладке.

### Найденный и исправленный баг: гонка между гвардами на hard refresh

После деплоя `/metrics` при обычной SPA-навигации (клик по кнопке) открывался нормально, но при обновлении страницы (`F5`) на `/metrics` пользователя кидало на `/food`.

Причина — расставленные по запросу пользователя `console.log` в `authGuard`/`settingsReadyGuard`/`adminOnlyGuard`/`rootRedirectGuard`/`AuthService.bootstrap()` показали: Angular Router **не гарантирует строго последовательное ожидание** гвардов из массива `canActivate` — `adminOnlyGuard` (синхронный, без `await`) выполнялся параллельно с асинхронным `authGuard`, а не после его завершения, и читал `isAdmin$$()` ещё до того, как `ensureBootstrapped()` (и соответственно `/api/auth/verify`) успевал отработать. На обычной навигации бага не было только потому, что `ensureBootstrapped()` к этому моменту уже был выполнен раньше (на предыдущей загрузке `/food`) — гонка маскировалась.

Исправлено: `admin-only.guard.ts` теперь сам `await authService.ensureBootstrapped()` перед проверкой `isAdmin$$()`, как и `authGuard` — не полагается на порядок выполнения соседних гвардов в массиве.

Все диагностические `console.log`/`log.Printf`, добавленные на время поиска бага (фронт и бэк), убраны после фикса.

### Этап 2: Доставка на фронт — ✅ готово
- ✅ `isAdmin: boolean` в `AuthResponse`/`VerifyResponse` (`types.ts`), `isAdmin$$` сигнал на `AuthService`.
- ✅ `bootstrap()` читает тело `/api/auth/verify` и проставляет `isAdmin$$`; `login()`/`refreshToken()` — аналогично; `terminateSession()` сбрасывает в `false`.
- ✅ `METRICS_HEALTH`, `METRICS_UPDATE` (входящие) и `METRICS_SUBSCRIBE`/`METRICS_UNSUBSCRIBE` (исходящие) в `WebSocketMessageType` + типы payload (`MetricPoint`, `MetricsHealthStatus`).
- ✅ `metrics-health.service.ts` + `metrics-health-dot` компонент в сайдбаре.
- ✅ `metrics.service.ts`: `subscribe()`/`unsubscribe()`, обработка `METRICS_UPDATE`, переподписка на реконнект через `effect` на `isConnected$$`.
- ✅ Кэш скользящего окна через `LocalStorageService.getUserScoped`/`setUserScoped` (ключ `metrics_detail`, добавлен в `USER_SCOPED_CACHE_BASE_KEYS`).
- ✅ `metrics-dashboard` компонент (маршрут `/metrics`) + `METRICS_CHART_CONFIG`/`METRICS_SERIES_PALETTE` в `chart-config.ts`, рендер по образцу `balances-chart.ts` (chart.js line chart, один датасет на метрику).
- ✅ `adminOnlyGuard` на маршруте, `adminOnly`-фильтр в `NavigationService`, `@if (authService.isAdmin$$())` для виджета в сайдбаре.
- ✅ Проверено: `tsc --noEmit`, `ng build --configuration dev`, `prettier --check`, и **вживую в браузере** (нашли и исправили гонку гвардов, см. выше).

## Этап 3: UI — карточки метрик

Запрос пользователя: на странице `/metrics` — ряд карточек "Services Health" (детализация по сервисам, сейчас один — `megaapp`, общий индикатор в сайдбаре остаётся агрегированным "худшим" статусом), и отдельный ряд карточек по каждой метрике (сейчас 5). Карточки — фиксированного размера, в `flex flex-wrap` ряду, перенос строки сам по ширине экрана, без медиа-запросов. Стиль — на базе `v-card` из UI-кита (единообразие, как и весь остальной проект).

### Как сделано

- **`HealthStatus` на бэке расширен до списка по сервисам** (`{services: [{service, severity}]}`) — см. backend-план. Фронтовый тип `MetricsHealthStatus` зеркалит это (`ServiceHealth[]`).
- `metrics-health.service.ts`: `severity$$` (одно значение) заменён на `services$$: ServiceHealth[]` + `overallSeverity$$` (computed, "худший" статус среди всех сервисов — error > warn > ok). Сайдбар-точка (`metrics-health-dot`) теперь читает `overallSeverity$$`, не `severity$$`.
- Общая логика severity → цвет/текст вынесена в `src/app/shared/metrics-severity.ts` (`severityDotClass`, `severityLabel`) — раньше дублировалась бы между точкой в сайдбаре и карточками на странице, теперь одно место.
- Человеко-читаемые подписи метрик (бэк отдаёт только технические имена типа `food_diary_entry_created`, в соответствии с принципом "бэк агностичен к смыслу метрик") — `src/app/shared/metrics-labels.ts` (`metricLabel`).
- Новый переиспользуемый presentational-компонент `metric-card` (`src/app/components/metrics/metric-card/`) — обёртка над `v-card`, фиксированная ширина (`w-40`), опциональный цветной dot + лейбл + значение. Используется и для health-карточек, и для карточек метрик — один визуальный язык.
- `metrics-dashboard.html`: два ряда `flex flex-wrap gap-3` с `metric-card` (health — по `metricsHealthService.services$$()`; метрики — по `metricCards$$()`, сумма значений за всё загруженное окно на каждую метрику), график чарта оставлен ниже как есть (история по времени) — карточки добавлены, а не заменили его.

### Этап 3 — ✅ готово
- ✅ `ServiceHealth[]` в `MetricsHealthStatus` (`types.ts`), `metrics-health.service.ts` — `services$$`/`overallSeverity$$`.
- ✅ `metrics-severity.ts` (`severityDotClass`/`severityLabel`), `metrics-labels.ts` (`metricLabel`).
- ✅ `metric-card` компонент (фиксированный размер, `v-card`-based).
- ✅ Два ряда карточек на `metrics-dashboard` (health + по каждой метрике), `flex flex-wrap`.
- ✅ `tsc --noEmit`, `ng build --configuration dev`, `prettier --check` (ts — чисто; html не форматируется prettier в этом проекте никак, см. существующие файлы — не регрессия).

### Ревизия под политику "не бояться breaking changes" (см. корневой план)

`MetricPoint` (`types.ts`) получил поле `service: string` — зеркалит такую же правку в таблице `metrics` на бэке (см. backend-план). Сейчас не используется для группировки в UI (метрик-карточки и график группируются только по `name` — пока один сервис, разницы нет), но тип уже на это готов: когда появится больше источников метрик (Этап 4), группировку по `(service, name)` можно будет добавить без новой правки контракта.

Этап 1 (бэк-сборщик) и Этап 4 (внешний приём) — без участия фронта, см. backend-план.

## План расширения: multi-service dashboard

Подключение `spread-capture-bot/v3` нельзя делать простым добавлением ещё 20+ технических имён в текущий `KNOWN_METRIC_NAMES`.

Так `/metrics` превратится в длинный шумный список, где:

- метрики `megaapp`;
- метрики торгового бота;
- будущие внешние сервисы

будут смешаны в одну плоскость.

### Этап 4A: локальный MVP

Фронт становится service-aware:

- строка `Services Health` остаётся общей;
- ниже появляется выбор текущего сервиса;
- карточки и графики строятся только по выбранному сервису.

Для этого нужен front-only registry:

- service id -> display label;
- service id -> список видимых metric groups;
- service id -> подписи метрик;
- service id -> порядок карточек и графиков.

Бэк этого не знает.

### Как показывать `spread-capture-bot/v3`

Для первого источника достаточно трёх групп:

- `Runtime`
  - длительность цикла;
  - кандидаты / ex-candidates;
  - открытые ордера;
  - missing books;
  - cycle errors;
  - no-mutation streak.
- `Actions`
  - `sell_place`, `sell_replace`, `sell_blocked`, `sell_stop`;
  - `buy_place`, `buy_replace`, `buy_blocked`, `buy_stop`;
  - `trade_post`, `trade_cancel`.
- `Reasons`
  - ключевые серии из `reconcile_breakdown`.

Карточки должны показывать:

- для gauges — последнее значение окна;
- для minute counters — значение за последнее окно, не сумму за весь локальный кэш.

Исторические charts по умолчанию line-based, но для event/counter метрик фронт может явно задавать `bar` на уровне service-aware registry.
Для minute charts при узкой карточке фронт может включать display-only minute→5m collapse с агрегацией по типу метрики, не меняя сам выбранный режим `minute`.

### Что надо поменять в текущем фронте

- `metrics.service.ts` хранит points как сейчас, но селекторы строятся по `(service, name)`, не только по `name`.
- `metrics-labels.ts` превращается из одного flat map в service-aware registry.
- `KNOWN_METRIC_NAMES` уходит; вместо него у каждого сервиса свой preset.
- `metrics-dashboard` получает service selection state.
- Для сервиса `megaapp` текущий UI почти не меняется; он просто становится первым preset-ом.

### Этап 4B: remote-ready

- UI должен уметь показывать stale service отдельно от просто нулевых значений.
- Для batch/backfill нельзя склеивать график с дубликатами одного окна.
- При приходе позднего backfill UI должен заменять существующий bucket, а не append-ить второй такой же.

### Checklist

- ✅ Сделать `/metrics` service-aware вместо одного global metric list.
- ✅ Добавить front-only registry сервисов и их metric presets.
- ✅ Перевести labels и card ordering на `(service, metricName)`.
- ✅ Для `spread-capture-bot-v3` добавить три группы: `Runtime`, `Actions`, `Reasons`.
- ✅ Для minute counters на карточках показывать последнее окно, не накопительную сумму за весь cache window.
- ✅ При merge входящих данных дедуплицировать по `(service, metricName, minuteBucket)`.
- ✅ Добавить отключаемую синхролинию наведения для всех графиков текущей страницы, с хранением флага в localStorage.
- ⭕ Для этапа 4B добавить stale-state и корректную замену bucket при backfill.
