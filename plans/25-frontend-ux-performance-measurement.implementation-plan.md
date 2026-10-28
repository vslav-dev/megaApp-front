# 25. Временные замеры UX-производительности фронтенда

## Реализовано

- Root-сборщик, user-scoped LocalStorage очередь, 1 MiB limit, ACK-доставка через текущий WebSocket и десятиминутный интервал.
- Route/browser observers, `sync.operation` и все добавленные верхнеуровневые metrics/money/food flows.
- Не добавлены шумные per-scroll/per-pointer замеры; их покрывают модели, рендеры и browser Long Task/Event Timing.
- Локальная отладка: интервал временно уменьшен до одной минуты; ACK продолжает без паузы дочищать всю накопленную очередь batch-ами.

## Debug-проверка 2026-08-07

- Причина: после ACK предыдущая версия сбрасывала старт очереди и ждала новый интервал перед следующим 48 KiB batch.
- Исправление: после первого разрешённого batch очередь остаётся в режиме drain до пустого состояния.
- Живой результат: 75 строк первой отправки в `10:18:45`, затем 1661 строка в `10:23:31`; всего 1736 уникальных `eventId`.

## Device-контекст

- `platform` и `mobileDevice` — определённый браузером тип устройства, единый источник `DeviceInfoService`.
- `mobileScreen` — текущий responsive-layout. В Food он равен одной колонке; телефон в landscape с двумя колонками корректно имеет `platform=mobile`, `mobileDevice=true`, `mobileScreen=false`.

## Цель

За одну неделю получить сопоставимую картину работы приложения на всех устройствах: какой пользовательский flow был запущен, сколько занял путь до готового кадра, сколько данных он обработал и где возникла длительная блокировка браузера. Замеры не теряются при SPA-навигации, перезагрузке вкладки или временном отсутствии сети.

Это первый, обзорный этап. Он отвечает «какой flow плохой и при каких объёмах», а не «какая внутренняя строка виновата».

## Границы

- Временный диагностический код во фронтенде; после разбора данных удалить полностью.
- Один верхнеуровневый замер на самостоятельный flow. Не обкладывать его внутренние функции отдельными логами.
- Не менять UX, вычисления, кэши, API доменов, Chart.js-конфигурации и данные.
- Не записывать содержимое еды, заметок, поисковых запросов, названия метрик, суммы, изображения, аудио или токены.
- Не считать сетевую задержку «медленным устройством»: у сетевого flow отдельно сохранять полное время ожидания и время от получения данных до готового кадра.
- Не слать событие на каждый pointermove, scroll или resize. Для частых событий сохранять краткую сводку окна работы.
- Не создавать HTTP endpoint, таймер-фоновую отправку, Service Worker, IndexedDB-очередь или отдельное соединение. Используется только уже открытый WebSocket.

## Общий формат замера

Каждая запись содержит:

- `operation` — стабильное имя из перечня ниже.
- `route`, `outcome`, `trigger` — экран, результат и причина запуска.
- `elapsedMs` — от начала flow до завершения работы/готового кадра.
- `renderMs` — от готовых данных или изменения состояния до двух кадров браузера; это наблюдаемая цена интерфейса.
- Только безопасные размеры входа/результата: число точек, карточек, записей, дней, месяцев, серий, видимых строк, байт ответа.
- Контекст сессии: версия фронта, viewport, DPR, класс экрана, `hardwareConcurrency`, доступная память устройства при наличии, тип сети при наличии, браузер/ОС. Пользователь определяется существующей авторизацией на сервере, отдельный идентификатор не передаётся.

`elapsedMs` измеряется монотонными часами браузера и округляется до целой миллисекунды. У асинхронных flow сохраняется один итоговый лог, включая ошибку/отмену. У синхронных вычислений — один лог вокруг внешнего вычислителя. Никаких вложенных событий первого этапа.

## Доставка и сохранность

### Выбранная схема

