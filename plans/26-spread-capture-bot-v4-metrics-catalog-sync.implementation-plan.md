# Sync метрик-каталога Spread Capture Bot V4 — implementation plan

Scope: только `spread-capture-bot-v4` (`metrics-catalog.spread-capture-bot-v4.ts`). V3 (`metrics-catalog.spread-capture-bot.ts`) не трогаем — отдельная задача, если понадобится.

## Цель

Каталог на фронте разошёлся с бэком по двум причинам:
1. **Свежий рефакторинг** (планы 15 и 16 в `spread-capture-bot-v4`) — убрал зависимость V4 от V3-каталога (свой Gamma-discovery), переименовал часть метрик под stage1/stage2-модель, добавил live-проверку эффективного спреда.
2. **Давний дрейф** — метрики из более старых планов (04, 05, 07, 09, 10) годами уходят в `Не в каталоге`, никогда не были описаны нормально.

Плюс: спроектировать блок «Удалённые метрики» — сейчас каталог умеет показывать метрики, которых в нём нет (`Не в каталоге`), но не умеет показывать метрики, которые в нём ЕСТЬ, а бэк их больше не шлёт.

## Текущее устройство

- Бэк пушит метрики двумя источниками: `catalog/discovery.go` (раз в `DiscoveryInterval`, ~30 мин) и `reconcile/loop.go` (каждый reconcile-цикл). Других источников нет.
- Фронт резолвит метрику по паре `(service, name)` через `metricsServiceDefinition()` (`metrics-catalog.ts`) — плоский `Map` по имени внутри `groups[].metrics[]`.
- `metrics-dashboard.ts` уже умеет показывать метрики, которых нет в каталоге: сравнивает имена реально пришедших точек с `metricsCatalogKnownNames()` и рисует лишние в синтетической группе `Не в каталоге` (`uncatalogued`) в конце списка, с дефолтными label/description/цветом.
- Обратного механизма нет: если метрика есть в каталоге, но бэк её больше не шлёт, она просто отображается пустым графиком в своей группе — ничего не намекает, что это уже история.

## Анализ находок

### Задача 1 — расхождения свежего рефакторинга

**Никакого «переименования» как отдельной операции в коде нет** — технически это всегда delete+add, две независимые записи каталога. Но каждая запись в Removed получает короткую свободную подсказку «теперь смотри X» — это просто текст для тултипа, не формальная классификация. Не нужно заранее решать «чистое это переименование или со сменой смысла» — просто пишем, что по факту верно для конкретной метрики, в одну строку.

**Старые имена → Removed, с подсказкой куда смотреть (план 15 и 16 их убрали или заменили):**

| Старое имя | Подсказка в тултипе |
|---|---|
| `catalog_candidates` | Теперь `candidates_stage1_total` |
| `dropped_no_price` | Теперь `candidates_stage1_dropped_no_price` |
| `dropped_bid_range` | Теперь `candidates_stage1_dropped_bid_range` |
| `dropped_spread` | Теперь `candidates_stage1_dropped_spread` |
| `dropped_volume` | Теперь `candidates_stage1_dropped_volume` |
| `dropped_market_age` | Теперь `candidates_stage1_dropped_market_age` |
| `worklist_ex_candidates` | Теперь `legacy_positions` |
| `dropped_days_to_end` | Теперь `candidates_stage1_dropped_days_to_end` — но уже, рынки без даты вообще выделены в отдельную `candidates_stage1_dropped_missing_dates` |
| `worklist_candidates` | Теперь `candidates_stage2_total` — смысл другой: раньше зеркалило `catalog_candidates`, теперь live-проверка эффективного спреда прямо сейчас |
| `export_fetch_ms` | Замены нет: шаг убран вместе с V3 `/export`, время discovery теперь в `discovery_duration_ms` |
| `v3_occupied_total` | Замены нет: понятие "занято V3" ушло вместе с V3-зависимостью |
| `dropped_v3_occupied` | Замены нет, то же |

**Новые имена, описываются с нуля (планы 15 и 16):**

- `candidates_stage1_total`, `candidates_stage1_dropped_no_price`, `candidates_stage1_dropped_bid_range`, `candidates_stage1_dropped_spread`, `candidates_stage1_dropped_volume`, `candidates_stage1_dropped_market_age`, `candidates_stage1_dropped_days_to_end`, `candidates_stage1_dropped_missing_dates` — грубый фильтр кандидатов (30-минутный снепшот, пересчитывается каждый reconcile-цикл).
- `candidates_stage2_total`, `candidates_stage2_effective_spread_avg_pts`, `candidates_stage2_effective_spread_min_pts` — live-проверка эффективного спреда, диагностические гейджи публикуются только когда есть хоть один кандидат с посчитанным спредом.
- `legacy_positions` — позиции/ордера вне текущих кандидатов, которые бот только закрывает.
- `buy_stop_effective_spread_too_tight` — счётчик buy-решений, остановленных live-проверкой спреда.
- `discovery_dropped_date_like`, `discovery_duration_ms`, `discovery_gamma_ms`, `discovery_collect_ms`, `discovery_prices_ms`, `discovery_merge_ms` — гейджи каждого discovery-цикла.
- `discovery_errors` — счётчик.

