# Аудит метрик Spread Capture Bot V4 — бот ↔ каталог MegaApp

Scope: `spread-capture-bot-v4` (прод: remote candidate feed от Live Books Fetcher, `LIVE_BOOKS_CANDIDATES_URL` задан). Каталог — `metrics-catalog.spread-capture-bot-v4.ts`. V3 не затронут.

## Метод

- Все точки эмиссии в боте: `RecordGauges`/`RecordCounters` (reconcile, catalog, redeem, metrics, main) + динамические имена (`reconcile_failures_<phase>`, `<side>_*` из exec-фактов, `ws_user_<kind>_total`, `cycle_chunk_*_{avg,max}`, `process_cpu_ratio_*`).
- Сверка набора имён: эмитируется ↔ каталог (живые) ↔ каталог (removed).
- Сверка описаний с кодом: решения (`DecideBuy/SellAction`), факты (`executor.go`), коллектор, valuation sweep, feed, redeem, fetcher.
- Особенности коллектора, влияющие на чтение графиков: нулевые значения не экспортируются; `gauges_stale_minutes` при отсутствии свежих гейджей.

## Итог по именам

- Эмитируется: ~170 имён. После правок каталог = эмитируемый набор 1:1, расхождений нет (проверено скриптом, дублей нет).
- Возвращены из Removed (бот снова шлёт с plans/34): `estimated_open_positions_value`, `estimated_account_value`, `open_positions_{no_book,empty_bid,partial_depth}_count`, `open_positions_uncovered_shares`.
- Были в `Не в каталоге`, добавлены (35 метрик):
  - Account Value: `open_positions_stale_book_count`, `_book_age_max_s`, `_top_level_only_value`, `_own_excluded_usd`, `book_ts_regress_total`, `book_hash_flipflop_total`.
  - Event Layer: `order_events_{total,applied,removed,parse_failed}`.
  - Candidate Feed (новая группа): `candidate_source_remote`, `candidate_feed_{refresh_ms,generation,age_ms,tokens,unchanged,errors}`.
  - Redeem (новая группа): `redeem_sweep_{redeemable_found,redeemed_total,failed_total,fetch_failed_total,ms}`.
  - Buy/Sell API-факты: `<side>_place_{confirmed,rejected,blocked_invalid_request}`, `<side>_cancel_{confirmed,transport_error}`, `sell_exchange_rejected_insufficient_balance`.
  - Pulse/Process: `gauges_stale_minutes`, `process_goroutines`.
- Removed (31): мёртвые, ничего не эмитит. `hot_batch_max_wait_fired_total`, `hot_batch_queue_depth` стояли в Event Layer с флагом removed — перенесены в Removed, заметка исправлена (ссылалась на сама-removed метрику).

## Ошибки описаний, исправленные по коду

- `blacklisted_entries`, `buy_stop_entry_blacklisted`: писали «нехватка баланса, убирается автоматически». По коду — только `tick_size_violation` / `invalid_token_id`, выхода из списка нет до рестарта.
- `buy_stop_capital_preservation`, `capital_preservation_active`: счётчик считает решения по каждому токену при каждой проверке, а не массовые отмены; массовые отмены идут в `buy_cancel_confirmed`. Флаг — нулевая ступень `CASH_PRICE_LADDER`, не абстрактный «мало баланса».
- `sell_stop`, `sell_stop_no_inventory`: «единственная причина»/«отменил» неверно. Считается решение при каждой проверке токена без позиции (в т.ч. кандидатов) + чёрный список продаж без своей метрики.
- `buy_place/replace/keep`, `sell_place/replace/keep`: это счётчики решений, не успешных постановок; факты — `*_place_confirmed`, `trade_post`.
- `trade_cancel`: переустановка до конца = один `trade_post`, отмена внутри неё не считается.
- `sell_dust_liquidation_attempted_shares`: «раз в несколько минут» → часовой dust-sweep, FAK-продажа; решение входит в `sell_place` независимо от результата.
- `candidates_stage2_effective_spread_{avg,min}_pts`: кандидаты без посчитанного спреда входили как 0 (описание говорило «только с посчитанным»); описание приведено к исправленному поведению бота.
- `discovery_prices_ms`: «батчи по 200, 20 воркеров» — константы локального discovery; в проде это первый sweep котировок Fetcher-а. `discovery_errors`: счётчик сбоев, не «подряд».
- `free_cash`, `collateral_balance`: «зарезервировано под ордера» в коде нет — `min(balance, allowance)`.
- `duplicate_orders_cancel_failed`: транспортная ошибка + пауза токена, не «ошибка биржи».
- `*_backoff_active`, `*_blocked_backoff`: триггер — только `exchange_rejected`, пауза по Фибоначчи до суток, сброс успешной постановкой.
- `cycle_errors`: включает reconcile-сбои и неудачные отмены дублей.
- `entry_price_ceiling_pts`: ноль не экспортируется — блокировка видна как пропуск.
- «в этом цикле» → «за эту минуту» в ~40 описаниях счётчиков (цикла как единицы больше нет).

