# Metrics Catalog Unification — Implementation Plan (Frontend)

Зачем: сейчас конфигурация одной и той же метрики (label/description/aggregation/unit/color/chartMode) размазана по 4 разным файлам, часть из них не партиционирована по сервису (риск коллизии имён между сервисами), а способ схлопывания в 5-минутные бакеты (`sum`/`avg`/`max`/`last`) определяется неявно — попаданием имени метрики в один из плоских `Set`ов или совпадением с regex по суффиксу, без явного решения на каждую метрику. Это уже дало конкретный баг: `trade_post` попал в `SUM_METRICS`, хотя по смыслу должен усредняться, а не суммироваться. Цель рефакторинга — единый каталог метрик, где вся конфигурация метрики лежит в одном месте, задаётся явно и типобезопасно, и легко расширяется новыми полями без создания очередного параллельного файла-реестра.

> **Скоуп явно ограничен фронтом.** `aggregation` в этом каталоге относится **только** к display-only схлопыванию `1m → 5m` на фронте (`granularity === 'minute'`, узкая карточка) — способу визуально сжать минутные точки, когда на них физически не хватает места на графике, не более. `hour`/`day` гранулярность считает `flatline/internal/metrics/aggregation_registry.go` (отдельный репозиторий) и отдаёт на фронт уже готовыми периодами — это осознанно другой слой со своей семантикой ("сколько всего произошло за этот час", а не "как визуально не соврать на сжатом минутном графике"), эта задача его не трогает и трогать не должна.

## Как сейчас

Четыре независимых реестра, все ключуются по имени метрики, но не единообразно:

- `shared/metrics-labels.ts` — `METRICS_SERVICE_DEFINITIONS: MetricsServiceDefinition[]` (партиционировано по сервису): `groups: {id, label, metrics: string[]}[]`, `metricColors: Record<string,string>`, `metricChartModes?: Partial<Record<string,MetricChartMode>>`. Отдельно `METRIC_LABELS: Record<service, Record<name,string>>`. Плюс обвязка для динамических `hardware:<host>` сервисов и `megaapp-test`-варианта (`metricsServiceDefinition`, `metricsServiceLabel`, `metricLabel`, `metricChartMode`).
- `shared/metrics-descriptions.ts` — `METRIC_DESCRIPTIONS: Record<service, Record<name,string>>` (партиционировано по сервису), `metricDescription(service, name)`.
- `shared/metrics-aggregation.ts` — `SUM_METRICS`/`LAST_METRICS: Set<string>` — **плоские, общие на все сервисы разом**, без привязки к сервису; плюс regex по суффиксу (`_avg$`, `_max$`, `_ms$`, `_(ratio|bytes)$`) с фолбэком в `avg`. Отдельно тут же лежит `MetricAggregation` (тип) и `aggregateMetricValues(aggregation, values)` — чистая математика схлопывания массива значений в одно число, используется в `metrics-series.ts` (`MinuteMetricCollapseCache`), не привязана к имени метрики.
- `shared/metric-units.ts` — `METRIC_UNIT_OVERRIDES: Map<string,MetricUnit>` — тоже **плоская, общая на все сервисы**, плюс regex по суффиксу (`_ratio(_avg|_max)?$`, `_bytes$`, `_ms$`), фолбэк `count`. Отдельно тут же — `MetricUnit` (тип) и `formatMetricUnitValue`/`formatBytesValue`/`formatDurationMsValue`/`formatHumanDurationValue` — чистое форматирование числа под юнит, не привязано к каталогу метрик.

Единственный потребитель всех четырёх реестров — `components/metrics/metrics-dashboard/metrics-dashboard.ts` (`buildCard`, строки ~196-233): `metricAggregation(name)`, `metricUnit(name)`, `metricLabel(service, name)`, `metricDescription(service, name)`, `metricChartMode(service, name)`, `definition?.metricColors[name]`. Других мест использования нет, тестов на эти 4 файла нет — блэст-радиус изменений маленький.

