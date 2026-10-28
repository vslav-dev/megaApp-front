# Metrics Granularity — Implementation Plan (Frontend)

Часть единого плана [`METRICS-GRANULARITY._implementation-plan.md`](../../../METRICS-GRANULARITY._implementation-plan.md) в корне `code/`. Предполагает, что megaapp-back уже обновлён по [`megaapp-back/plans/06-metrics-granularity.implementation-plan.md`](../../megaapp-back/plans/06-metrics-granularity.implementation-plan.md) — WS-сообщения уже несут `granularity`.

## Как сейчас

- `MetricPoint` (`src/app/shared/types.ts:196-201`) — `{service, name, bucket, value}`, без гранулярности.
- `metrics.service.ts:8` — `METRICS_WINDOW_SECONDS = 48*60*60`, фиксированное окно, без понятия шага.
- `metrics.service.ts:61-84` (`mergePoints`) — дедуп-ключ `${service}:${name}:${bucket}` (`pointKey`, line 87), обрезка по единому `minBucket`.
- `chart-config.ts:367-368` — `METRICS_WINDOW_MINUTES = 1440`, `METRICS_TICK_INTERVAL_MINUTES = 360`, константы захардкожены под минутный шаг.
- `metrics-series.ts:8-19` — `previousMinuteBucket`, `buildMetricsWindowBuckets(latestBucket, windowMinutes)` — внутри умножение на `60` (минутный шаг) зашито в коде, а не параметр.
- `metrics-dashboard.ts:112-117` — единственное место, где вычисляется окно отображения, без переключателя.
- Уже сделано отдельной задачей и не требует изменений: `metric-units.ts` (форматирование значений/тиков по unit) — работает одинаково для любой гранулярности, значения остаются в тех же единицах независимо от шага между точками.

## Как должно быть

### Модель данных
- `MetricPoint.granularity: 'minute' | 'hour' | 'day'` — обязательное поле (бэк всегда его шлёт, фронт не подразумевает дефолт).
- Дедуп-ключ в `mergePoints`/`pointKey` — `${granularity}:${service}:${name}:${bucket}` (расширение, не замена) — без этого часовой бакет с тем же числовым таймстампом, что и какая-то минутная точка, дал бы коллизию в одной `Map`.

### Шаг и окно — параметризовать, не хардкодить
- Новая константа: `GRANULARITY_STEP_SECONDS: Record<Granularity, number>` = `{minute: 60, hour: 3600, day: 86400}` (новый файл `metric-granularity.ts` или расширение `metrics-series.ts`).
- `buildMetricsWindowBuckets`/`previousMinuteBucket`-аналог — обобщаются до приёма `stepSeconds` параметром вместо захардкоженных `60`.
- Окно отображения на гранулярность:
  - `minute` — 1440 точек.
  - `hour` — 720 точек.
  - `day` — 365 точек.
- Для каждого сервиса display window считается отдельно: конец = последний доступный bucket этого сервиса, старт = первый реально существующий bucket внутри лимита гранулярности. Все карточки сервиса рисуются по одному и тому же окну.
- Интервал подписей X — не фиксированный на всю гранулярность, а выбирается от реальной длины service-level окна.

### Retention на фронте (IndexedDB/signal)
- Текущая `prune`-логика в `mergePoints` (`metrics.service.ts:78-80`) обрезает всё под одно `METRICS_WINDOW_SECONDS` — расширяется до per-granularity порога. Бэк уже не отдаёт больше, чем окно релея (минутки — 1 сутки, часы — 1 месяц, дни — 1 год, см. корневой план, п.6), так что обрезка на фронте — вторичная защита, не основной механизм; пороги те же, что у бэка.

### Текущий (незакрытый) период не приходит вообще
Бэк отдаёт по `hour`/`day` только полностью завершённые периоды (см. корневой план, п.3) — текущий час/день в этих режимах просто отсутствует как точка, ничего на фронте специально обрабатывать не нужно (ни "частично заполненный последний бар", ни обновление значения на лету). Если нужны самые свежие данные — пользователь переключается на `minute`. Учитывать только в UX-мелочи: в `hour`/`day` режиме последняя видимая точка может быть "час/день назад", это ожидаемо, не баг.