```text
измеренный flow
  → root-сервис: нормализует безопасную запись
  → LocalStorage user-scoped очередь
  → при следующей активности + открытом WebSocket + истёкших 10 мин
  → PERFORMANCE_METRICS_BATCH
  → серверный append + fsync NDJSON
  → PERFORMANCE_METRICS_ACK
  → удалить подтверждённые записи из LocalStorage
```

Один root-сервис создаётся из корневого компонента и живёт всё время приложения. Он — единственная точка записи, локального хранения, отправки и приёма ACK. Места замеров знают только операцию и безопасные размеры результата.

### LocalStorage-очередь

- Новая user-scoped, versioned key; logout очищает её вместе с остальными user-scoped данными.
- В памяти события копятся недолго, затем одной записью сохраняются в LocalStorage. Принудительное сохранение — при `visibilitychange`/`pagehide`; обычная SPA-навигация ничего не теряет.
- Каждому событию присваивается стабильный `eventId` из session id и последовательного номера. При потере ACK повторная отправка допустима: итоговый NDJSON дедуплицируется по `eventId` при анализе.
- Очередь ограничена 1 MiB. При переполнении удаляются самые старые записи, а счётчик потерь сохраняется в метаданных и приходит следующим успешным batch. Это лучше молчаливого переполнения quota или неограниченного роста.
- Высокочастотные flows предварительно сворачиваются в оконную сводку; сама очередь не становится новым источником jank.

### Когда разрешена отправка

- Минимальный интервал между успешными отправками — 10 минут, сохраняется в метаданных очереди.
- Нет самостоятельного `setInterval`/`setTimeout`, который отправляет данные в простой или фоне.
- Проверка отправки выполняется только на уже происходящем событии: получен новый замер, вкладка стала видимой, WebSocket открылся/переподключился.
- Если WebSocket закрыт, batch остаётся в LocalStorage. При следующем открытии отправляется только если прошли 10 минут; это сознательно привязывает сеть к реально активному приложению.
- В одном сообщении максимум 48 KiB после JSON-кодирования и ограниченное число событий. Лимит оставляет запас внутри существующего WebSocket read limit 64 KiB.
- В полёте только один batch. Без ACK очередь не меняется и повторяется при следующей разрешённой активности.

### Подтверждение и отказы

- Подтверждение приходит только после серверного append всего batch, `fsync` и закрытия файла.
- Обычный ACK удаляет только подтверждённые `eventId`; измерения, появившиеся во время отправки, остаются в очереди.
- При ошибке записи или разрыве соединения ACK нет: данные остаются для повторной отправки.
- При отключённом серверном флаге приходит явный discard-ACK: фронт очищает этот batch, чтобы временно выключенная кампания не заполнила LocalStorage.

## Состав записи

Одна измеренная операция содержит `eventId`, client wall-clock timestamp, session/tab id, release/version, operation, duration fields, route/trigger/outcome и безопасные числовые attributes из таблиц ниже.

Контекст устройства снимается в момент события:

- Фактическое устройство: `mobile/tablet/desktop`, touch, user agent.
- Текущая компоновка: mobile/desktop screen, viewport и screen dimensions, DPR, ориентация.
- Возможности: `hardwareConcurrency`, `deviceMemory` и Network Information API только когда браузер их предоставляет.

`userId` не передаётся: WebSocket уже аутентифицирован, сервер добавляет доверенный id из соединения. Не нужны username, JWT или какая-либо пользовательская нагрузка.

## Как добавлять замеры

Основной механизм — маленький API root-сервиса для синхронной операции, async операции и пути «изменение состояния → следующий готовый кадр». Он принимает operation, trigger и числа, сам формирует и сохраняет запись.

Декоратор допустим только как тонкая обёртка для изолированных публичных sync/async методов, когда граница операции полностью совпадает с методом. Он не подходит для:

- реактивных computed/effect;
- router/bootstrap и browser observers;
- нескольких параллельных запросов;
- «действие пользователя → два кадра»;
- Chart.js lifecycle и pointer/scroll/resize сводок.