Проблемы:
- Имя метрики физически упоминается в 4+ местах (список группы + 3 словаря атрибутов) — добавить метрику или поменять поведение = править в нескольких файлах.
- `SUM_METRICS`/`LAST_METRICS`/`METRIC_UNIT_OVERRIDES` не партиционированы по сервису — коллизия имён между сервисами в принципе возможна.
- Агрегация метрики, которую забыли явно указать, молча падает в `avg` — компилятор никак не помогает не забыть.
- `trade_post` (`spread-capture-bot-v3`) сейчас в `SUM_METRICS` — по факту для minute→5m display-collapse нужен `avg` (см. каталог ниже); `hour`/`day` эта правка не касается вообще, там своя, отдельная агрегация на стороне Flatline.

## Как должно быть

### Единый тип конфигурации метрики

`MetricConfig = {name, label, description, aggregation: MetricAggregation, unit: MetricUnit, color: string, chartMode: MetricChartMode}`.

Фабрика `metric(name, opts)` вместо голого литерала: `aggregation` и `description` — обязательные именованные поля без дефолта (забыть их для новой метрики — ошибка компиляции, не тихий фолбэк). `label`/`unit`/`color`/`chartMode` — необязательные, при отсутствии вычисляются один раз внутри фабрики (по суффиксу имени, дефолтному цвету, `'sparse-line'`) — то есть регэксп-инференс остаётся, но только как удобный дефолт при заполнении каталога, а не как рантайм-логика на каждый рендер.

### Группы хранят конфиги, а не имена

`MetricsGroupDefinition.metrics: MetricConfig[]` (сейчас `string[]`). Имя метрики упоминается ровно один раз — в точке, где она добавляется в группу; там же сразу вся её конфигурация.

### Разбивка файлов — по сервису, не по характеристике

Новые файлы:
- `shared/metrics-catalog.ts` — типы (`MetricConfig`, `MetricsGroupDefinition`, `MetricsServiceDefinition`), фабрика `metric()`, дефолты для некаталогизированных метрик, построение плоского индекса `Map<service, Map<name, MetricConfig>>` один раз при загрузке модуля (данные статические — рантайм-кэш/memoize не нужен), рантайм-assert на дублирующееся имя внутри сервиса при построении индекса, публичные функции: `metricLabel(service, name)`, `metricDescription(service, name)`, `metricAggregation(service, name)`, `metricUnit(service, name)`, `metricColor(service, name)`, `metricChartMode(service, name)`, `metricsServiceDefinition(service)`, `metricsServiceLabel(service)`, `metricsServiceDefinitions()`.
- `shared/metrics-catalog.spread-capture-bot.ts`, `shared/metrics-catalog.megaapp.ts`, `shared/metrics-catalog.sozvon-konspekt.ts`, `shared/metrics-catalog.hardware.ts` — данные, каждый экспортирует готовый `MetricsServiceDefinition`, собранный через `metric(...)`. `metrics-catalog.ts` импортирует все четыре и собирает `METRICS_SERVICE_DEFINITIONS`.
- Логика динамических `hardware:<host>` сервисов и `megaapp-test`-варианта переезжает из `metrics-labels.ts` в `metrics-catalog.ts` без изменений по сути — те же `isHardwareService`/`hardwareServiceLabel`/`METRICS_SERVICE_VARIANTS`, только поверх нового индекса. Общий индекс `hardware`-каталога переиспользуется для всех хостов — от конкретного `host` зависит только `label` сервиса, не содержимое индекса.

Удаляются: `shared/metrics-labels.ts`, `shared/metrics-descriptions.ts`. Обязательное поле `aggregation`/`unit` заполняется явно для каждой существующей метрики при переносе — это и есть момент пересмотра `trade_post` (`sum` → `avg`) и ревизии остальных метрик группы `orders`/`trades` в `spread-capture-bot-v3` на предмет того же класса ошибки.

### Aggregation-математика и unit-форматирование остаются отдельно от каталога

`shared/metrics-aggregation.ts` сжимается до `MetricAggregation` (тип) + `aggregateMetricValues(aggregation, values)` — чистая функция "как схлопнуть массив чисел заданной стратегией", используется `metrics-series.ts` и не знает об именах метрик. `SUM_METRICS`/`LAST_METRICS`/regex-инференс отсюда удаляются — переезжают (как решение per-metric) в данные `metrics-catalog.*.ts`.