**`catalog_markets_total` — имя то же, описание устарело:**

По имени метрика не менялась, но раньше это был размер ответа V3 `/export`, теперь — размер собственного локального Gamma-снепшота V4. Плюс раньше дублировалась пушем из `loop.go` каждую минуту (баг), план 16 это убрал — единственный источник теперь `discovery.go`, раз в ~30 мин. Описание переписывается, сама запись остаётся на месте (это не тот случай, где старое имя исчезло — тут оно просто продолжает жить, но с другим текстом).

### Задача 2 — давний дрейф (метрики из планов 02, 04, 05, 07, 09, 10; никак не связаны со свежим рефакторингом)

Бэк шлёт, каталог не знает — годами живут в `Не в каталоге`:

| Метрика | Тип | Откуда (план) | Смысл |
|---|---|---|---|
| `reconcile_cycles` | counter | база | Сколько reconcile-циклов прошло за минуту |
| `filtered_out` | counter | база | Сколько work-item'ов вырезал debug-фильтр по суффиксу token ID (`TOKEN_ID_FILTER_SUFFIXES`) |
| `duplicate_orders_canceled` | counter | 05, 11 | Сколько дублирующих ордеров бот сам нашёл и отменил за цикл |
| `duplicate_orders_cancel_failed` | counter | 05, 11 | Сколько попыток отмены дубля не удалось |
| `sell_dust_liquidation_attempted_shares` | counter | 07 | Объём (в шеарах), который бот пытался ликвидировать как "пыль" за цикл |
| `buy_exchange_rejected_insufficient_balance` | counter | 04, 09 | Сколько buy-ордеров биржа отклонила именно по insufficient_balance |
| `buy_blocked_backoff` / `sell_blocked_backoff` | counter | 10 | Сколько раз сторона была заблокирована активным backoff-таймером после серии ошибок |
| `buy_backoff_active` / `sell_backoff_active` | gauge | 10 | Сколько токенов сейчас под активным backoff по этой стороне |
| `reconcile_failures_fetch_account` / `reconcile_failures_fetch_books` | counter | база | Разбивка уже каталогизированного `reconcile_failures` по фазе, на которой цикл сорвался |
| `open_positions_no_book_count` | gauge | 02 | Сколько открытых позиций не удалось оценить — стакана не было вообще |
| `open_positions_empty_bid_count` | gauge | 02 | Сколько открытых позиций не удалось оценить — стакан пуст на нужной стороне |
| `open_positions_partial_depth_count` | gauge | 02 | Сколько позиций оценены только частично — глубины стакана не хватило на весь объём |
| `open_positions_uncovered_shares` | gauge | 02 | Суммарный объём (шеары) вне оценки — риск, что `estimated_open_positions_value` занижена |

Всё это реальные, живые ряды — просто их 15+ лет никто не описал. `sell_place`/`sell_keep`/... и подобные из тех же старых планов уже каталогизированы корректно, дрейф не тотальный, а точечный.

### Механизм «Удалённые метрики» — отсутствует, нужно спроектировать

Требования:
- Метрика должна оставаться распознаваемой (лейбл/описание/цвет резолвятся), чтобы старые сохранённые точки (если вдруг остались в ретеншене) не проваливались в общий `Не в каталоге`.
- Явно, декларативно — не выводить «удалённость» из отсутствия свежих точек. Инференс по данным ненадёжен: метрика могла просто не сработать в этом окне (нулевые значения не экспортируются коллектором), сервис мог быть недавно перезапущен, окно графика — короткое. Ложно пометить живую метрику «удалённой» — хуже, чем не пометить вовсе.
- Значит: пометка живёт в самом каталоге, рядом с определением метрики — автор рефакторинга руками помечает то, что реально выпилил из бэка, в тот же момент, когда переносит метрику в этот статус.
- Вместе с пометкой — короткая свободная строка-подсказка, куда теперь смотреть вместо этой метрики (или что замены нет). Показывается в тултипе карточки в группе Removed. Не обязательна к заполнению (метрика без явной замены — просто без подсказки), но полезна почти всегда, поэтому заполняем для каждой из 12.
- Отображение: отдельная группа в конце списка (по аналогии с уже существующей `Не в каталоге`, тот же приглушённый визуальный стиль), с чётко другой подписью — не путать «мы не знаем, что это» с «это мы знаем, но оно больше не собирается».
- Метрика, помеченная удалённой, пропадает из своей обычной группы и переезжает целиком в группу «Удалено» — не дублируется в двух местах.