Существующий console-only декоратор времени не переиспользуется: он не сохраняет данные, не ждёт кадр, не содержит контекста и не умеет подтверждённую доставку. Для всех остальных границ замер ставится вручную с тем же root-сервисом. Так сохраняется один формат и не возникает магии в местах, где декоратор измерил бы не UX-время.

## Глобальные источники

- Root-сервис подписывается на Router, состояние существующего WebSocket и его входящие ACK; NetworkService остаётся владельцем сокета.
- Browser Performance API даёт navigation timing, Long Task и Event Timing, где они доступны. Отсутствие API на конкретном телефоне не является ошибкой и не включает fallback polling.
- Первое готовое приложение фиксируется совместно с корневым компонентом после Angular bootstrap и двух кадров; browser navigation timing сохраняется отдельно.

## Общие наблюдения без привязки к домену

| Operation | Граница | Атрибуты |
| --- | --- | --- |
| `app.bootstrap` | загрузка приложения до первого готового маршрута | cold/warm, время lazy-chunk, auth/settings result |
| `app.route_ready` | начало навигации до стабильного следующего кадра экрана | маршрут, причина навигации |
| `app.long_task` | каждая задача главного потока от 50 ms | текущий маршрут, длительность, момент сессии |
| `app.interaction_delay` | доступные браузеру длительные click/tap/key interactions | маршрут, тип взаимодействия, длительность |
| `app.layout_window` | сводка за окно resize/scroll, а не каждое событие | экран, число событий, сумма/max callback ms, число смен компоновки |
| `app.theme_change` | действие смены темы до готового кадра | предыдущая/следующая тема |

`long_task` и `interaction_delay` обязательны: они дают страховочную сетку для тяжёлого участка, который не попал в известные flows. Это не замена списка ниже, а проверка его полноты.

## Метрики — полный набор верхнеуровневых flows

### Загрузка и актуализация данных

| Operation | Граница | Атрибуты |
| --- | --- | --- |
| `metrics.cache_hydrate` | IndexedDB-кэш метрик до публикации состояния | число точек по гранулярности, cache hit/miss |
| `metrics.history_refresh` | автоматическое, reconnect или ручное обновление истории до слияния и готового кадра | trigger, request/response ms, байты, сервисы, точки по гранулярности, retained points |
| `metrics.realtime_batch` | один WebSocket batch до слияния, очистки старого набора и готового кадра | входные/новые/заменённые точки, retained points, гранулярности |
| `metrics.cache_persist` | отложенная запись текущего кэша | число точек, serialized bytes, result |

### Построение модели и экран

| Operation | Граница | Атрибуты |
| --- | --- | --- |
| `metrics.dashboard_model` | полное реактивное построение данных сервисов, групп, dashboard и составных метрик | trigger, входные точки, сервисы, группы, карточки, составные карточки, точки в display/full-width series |
| `metrics.dashboard_ready` | вход на экран и первая готовая отрисовка всех текущих карточек | карточки, раскрытый раздел, гранулярность, layout |
| `metrics.granularity_change` | выбор minute/hour/day до готового кадра | from/to, карточки, точки |
| `metrics.panel_change` | открытие dashboard/сервиса/настроек до готового кадра | from/to, созданные карточки |
| `metrics.layout_change` | compact/wide, изменение размера карточек или изменение ширины grid до готового кадра | change kind, columns, карточки, viewport |
| `metrics.card_expand` | раскрытие/закрытие одной карточки до готового кадра | series point count, mode, роль карточки |
| `metrics.data_shape_change` | изменение anomaly filter, force-zero или состава dashboard до готового кадра | change kind, карточки, точки |
| `metrics.composite_change` | добавление, удаление или изменение составной метрики до готового кадра | change kind, number of composites, points |
| `metrics.crosshair_window` | сводка короткого активного hover/touch окна синхронного курсора | cards redrawn, event count, total/max redraw ms, granularity |

### Chart.js карточки