`shared/metric-units.ts` сжимается до `MetricUnit` (тип) + `formatMetricUnitValue`/`formatBytesValue`/`formatDurationMsValue`/`formatHumanDurationValue`/`formatCountValue` — чистое форматирование числа под юнит для отображения, тоже не знает об именах метрик. `METRIC_UNIT_OVERRIDES`/`METRIC_UNIT_SUFFIXES` удаляются как публичный API; суффиксный инференс (использованный как дефолт внутри `metric()`) переезжает приватной функцией в `metrics-catalog.ts`.

`shared/metrics-chart-mode.ts` не трогается (только тип, уже минимальный).

### Flatline (`hour`/`day`) — сознательно не трогаем

`flatline/internal/metrics/aggregation_registry.go` считает агрегацию для `hour`/`day` гранулярности отдельно, до фронта, и решает другую задачу — не "как визуально сжать 5 минутных точек в одну ради ширины карточки", а "сколько реально произошло за целый час/день". Для `trade_post` там **сохраняется `sum`** — часовое/дневное значение должно оставаться реальным тоталом за период (напр. 5500 репрайсов за час — так и остаётся 5500), это не тот же баг, что в minute→5m collapse, и правки не требует. Код Flatline этим планом не меняется.

### Совместимость с сохранёнными настройками дашборда

`MetricsSettingsService` (`metrics-settings.service.ts`) хранит `dashboardSelection`/`dashboardServiceSelection`/`severityThresholds`/`serviceHeaderVisibility` как обычные `Record<string, ...>` — ключи это буквальные строки `service`/`metricName`, не индексы массива и не ссылки на объект каталога; бэк (`megaapp-back/internal/settings/service.go:119-132`) хранит это как непрозрачный JSON-блоб без схемы. `dashboardCards` строятся `selectedMetrics.map(([name]) => buildCard(name))` напрямую из сохранённого выбора, без сверки с группами каталога — даже отсутствующее в каталоге имя просто уйдёт в уже описанный generic-фолбэк, не сломается.

Единственный способ реально что-то сломать при переносе данных по новым per-service файлам — опечататься в самой строке (`'trade_post'` → `'trade-post'`, переименовать `service: 'spread-capture-bot-v3'`). Раздел ниже в чеклисте — явная проверка на это.

### Потребитель

`metrics-dashboard.ts` (`buildCard`): `metricAggregation(name)` → `metricAggregation(option.service, name)`, `metricUnit(name)` → `metricUnit(option.service, name)`, `definition?.metricColors[name]` → `metricColor(option.service, name)`. Остальные вызовы (`metricLabel`, `metricDescription`, `metricChartMode`, `metricsServiceDefinition`) не меняют сигнатуру. `definition?.groups` (строка 235) продолжает отдавать группы, просто `group.metrics` теперь `MetricConfig[]` — `buildCard` вызывается с `metric.name` вместо голого имени из `string[]`.

### Фолбэк-дефолты для имени вне индекса

Один объект дефолтов в `metrics-catalog.ts` (`aggregation: 'avg'`, `unit: 'count'`, `chartMode: 'sparse-line'`, `label: name`) — применяется, когда имя метрики не найдено в индексе сервиса. Нужен в двух случаях: (а) метрика была в каталоге, попала в чей-то персональный `dashboardSelection$$`, потом была переименована/удалена из группы — карточка не должна падать; (б) новый блок автообнаружения ниже.

### Автообнаружение незаведённых метрик — блок «Не в каталоге» (принято, пересмотрено против исходного плана)

Мысль здравая: не полагаться на то, что кто-то вспомнит вручную завести новую метрику в каталог, когда она реально появится в потоке с бэка — вместо этого показать её сразу, но честно отдельно от каталогизированных, максимально обычным ("generic") рендером, без притворства, что для неё продумано описание/цвет/агрегация.