## Агрегация час/день: источник правды — Flatline

- Часы и дни считает Flatline (`aggregation_registry.go`) по минутным точкам; поле `aggregation` в каталоге фронта влияет только на 5-минутные карточки и там всё, кроме `max`, усредняется. Расхождение каталог ↔ Flatline не баг; каталог не трогаем.
- Реестр общий для всех сервисов, включая живой V3 (`worklist_*`, `catalog_candidates`, `discovery_dropped_*`, `no_mutation_streak` — записи V3, не удалять).
- Нулевые значения не экспортируются → для «нормально 0» метрик `last` показывает устаревшее ненулевое, `avg` — среднее только по минутам с проблемой.
- Правки реестра действуют только на будущие rollup-и.

Предложение по реестру (сейчас, везде default `avg`, если не сказано иное):
- → `sum`: `book_ts_regress_total`, `book_hash_flipflop_total` (счётчики).
- → `last`: `candidate_feed_generation` (номер); `orders_{buy,sell}_{shares,unique}` (родня `orders_buy`, который `last`); `candidates_stage1_total`, 7 × `candidates_stage1_dropped_*`, `candidate_feed_tokens` (раньше были `last` под именами V3); `candidates_stage2_total`, `legacy_positions`, `sell_coverage_{covered,uncovered}_shares` (одна выборка прохода с `books_missing`); `open_positions_top_level_only_value`, `open_positions_own_excluded_usd` (разложение `estimated_open_positions_value`).
- → `max`: `buy_backoff_active`, `sell_backoff_active`, `capital_preservation_active`, `trading_halted`, `gauges_stale_minutes`, `orders_{buy,sell}_duplicates`, `open_positions_book_age_max_s`; из `last` в `max`: `pending_confirmation_tokens`, `export_pending_snapshots`.
- Остальное верно: счётчики `sum`, длительности `avg`, деньги и размеры `last`, `orders_sell` `max` (решение владельца).
- Системный корень (исправлен в боте): коллектор не писал нулевые гейджи; теперь пишет — `last`/`avg` честны для всех гейджей.
- Все правки реестра применены, тесты Flatline зелёные; деплой Flatline за владельцем.

## Бот

- `candidates_stage2_effective_spread_{avg,min}_pts`: кандидаты без измеримого спреда (нет стакана / слишком глубокая очередь) больше не входят в среднее и минимум (`EffectiveSpreadKnown`).
- Коллектор экспортирует гейджи и при значении 0 (счётчики с нулём по-прежнему пропускаются).
- Тесты зелёные, деплой за владельцем.

## Прочее

- V3 (`metrics-catalog.spread-capture-bot.ts`) не трогаем по решению владельца.

## Чеклист

- ✅ Собрать все эмитируемые имена бота
- ✅ Сверить с каталогом, расхождений по именам нет
- ✅ Вернуть 6 ложно-removed метрик, переписать описания под plans/34
- ✅ Добавить 35 неописанных метрик
- ✅ Исправить описания, противоречащие коду
- ✅ `tsc --noEmit` чисто
- ✅ Бот: не усреднять нули кандидатов без спреда
- ✅ Бот: экспорт нулевых гейджей
- ✅ Правки реестра Flatline + тесты
- ⭕ Задеплоить бота и Flatline (владелец)