Каждая карточка получает самостоятельный верхнеуровневый замер: одна серия может быть проблемной при полностью нормальном dashboard. Логи не содержат названия метрики; используют технический хэш/безопасный ключ карточки только для группировки одной и той же серии.

| Operation | Граница | Атрибуты |
| --- | --- | --- |
| `metrics.chart_create` | создание canvas-графика до следующего кадра | chart mode, series points, width/height, role, гранулярность |
| `metrics.chart_update` | одно обновление существующего графика до следующего кадра | trigger, series points, mode, width/height, role |
| `metrics.chart_recreate` | пересоздание из-за темы до следующего кадра | series points, mode, dimensions |

## Деньги — полный набор верхнеуровневых flows

| Operation | Граница | Атрибуты |
| --- | --- | --- |
| `money.snapshot_apply` | применение локального или серверного snapshot до готового кадра | source, response ms, currencies/categories/accounts/assets/trades/transactions/rates |
| `money.screen_ready` | вход на экран до первой готовой вкладки и графиков | cache/server state, entities, active tab |
| `money.monthly_buckets` | построение помесячной базы для всех графиков | transactions, months, accounts |
| `money.position_lots` | построение FIFO-позиций | investment trades, accounts, lots, months |
| `money.balance_model` | построение данных графика балансов | months, accounts, transactions, rate snapshots |
| `money.income_model` | построение доходов/PNL | months, categories, series, position lots |
| `money.expense_model` | построение расходов | months, categories, series |
| `money.range_change` | изменение диапазона до готового кадра | from/to, months, chart points |
| `money.currency_change` | смена отображаемой валюты до готового кадра | from/to, entities, months |
| `money.tab_change` | смена вкладки до готового кадра | from/to, rendered rows |
| `money.transaction_list_model` | группировка и виртуальное окно списка | transactions, groups, visible rows |
| `money.transaction_scroll_window` | сводка окна прокрутки виртуального списка | events, total/max callback ms, visible rows |
| `money.mutation` | create/update/delete/transfer до оптимистичного кадра и отдельно до ответа | entity, action, request ms, affected entities, outcome |
| `money.balance_chart_render` | создание/обновление/пересоздание Chart.js графика | trigger, months, account series, dimensions |
| `money.income_chart_render` | создание/обновление/пересоздание Chart.js графика | trigger, months, enabled series, yearly/monthly, dimensions |
| `money.expense_chart_render` | создание/обновление/пересоздание Chart.js графика | trigger, months, enabled series, yearly/monthly, dimensions |

Раздельные `monthly_buckets`, `position_lots` и три модели обязательны: общая входная база не доказывает, что все четыре потребителя одинаково дороги.

## Еда — полный набор верхнеуровневых flows