- Для каждого сервиса — известного (есть `MetricsServiceDefinition`) или нет — считается `knownNames` (имена, реально перечисленные в его группах каталога; пусто, если определения нет) и `observedNames` (имена, реально встреченные в `points$$()` для этого сервиса в текущем окне).
- `discoveredNames = observedNames \ knownNames`, отсортировано по алфавиту.
- Если `discoveredNames` не пусто — в конец `groups` этого сервиса добавляется одна синтетическая группа `{id: 'uncatalogued', label: 'Не в каталоге', metrics: discoveredNames}`. Пусто — блок не рендерится вообще, никакого мусора на экране.
- Карточки строятся тем же `buildCard`, просто для имени вне индекса — включается фолбэк-дефолт из пункта выше (`avg`/`count`/`sparse-line`/нейтральный серый цвет/`label = name`) — ровно "максимально обычное" представление, которое и просили.
- `description` для такой карточки — не пустая строка, а одна общая константа-пометка (например "Метрика ещё не описана в каталоге — показано значение по умолчанию"), а не пустота, чтобы сразу читалось как "мы про неё пока ничего не знаем", а не как забытое поле.
- Заодно чинится смежный сегодняшний изъян: сервис вообще без `MetricsServiceDefinition` сейчас показывает пустую панель (`groups: []`) — теперь получает ту же единственную группу "Не в каталоге" со всем, что реально шлёт, и перестаёт выглядеть пустым/сломанным при первом подключении нового сервиса.
- `dashboardMetricOptionsByService$$` (список для пиннинга метрики на главный Dashboard, `metrics-dashboard.ts:267-290`) — той же логикой: `catalogNames` (порядок как в каталоге) `++ discoveredNames` (сортировка по алфавиту), а не только `catalogNames` для известных сервисов, как сейчас. Новую метрику сразу можно закрепить на дашборде, не дожидаясь, пока её кто-то вручную опишет.
- Новый маленький экспорт `metrics-catalog.ts`: `metricsCatalogKnownNames(service): ReadonlySet<string>` (тривиальный `flatMap` по `groups[].metrics[].name`) — чтобы `metrics-dashboard.ts` не лез внутрь структуры `MetricsServiceDefinition` напрямую, а брал готовый набор имён.

Итог: единственный способ метрике не попасть на экран вообще — если её физически нет в данных за окно. Всё, что реально приходит, видно сразу — либо красиво (в каталоге), либо честно-обычно (в "Не в каталоге") — без ручного шага "не забыть завести".

## Найденный и исправленный баг: циклический импорт

`metrics-catalog.ts` импортировал определения из 4 файлов данных, а те импортировали `metric()`/типы обратно из `metrics-catalog.ts` — цикл. В браузере это падало рантайм-ошибкой `Cannot read properties of undefined (reading 'test')` внутри `inferUnitFromSuffix`: из-за цикла бандлер иногда исполнял тело `metrics-catalog.ts` (и, значит, вызовы `metric(...)` из файлов данных) раньше, чем успевали проинициализироваться его собственные `const`-регэкспы (`RATIO_SUFFIX` и т.д.).

Исправлено: `metric()`, `MetricConfig`, `MetricsGroupDefinition`, `MetricsServiceDefinition` и суффиксный инференс юнита вынесены в новый leaf-файл `shared/metrics-catalog-metric.ts`, который ничего не импортирует обратно из каталога. 4 файла данных и сам `metrics-catalog.ts` импортируют из него однонаправленно — цикла в графе импортов больше нет вообще, а не просто "порядок бандлера сейчас случайно совпал".

## Найденный и исправленный баг: дробное среднее у целочисленных счётчиков

После фикса `trade_post` на `avg` схлопывание 5 минутных целых значений через `sum/values.length` стало давать дробные числа (107.6 вместо целого) — выглядит как артефакт для метрики, которая по своей природе всегда целая (счётчик событий). При этом дробное среднее осмысленно для других `avg`-метрик — `load1`/`load5`/`load15` (load average — легитимно дробный), `*_ratio_avg`, `*_ms` (длительности) — там округление до целого было бы потерей точности, а не исправлением.