### UI — переключатель гранулярности
- Новый `selectedGranularity$$` сигнал на уровне `MetricsDashboard` (или per-карточка, если впоследствии понадобится — пока один на весь дашборд, без переусложнения).
- 3 кнопки (`v-button`, как остальной UI дашборда) — переключают `selectedGranularity$$`, дальше `metricGroupsByService$$` (`metrics-dashboard.ts:127-160`) фильтрует `points$$()` по `point.granularity === selectedGranularity$$()` перед построением серий; режим графика теперь задаётся явно на уровне registry метрик, а не вычисляется от плотности данных.
- `metric-chart-card.ts`/`chart-config.ts` — тиковые интервалы и подписи оси X (`formatMetricBucketLabel`, `metrics-series.ts`) должны быть осведомлены о выбранном шаге (день — показывать дату, не время; час — дату+час; минута — как сейчас).
- Для minute-режима при `card width < 600px` фронт может включать display-only схлопывание `1m -> 5m`: источник данных и выбор гранулярности остаются минутными, но серия и шкала пересчитываются в 5-минутные бакеты на лету.

### METRICS_SUBSCRIBE / merge при первой загрузке
- `sendSubscribe` (`metrics.service.ts:53-59`) — расчёт курсора не меняется, он и остаётся курсором именно минутной гранулярности (бэк применяет его только к `minute`-точкам, см. backend-план). Бэк при подписке сам докладывает в тот же первый `METRICS_UPDATE` ещё и `hour`/`day`-историю в пределах своих окон релея (30 дней / 365 дней) — фронту не нужно знать, как именно бэк это получил у Flatline, просто принимает все три гранулярности через тот же `mergePoints`, без отдельного запроса с фронта.

## Чеклист

- ✅ `MetricPoint.granularity` в `types.ts` (тип `MetricGranularity`).
- ✅ `pointKey`/`mergePoints` — ключ расширен до `granularity:service:name:bucket`; retention в `mergePoints`/`sendSubscribe` теперь только по минутному потоку, час/день не обрезаются.
- ✅ Обобщение `buildMetricsWindowBuckets` (принимает `stepSeconds`), `previousCompletedBucket` (замена `previousMinuteBucket`), `buildRoundTickIndices`/`buildRoundTickBuckets` (принимают `intervalSeconds`) — все в `metrics-series.ts`. Новые константы `METRICS_GRANULARITY_STEP_SECONDS`/`_WINDOW_PERIODS`/`_TICK_INTERVAL_SECONDS` в `chart-config.ts`.
- ✅ `selectedGranularity$$` + 3 кнопки в `metrics-dashboard.ts`/`.html`, персист выбора в `localStorage`.
- ✅ Фильтрация `points$$()` по гранулярности перед построением серий (в `metricGroupsByService$$`).
- ✅ `formatMetricBucketLabel` принимает гранулярность: `minute` → время, `hour` → дата+время, `day` → дата. `granularityInput` на `MetricChartCard`, прокинут в `chart-config.ts`-конфиги и тултипы.
- ✅ **Найдено код-ревью, исправлено:** `buildSparseLineSeriesFromPoints` использовала захардкоженный `LINE_GAP_THRESHOLD_SECONDS = 60` — на шаге 3600с/86400с (час/день) разрыв вставлялся после каждой точки, линия рвалась. Теперь принимает `gapThresholdSeconds` параметром, вызов в `metrics-dashboard.ts` передаёт `stepSeconds` текущей гранулярности.
- ✅ Окно графиков теперь считается per-service от реально доступных данных, но ограничивается `minute=1440`, `hour=720`, `day=365`; внутри сервиса все карточки синхронизированы по одной шкале.
- ✅ Интервал подписей X теперь выбирается от реальной длины service-level окна, чтобы `hour/day` не тонули в датах.
- ✅ Для minute-режима добавлено автоматическое display-only схлопывание в `5m` при `card width < 600px`; при `600px` и больше график остаётся обычным минутным.
- ⭕ Прогнать вживую в браузере после деплоя бэка/Flatline по новому контракту (нужны реальные `hour`/`day` точки от агрегатора, локально их пока нет) — см. чек-лист роллаута в Flatline-плане, Фаза 5.
- ✅ `tsc --noEmit` и полный `ng build` (`npm run build:dev`) — чисто.