| Operation | Граница | Атрибуты |
| --- | --- | --- |
| `food.screen_ready` | вход на экран до первого готового дневника/статистики | screen mode, layout, initial date |
| `food.initial_load` | параллельная загрузка каталога, персональных калорий и статистики до готового кадра | cache/server result каждого источника, request ms, catalogue entries, stats days, top products |
| `food.diary_segment_load` | загрузка одного окна дневника до слияния, IndexedDB persist и готового кадра | trigger, offset days, response days, entries, request/render ms |
| `food.diary_cache_hydrate` | IndexedDB-гидратация выбранного дня до готового кадра | hit/miss, entries |
| `food.diary_unified_model` | построение объединённого дневника для UI | days, entries, catalogue entries |
| `food.day_change` | календарь/назад/вперёд/сегодня до готового кадра | trigger, cache hit, segment fetch started, entries |
| `food.diary_mutation` | create/edit/delete entry, delete/restore day, body-weight до оптимистичного кадра и отдельно до ответа | action, affected entries, request ms, outcome |
| `food.realtime_update` | одно входящее изменение дневника до готового кадра | event kind, affected days/entries |
| `food.sync_reload` | sync-status вызвал полную перезагрузку food-данных | sources, request/render ms, result sizes |
| `food.catalogue_load` | получение и публикация каталога | cache/server, entries, request/render ms |
| `food.catalogue_search` | поиск от подтверждённого ввода до отображения результата | local/remote/legacy, query length only, result count, request/render ms |
| `food.catalogue_mutation` | preview/save/delete продукта до готового кадра и ответа | action, request ms, outcome |
| `food.photo_flow` | выбор/съёмка/подтверждение фото до результата анализа | source, image bytes, capture/analysis ms, outcome |
| `food.voice_flow` | start/stop и обработка голосового поиска до результата | audio bytes, recording/transport/result ms, outcome |
| `food.stats_response_apply` | получение статистики до публикации состояния | cache/server, stats days, top products |
| `food.stats_base_model` | подготовка полного дневного массива статистики | days |
| `food.stats_aggregate_week` | построение недельных данных | days, periods |
| `food.stats_aggregate_month` | построение месячных данных | days, periods |
| `food.stats_clipped_model` | выборка/агрегация видимого диапазона | days selected, resulting periods, granularity |
| `food.stats_insights` | расчёт streak, milestones, ribbon и долей top products | days, top products, entries |
| `food.stats_range_change` | slider/quick-range до готового кадра | from/to, selected days, resulting granularity |
| `food.stats_charts_render` | создание, обновление или пересоздание двух Chart.js графиков | trigger, points, granularity, dimensions |
| `food.layout_change` | изменение числа колонок/переход mobile accordion↔desktop grid до готового кадра | from/to, viewport, blocks rendered |
| `food.diary_column_layout` | перерасчёт ширин колонок дневника после изменения записей/аккордеона | entries, measured nodes, elapsed/render ms |

## Что намеренно не выделяется отдельным логом

- Простые валидаторы, форматирование одной строки, отображение одного списка и локальные boolean/computed без обхода коллекций.
- Каждая отдельная функция внутри уже перечисленных flow.
- Обычный HTTP interceptor: сетевое ожидание уже является частью конкретного пользовательского flow.

Их покрывают внешний flow и `app.long_task`. Если первый этап выявит проблему, второй этап добавит узкие вложенные замеры только внутрь конкретной операции.

## Разбор недельных данных

- Сводить p50/p95/max по `operation`, устройству, viewport, маршруту и размеру входа.
- Отдельно сопоставить `renderMs` с `requestMs`: высокий `renderMs` указывает на клиент, высокий `requestMs` при низком `renderMs` — не на слабое устройство.
- Для `long_task` и задержек взаимодействия искать временное совпадение с operation и route.
- Порог проблемности определить по данным после недели; до сбора не объявлять оптимизации, кэширование или рефакторинг.
- По каждому подтверждённому проблемному flow решить: достаточно ли одной верхнеуровневой записи или нужен второй этап с узкими замерами.

## Чеклист

- ✅ Добавить временный клиентский сборщик, контекст устройства и безопасную пакетную доставку.
- ✅ Добавить versioned user-scoped LocalStorage-очередь, 1 MiB limit, стабильные event id и метаданные потерь.
- ✅ Добавить WebSocket batch/ACK типы и отправку только по активным триггерам с минимальным интервалом 10 минут.
- ✅ Добавить общие browser observers и замеры готовности маршрута.
- ✅ Добавить верхнеуровневые замеры metrics: данные, модель dashboard, действия и Chart.js.
- ✅ Добавить верхнеуровневые замеры money: snapshot, экран, модели, действия, графики и список транзакций.
- ✅ Добавить верхнеуровневые замеры food: начальная загрузка, дневник, статистика, каталог, поиск, фото и голосовой ввод.
- ✅ Проверить TypeScript и production build.
- ⭕ Проверить на desktop и телефоне: офлайн, reload до ACK, reconnect, duplicate after lost ACK, disabled server и переполнение очереди.
- ⭕ Проверить, что диагностические события не содержат пользовательские данные и не заметны в UX.
- ⭕ Собрать логи неделю.
- ⭕ Свести результаты, выбрать места второго этапа.
- ⭕ Удалить весь временный сборщик, WebSocket transport и вызовы после исследования.