Решение — не завязывать округление на `unit === 'count'` (у `load1` тоже `unit: 'count'`, но округлять его нельзя), а завести отдельный явный вариант агрегации: `avgRound` в `MetricAggregation` (`shared/metrics-aggregation.ts`) — то же среднее, но `Math.round()` в конце. Выбор `avg` vs `avgRound` — сознательное решение автора конкретной метрики в каталоге, без магического авто-переключения по юниту.

- `trade_post` (`spread-capture-bot-v3`) — `avg` → `avgRound`.
- Фолбэк-дефолт для некаталогизированных метрик (`UNCATALOGUED_DEFAULTS` в `metrics-catalog.ts`) — тоже `avgRound` вместо `avg`: раз юнит по умолчанию угадывается как `count` (то есть "скорее всего целочисленный счётчик"), агрегация по умолчанию должна быть с этим согласована.
- Условие "не показывать незакрытый 5-минутный бакет" в `metrics-dashboard.ts` (`aggregation === 'sum'`) осталось без изменений — оно и не должно расширяться на `avgRound`: `avg`/`avgRound` уже нормализуют по количеству точек, растущий бакет не даёт того визуального провала, что у `sum`.

## Полная ревизия агрегации по всем 93 метрикам (`spread-capture-bot-v3`/`buy`/`sell`/`orders`-групп)

Прошли по каждой метрике каталога с вопросом "эта метрика — частая фоновая рутина почти каждого цикла (тогда `sum` за 5 минут раздувает картинку, нужен `avgRound`) или разовое/редкое/аварийное событие (тогда `sum` за окно — сам по себе содержательный ответ)". По `megaapp`/`sozvon-konspekt`/`hardware` — без изменений, вся текущая расстановка признана верной (снепшоты `last`, пики `max`, непрерывные величины `avg`, разовые пользовательские события/джобы `sum`).

По `spread-capture-bot-v3`, группы `orders`/`buy`/`sell` — изменено с `sum` на `avgRound`:
- `trade_cancel` (прямая пара к уже исправленному `trade_post`, та же частота)
- `buy_keep`, `sell_keep` (штатная рутина почти каждого цикла на каждую открытую позицию)
- `buy_replace`, `sell_replace` (родительская сумма для reprice — доминирующей по частоте причины, которая уже `avgRound`)
- `buy_blocked`, `buy_blocked_no_book`, `buy_blocked_below_min`, `sell_blocked`, `sell_blocked_no_book`, `sell_blocked_below_min`, `sell_blocked_queue_too_deep` (блокировки признаны достаточно частым явлением, тот же класс)

Оставлены `sum` осознанно (редкие/разовые события, где сумма за окно и есть содержательный ответ): `buy_place`, `sell_place` (открытие новой позиции), `buy_stop`/`sell_stop` и все их детализации по причинам (`*_no_deficit`, `*_market_dropped_out`, `*_no_candidate`, `*_entry_blacklisted`, `*_queue_too_deep`, `*_no_inventory` — разовое завершающее событие на жизненный цикл позиции), `buy_replace_size_change`, `sell_replace_expand`, `sell_replace_reduce` (реже reprice — по наблюдению почти пустые графики, менять не о чем), `cycle_errors`/`reconcile_failures`/`discovery_errors` (аварийные — при сбое важна полная величина всплеска, не смазанное среднее).

## Чеклист