## Предлагаемая новая структура каталога `spread-capture-bot-v4`

| Группа | Что входит |
|---|---|
| **Pulse** (без изменений + добавить) | `free_cash`, `estimated_open_positions_value`, `estimated_account_value`, `cycle_errors`, `reconcile_failures`, `reconcile_failures_fetch_account`, `reconcile_failures_fetch_books`, `books_missing`, `blacklisted_entries`, `no_mutation_streak`, `reconcile_cycles`, `open_positions_no_book_count`, `open_positions_empty_bid_count`, `open_positions_partial_depth_count`, `open_positions_uncovered_shares` |
| **Performance** (убрать `export_fetch_ms`) | `fetch_ms`, `books_ms`, `reconcile_ms`, `cycle_duration_ms` |
| **Discovery** (новая группа) | `catalog_markets_total` (переезжает сюда из market), `discovery_dropped_date_like`, `discovery_duration_ms`, `discovery_gamma_ms`, `discovery_collect_ms`, `discovery_prices_ms`, `discovery_merge_ms`, `discovery_errors` |
| **Candidates & Worklist** (переименована из "Markets and Candidates", `v3_occupied_total` убран) | `candidates_stage1_total`, `candidates_stage2_total`, `candidates_stage2_effective_spread_avg_pts`, `candidates_stage2_effective_spread_min_pts`, `legacy_positions`, `filtered_out` |
| **Drop Reasons** (без переименования, stage1-состав) | `candidates_stage1_dropped_no_price`, `candidates_stage1_dropped_bid_range`, `candidates_stage1_dropped_spread`, `candidates_stage1_dropped_volume`, `candidates_stage1_dropped_days_to_end`, `candidates_stage1_dropped_missing_dates`, `candidates_stage1_dropped_market_age` (`dropped_v3_occupied` убран) |
| **Orders and Trades** (без изменений + добавить) | `orders_total`, `orders_buy`, `orders_sell`, `trade_post`, `trade_cancel`, `duplicate_orders_canceled`, `duplicate_orders_cancel_failed` |
| **Buy Actions** (без изменений + добавить) | 13 текущих + `buy_blocked_backoff`, `buy_backoff_active`, `buy_exchange_rejected_insufficient_balance`, `buy_stop_effective_spread_too_tight` |
| **Sell Actions** (без изменений + добавить) | 12 текущих + `sell_blocked_backoff`, `sell_backoff_active`, `sell_dust_liquidation_attempted_shares` |
| **Removed** (новая, синтетический признак `removed`) | `export_fetch_ms`, `v3_occupied_total`, `dropped_v3_occupied`, `catalog_candidates`, `dropped_no_price`, `dropped_bid_range`, `dropped_spread`, `dropped_volume`, `dropped_days_to_end`, `dropped_market_age`, `worklist_candidates`, `worklist_ex_candidates` |

Каждая новая метрика получает описание с нуля, аналогичное по стилю уже существующим (что означает, откуда берётся, что означает ноль/большое число) — без готовых текстов в этом документе, пишутся при реализации. Никаких перекрёстных ссылок «раньше называлась X» в новых описаниях не требуется.

## Изменения по слоям

- **`metrics-catalog-metric.ts`**: `MetricConfig` получает признак "удалена" + необязательную свободную строку-подсказку ("теперь смотри X" / "замены нет"). Никакой более сложной структуры (отдельно reason/replacedBy) не нужно — одна строка текста для тултипа.
- **`metrics-catalog.spread-capture-bot-v4.ts`**: применить новую раскладку групп из таблицы выше; 12 старых имён помечаются `removed` с подсказкой из таблицы выше и переезжают в конец файла (запись не удаляется физически — иначе их историчные точки, если остались, провалятся в общий "Не в каталоге"); новые имена заводятся как отдельные записи; `catalog_markets_total` остаётся на месте с переписанным описанием.
- **`metrics-catalog.ts`**: `buildCatalog()` продолжает индексировать помеченные `removed` метрики в `byName` (лейбл/юнит/цвет должны резолвиться и для них).
- **`metrics-dashboard.ts`**: при сборке `groups` — метрики с признаком `removed` исключаются из своей исходной группы и собираются в отдельную синтетическую группу `Removed` в конце (рядом с уже существующей `Не в каталоге`, тем же приёмом).