- ✅ `shared/metrics-catalog.ts`: типы `MetricConfig`/`MetricsGroupDefinition`/`MetricsServiceDefinition`, фабрика `metric()`, дефолты для некаталогизированных метрик, построение индекса + assert на дубликат имени внутри сервиса.
- ✅ Публичные функции в `metrics-catalog.ts`: `metricLabel`, `metricDescription`, `metricAggregation(service, name)`, `metricUnit(service, name)`, `metricColor`, `metricChartMode`, `metricsServiceDefinition`, `metricsServiceLabel`, `metricsServiceDefinitions` — на новом индексе, без regex/Set на хот-пути.
- ✅ Перенос данных `hardware` в `metrics-catalog.hardware.ts` (текущий `HARDWARE_SERVICE_DEFINITION` + `isHardwareService`/`hardwareServiceLabel`), явные `aggregation`/`unit` на каждую метрику вместо текущего фолбэка через `metricAggregation`/`metricUnit`. `uptime_seconds` сохранил `last` (была в `LAST_METRICS`), не съехала на дефолтный `avg`.
- ✅ Перенос данных `spread-capture-bot-v3` в `metrics-catalog.spread-capture-bot.ts`, включая описания — явная агрегация на каждую метрику; **`trade_post`: `sum` → `avg`**. Остальные метрики `orders`/`buy`/`sell`-групп (включая `trade_cancel`) оставлены `sum`, как было — не в скоупе этой задачи, менять чужую семантику без явного запроса не стал.
- ✅ Перенос данных `megaapp` в `metrics-catalog.megaapp.ts` (`food_diary_entry_created` и остальные — остаются `sum`, как и было).
- ✅ Перенос данных `sozvon-konspekt` в `metrics-catalog.sozvon-konspekt.ts`.
- ✅ `METRICS_SERVICE_VARIANTS` (`megaapp-test` → `megaapp`) переехал в `metrics-catalog.ts` без изменений по сути.
- ✅ `shared/metrics-aggregation.ts` сжат до `MetricAggregation` + `aggregateMetricValues` — `SUM_METRICS`/`LAST_METRICS`/regex-инференс удалены.
- ✅ `shared/metric-units.ts` сжат до `MetricUnit` + функции форматирования — `METRIC_UNIT_OVERRIDES`/`METRIC_UNIT_SUFFIXES`/`metricUnit(name)` удалены (инференс по суффиксу переехал приватной функцией в `metrics-catalog.ts`).
- ✅ `shared/metrics-labels.ts`, `shared/metrics-descriptions.ts` удалены.
- ✅ `metrics-dashboard.ts` (`buildCard`) обновлён под новые сигнатуры (`metricAggregation`/`metricUnit` принимают `service`; `metricColor` вместо `definition?.metricColors[name]`).
- ✅ `tsc --noEmit` и `npm run build:dev` — чисто.
- ✅ `metricsCatalogKnownNames(service)` — новый экспорт в `metrics-catalog.ts`.
- ✅ `serviceMetricsData$$` (`metrics-dashboard.ts`): считает `discoveredNames = observedNames(service) \ knownNames(service)` и добавляет синтетическую группу `{id: 'uncatalogued', label: 'Не в каталоге'}` в конец `groups`, только если непусто; работает и для сервисов вообще без `MetricsServiceDefinition`.
- ✅ Общая fallback-`description` для карточек вне каталога (не пустая строка) — используется и в этом блоке, и в старом фолбэк-кейсе "осиротевшей" метрики из `dashboardSelection$$`.
- ✅ `dashboardMetricOptionsByService$$`: список опций = `catalogNames ++ discoveredNames` (dedupe через `Set`, `discoveredNames` отсортированы по алфавиту) вместо только `catalogNames` для известных сервисов.
- ✅ Сверка списков `(service, name)` до/после по всем 4 старым файлам — написан разовый скрипт, сравнил 93 старых и 93 новых имени через `diff` двух отсортированных списков: **разницы нет**, ни одной опечатки/переименования. Строки `service` (`spread-capture-bot-v3`/`megaapp`/`sozvon-konspekt`/`hardware:`) и вариант `megaapp-test`→`megaapp` тоже сверены посимвольно.
- ⭕ Прогнать дашборд метрик вживую в браузере: проверить, что на `minute`-гранулярности при схлопывании в 5-минутки `trade_post` теперь показывает среднее (а не завышенную сумму), а `food_diary_entry_created` — по-прежнему сумму; `hour`/`day` для `trade_post` не менялись и по-прежнему показывают реальный тотал за период; цвета/подписи/описания/bar-режимы не съехали ни для одного сервиса (включая `hardware:*` и `megaapp-test`); блок "Не в каталоге" появляется только когда реально есть незаведённые метрики.