## Чеклист

- ✅ Добавить в `MetricConfig` признак `removed` + необязательную строку-подсказку
- ✅ В `metrics-dashboard.ts` выделять помеченные метрики в синтетическую группу `Removed`, убирая их из штатных групп
- ✅ Пометить `removed` 12 старых имён с подсказкой из таблицы выше, переместить их записи в конец файла каталога
- ✅ Завести с нуля новые имена: `candidates_stage1_total` + 7 `candidates_stage1_dropped_*`, `candidates_stage2_total` + 2 diagnostic-гейджа, `legacy_positions`, `buy_stop_effective_spread_too_tight`, 6 discovery-гейджей + `discovery_errors`
- ✅ Переписать описание `catalog_markets_total` — убрать упоминание V3 `/export`, перенести в новую группу Discovery
- ✅ Добавить 12 давно-задрифтовавших метрик из таблицы задачи 2 в соответствующие группы (pulse/orders/buy/sell)
- ✅ Переименовать группу `market`→`candidates` (id и label)
- ✅ Прогнать фронт (`tsc --noEmit`, `ng build --configuration dev`) — чисто, без ошибок. Линт не настроен в проекте (нет `eslint.config.js`/скрипта `lint`) — пропущено. Визуальная проверка в браузере не проводилась (правило проекта: не использовать browser-инструменты для верификации)

### Пост-релизные правки (обнаружено пользователем на живом дашборде)

- ✅ Баг: два блока `Removed` на дашборде. Причина — синтетическая группа `id: 'removed'` в самом файле каталога тоже проходит через обычный `groups.map()` в `metrics-dashboard.ts` и после вычитки `removed`-карточек остаётся пустой, но всё равно рендерится; настоящий контент рисует отдельный синтетический проход. Фикс — `.filter((group) => group.cards.length > 0)` после `.map()` в `metrics-dashboard.ts`, убирает любую опустевшую группу, не только эту.
- ✅ Аудит пропустил инфраструктурный источник метрик `metrics/exporter.go` (не только `loop.go`+`discovery.go`) — `heartbeat` (отметка живости процесса, шлётся автоматически коллектором для любого сервиса) и `export_pending_snapshots` (бэклог неподтверждённых снепшотов на отправку) реальны и добавлены в группу Pulse.
- ✅ Баг форматирования: `formatCountValue()` в `metric-units.ts` отдавал сырой `toString()` без округления для любого count-значения ≥1000 (не только для v4 — общий баг форматтера). Фикс: всегда округлять нецелые значения до 1 знака после запятой, независимо от величины.
- ✅ Переписаны непонятные описания — в первую очередь 4 метрики `Open Positions: *` (включая `Uncovered Shares`, из-за которой поднялся вопрос) — конкретными терминами вместо инсайдерского жаргона. Убраны голые имена env-переменных (`TOKEN_ID_FILTER_SUFFIXES`, `DUST_SWEEP_INTERVAL`, `MIN_ENTRY_SPREAD_PTS`, `MIN_ENTRY_SPREAD_EFFECTIVE_PTS`, `MinExitPricePts`) из ещё 5 описаний.
- ✅ Реструктуризация групп по итогам анализа (подтверждено пользователем):
  - Новая группа **Account Value** — деньги и качество их оценки вынесены из Pulse (`free_cash`, `estimated_open_positions_value`, 4 метрики `Open Positions: *`, `estimated_account_value`).
  - **Pulse** сужен до здоровья цикла (`cycle_errors`, `reconcile_*`, `no_mutation_streak`, `export_pending_snapshots`, `heartbeat`).
  - `books_missing` перенесён в **Candidates and Worklist** (данные о рабочем списке, не общее здоровье).
  - `blacklisted_entries` перенесён в **Buy Actions**, рядом с `buy_backoff_active` — оба гейджа "сколько рынков сейчас под ограничением на покупку".
  - **Buy Actions** (19) разбит на `Buy Actions` (итоги, 7) + **Buy: Reasons** (разбивка причин, 12) — по паттерну Candidates/Drop Reasons.
  - **Sell Actions** (16) разбит на `Sell Actions` (итоги, 7) + **Sell: Reasons** (разбивка причин, 8).
  - Итоговый порядок групп: Account Value → Pulse → Performance → Discovery → Candidates and Worklist → Drop Reasons → Orders and Trades → Buy Actions → Buy: Reasons → Sell Actions → Sell: Reasons → Removed.
- ✅ `tsc --noEmit` + `ng build --configuration dev` — чисто после всех правок.
