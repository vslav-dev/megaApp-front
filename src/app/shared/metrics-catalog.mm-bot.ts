import { MetricColor } from '@app/shared/metric-colors';
import { metric, MetricsServiceDefinition } from '@app/shared/metrics-catalog-metric';

// mm-bot — reward-farming POC на Polymarket (mm-bot/plans/05-reward-farming-poc.implementation-plan.md).
// Не предсказывает цену рынка: читает листинг Polymarket Liquidity Rewards, входит в узкую
// ценовую полосу почти на всех подходящих по бюджету рынках, держит позицию через buy/flip-to-sell
// цикл. Источник дохода — Liquidity Rewards + Maker Rebates; сама торговля (спред) в среднем
// убыточна из-за adverse selection, это ожидаемо и заложено в гипотезу POC. Терминология и разбивка
// причин — mm-bot/plans/06-unified-observability.implementation-plan.md. Отдельный кошелёк
// (FUNDER_ADDRESS), не пересекается со spread-capture-bot v3/v4.
export const MM_BOT_METRICS_DEFINITION: MetricsServiceDefinition = {
  service: 'mm-bot',
  groups: [
    {
      id: 'pulse',
      label: 'Pulse',
      metrics: [
        metric('heartbeat', {
          label: 'Heartbeat',
          aggregation: 'last',
          integerValued: true,
          description:
            'Техническая отметка живости процесса — 1 в каждом минутном снепшоте, независимо от торговой активности.',
        }),
        metric('cycle_errors', {
          label: 'Cycle Errors',
          color: MetricColor.Red600,
          aggregation: 'sum',
          integerValued: true,
          description:
            'Сколько раз за минуту попытка place/cancel/replace на бирже закончилась ошибкой. Ноль — все попытки прошли успешно.',
        }),
        metric('reconcile_failures', {
          label: 'Reconcile Failures',
          color: MetricColor.Red600,
          aggregation: 'sum',
          integerValued: true,
          description:
            'Сколько раз попытка обработать чанк round-robin, dust-sweep или обновить account-state вообще не смогла начаться (не загрузились базовые данные). Разбивка по причине — в reconcile_failures_cycle_chunk/_dust_sweep_reconcile/_account_state_refresh.',
        }),
        metric('reconcile_failures_cycle_chunk', {
          label: 'Reconcile Failures: Cycle Chunk',
          color: MetricColor.Red600,
          aggregation: 'sum',
          integerValued: true,
          description:
            'Из reconcile_failures — сорвалась загрузка стаканов/reconcile одного REST-чанка (≤BOOKS_CHUNK_SIZE токенов) round-robin обхода.',
        }),
        metric('reconcile_failures_dust_sweep_reconcile', {
          label: 'Reconcile Failures: Dust Sweep',
          color: MetricColor.Red600,
          aggregation: 'sum',
          integerValued: true,
          description:
            'Из reconcile_failures — сорвался часовой проход dust-sweep (ликвидация мусорных остатков позиций).',
        }),
        metric('reconcile_failures_account_state_refresh', {
          label: 'Reconcile Failures: Account State',
          color: MetricColor.Red600,
          aggregation: 'sum',
          integerValued: true,
          description:
            'Из reconcile_failures — сорвалось обновление account-state (баланс/позиции/ордера). Кэш остаётся устаревшим до следующего успешного обновления.',
        }),
        metric('trading_halted', {
          label: 'Trading Halted',
          color: MetricColor.Red600,
          aggregation: 'last',
          integerValued: true,
          description:
            'Глобальный стоп-гейт: 1, если биржа недавно отвечала 503 достаточно часто, чтобы бот приостановил новые place/replace — 0 в норме.',
        }),
        metric('ms_since_last_mutation', {
          label: 'Time Since Last Mutation (ms)',
          color: MetricColor.Amber600,
          aggregation: 'last',
          unit: 'durationMs',
          description:
            'Сколько миллисекунд прошло с последнего реального изменения ордера на бирже (подтверждённые place/cancel). Устойчиво растущее значение (часы) — бот давно ничего не меняет на бирже.',
        }),
      ],
    },
    {
      id: 'account-value',
      label: 'Account Value',
      metrics: [
        metric('free_cash', {
          label: 'Free Cash',
          color: MetricColor.Green600,
          unit: 'money',
          aggregation: 'last',
          description:
            'Сколько живых денег (USD) свободно на счету прямо сейчас — не потрачено на позиции, не зарезервировано под открытые ордера.',
        }),
        metric('collateral_balance', {
          label: 'Collateral Balance',
          color: MetricColor.Green600,
          unit: 'money',
          aggregation: 'last',
          description:
            'Сырой баланс USDC на счету, до вычета allowance-cap. Используется для расчёта entry_price_ceiling_pts по CASH_PRICE_LADDER.',
        }),
        metric('entry_price_ceiling_pts', {
          label: 'Entry Price Ceiling (pts)',
          color: MetricColor.Lime600,
          aggregation: 'last',
          integerValued: true,
          description:
            'Capital halt-gate: текущий потолок цены входа в пунктах, вычисленный по лестнице CASH_PRICE_LADDER на основе collateral_balance — чем меньше свободных денег, тем ниже потолок, вплоть до полной блокировки новых покупок на нулевой ступени. Не путать с ENTRY_PRICE_BAND_LOW/HIGH — это отдельный, независимый ценовой фильтр входа.',
        }),
        metric('estimated_account_value', {
          label: 'Estimated Account Value',
          color: MetricColor.Green600,
          unit: 'money',
          aggregation: 'last',
          description:
            'free_cash + оценочная стоимость открытых позиций по последним закэшированным стаканам (estimated_open_positions_value).',
        }),
        metric('estimated_open_positions_value', {
          label: 'Estimated Open Positions Value',
          color: MetricColor.Green600,
          unit: 'money',
          aggregation: 'last',
          description:
            'Оценочная ликвидационная стоимость всех открытых позиций по последним закэшированным bid-стаканам (не REST-запрос — считается из книг, уже загруженных обычным round-robin/dust-sweep проходом).',
        }),
        metric('open_positions_no_book_count', {
          label: 'Open Positions: No Book',
          color: MetricColor.Amber600,
          aggregation: 'last',
          integerValued: true,
          description:
            'Сколько открытых позиций сейчас вообще без закэшированного стакана — их стоимость посчитать нельзя, оценка занижена на их объём.',
        }),
        metric('open_positions_empty_bid_count', {
          label: 'Open Positions: Empty Bid',
          color: MetricColor.Amber600,
          aggregation: 'last',
          integerValued: true,
          description:
            'Сколько открытых позиций сейчас со стаканом, но без единой bid-заявки в нём — фактически неликвидируемая позиция на этот момент.',
        }),
        metric('open_positions_partial_depth_count', {
          label: 'Open Positions: Partial Depth',
          color: MetricColor.Amber600,
          aggregation: 'last',
          integerValued: true,
          description:
            'Сколько открытых позиций крупнее суммарной глубины bid-стороны стакана — при реальной продаже пришлось бы просаживать цену ниже топ-бида.',
        }),
        metric('open_positions_uncovered_shares', {
          label: 'Open Positions: Uncovered (shares)',
          color: MetricColor.Amber600,
          aggregation: 'last',
          description:
            'Суммарный объём в контрактах, не покрытый живой заявкой на продажу — сумма по всем позициям, не по одному рынку.',
        }),
        metric('open_positions_stale_book_count', {
          label: 'Open Positions: Stale Book',
          color: MetricColor.Amber600,
          aggregation: 'last',
          integerValued: true,
          description:
            'Сколько открытых позиций оценены по стакану старше трёх интервалов VALUATION_SWEEP_INTERVAL — токен давно выпал из worklist round-robin обхода или его books-запрос стабильно падает.',
        }),
      ],
    },
    {
      id: 'rewards',
      label: 'Rewards & Rebates',
      metrics: [
        metric('liquidity_rewards_today_usd', {
          label: 'Liquidity Rewards: Today',
          color: MetricColor.Teal700,
          unit: 'money',
          aggregation: 'last',
          description:
            'Главный сигнал гипотезы POC — сколько $ Liquidity Rewards Polymarket начислил за сегодня (UTC), читается напрямую из /rewards/user/total. Обычно $0 до вечернего сеттлмента — важна не величина, а то, что поллинг стабильно идёт без rewards_poll_failed.',
        }),
        metric('liquidity_rewards_yesterday_usd', {
          label: 'Liquidity Rewards: Yesterday',
          color: MetricColor.Teal700,
          unit: 'money',
          aggregation: 'last',
          description:
            'То же самое за вчера (UTC) — надёжный, уже settled ориентир, пока сегодняшняя цифра ещё копится.',
        }),
        metric('maker_rebates_today_usd', {
          label: 'Maker Rebates: Today',
          color: MetricColor.Teal500,
          unit: 'money',
          aggregation: 'last',
          description:
            'Второстепенный источник дохода POC — сколько $ Maker Rebates начислено за сегодня (UTC), читается из /rebates/current.',
        }),
        metric('maker_rebates_yesterday_usd', {
          label: 'Maker Rebates: Yesterday',
          color: MetricColor.Teal500,
          unit: 'money',
          aggregation: 'last',
          description: 'То же самое за вчера (UTC).',
        }),
        metric('rewards_poll_success_total', {
          label: 'Rewards Poll Success',
          color: MetricColor.Teal700,
          aggregation: 'sum',
          integerValued: true,
          description:
            'Сколько раз за минуту опрос rewards/rebates (REWARDS_POLL_INTERVAL) прошёл полностью успешно, все 4 запроса.',
        }),
        metric('rewards_poll_partial_failure_total', {
          label: 'Rewards Poll Partial Failure',
          color: MetricColor.Red600,
          aggregation: 'sum',
          integerValued: true,
          description:
            'Сколько раз хотя бы один из 4 запросов опроса rewards/rebates закончился ошибкой — предыдущие успешные гейджи в этом случае не перезаписываются.',
        }),
      ],
    },
    {
      id: 'reward-markets',
      label: 'Reward Markets Scan',
      metrics: [
        metric('reward_markets_scan_success_total', {
          label: 'Reward Markets Scan Success',
          color: MetricColor.Cyan700,
          aggregation: 'sum',
          integerValued: true,
          description:
            'Сколько раз periodic-скан листинга Polymarket Liquidity Rewards (REWARD_MARKETS_RESCAN_INTERVAL, по умолчанию 15 минут) успешно завершился и обновил кэш.',
        }),
        metric('reward_markets_scan_failed_total', {
          label: 'Reward Markets Scan Failed',
          color: MetricColor.Red600,
          aggregation: 'sum',
          integerValued: true,
          description:
            'Сколько раз скан листинга упал целиком — кэш в этом случае не обновляется, бот продолжает работать по предыдущему.',
        }),
        metric('reward_markets_scan_pool_size', {
          label: 'Reward Markets Pool Size',
          color: MetricColor.Cyan700,
          aggregation: 'last',
          integerValued: true,
          description:
            'Сколько всего строк рынков пришло со всего листинга /rewards/user/markets в последнем скане, до какой-либо фильтрации.',
        }),
        metric('reward_markets_scan_candidates', {
          label: 'Reward Markets Candidates',
          color: MetricColor.Cyan700,
          aggregation: 'last',
          integerValued: true,
          description:
            'Сколько токенов (YES+NO по каждому рынку) прошли грубые фильтры листинга (программа активна, дневная ставка, конкурентность, широкая ценовая полоса) в последнем скане — ещё до точной проверки по живому стакану.',
        }),
        metric('reward_markets_scan_duration_ms', {
          label: 'Reward Markets Scan Duration (ms)',
          color: MetricColor.Violet600,
          aggregation: 'avg',
          unit: 'durationMs',
          description:
            'Сколько миллисекунд занял один полный постраничный обход листинга — тяжёлый запрос, обычно десятки секунд на тысячи рынков.',
        }),
      ],
    },
    {
      id: 'cycle',
      label: 'Candidates, Worklist and Performance',
      metrics: [
        metric('candidates_total', {
          label: 'Candidates Total',
          color: MetricColor.Blue600,
          aggregation: 'last',
          integerValued: true,
          description:
            'Сколько токенов в последнем завершённом проходе round-robin реально прошли точную проверку по живому стакану (is_candidate=true) — из них и формируются buy-решения.',
        }),
        metric('worklist_size', {
          label: 'Worklist Size',
          color: MetricColor.Blue600,
          aggregation: 'last',
          integerValued: true,
          description:
            'Общий размер рабочего списка последнего прохода: кандидаты ∪ свои открытые ордера ∪ инвентарь, до фильтра TOKEN_ID_FILTER_SUFFIXES.',
        }),
        metric('filtered_out', {
          label: 'Filtered Out',
          color: MetricColor.Slate500,
          aggregation: 'sum',
          integerValued: true,
          description:
            'Сколько токенов за минуту отсечено отладочным TOKEN_ID_FILTER_SUFFIXES — используется, чтобы временно погонять бота на узком подмножестве рынков. Ноль — фильтр выключен.',
        }),
        metric('books_missing', {
          label: 'Missing Books',
          color: MetricColor.Cyan600,
          aggregation: 'last',
          integerValued: true,
          description:
            'Сколько токенов в последнем проходе не удалось получить стакан — без него решение по токену не принимается, он пропускается в этом проходе.',
        }),
        metric('reconcile_cycles', {
          label: 'Reconcile Cycles',
          color: MetricColor.Blue600,
          aggregation: 'sum',
          integerValued: true,
          description:
            'Сколько полных проходов round-robin обхода всего worklist бот завершил за минуту (ограничено снизу MIN_CYCLE_INTERVAL).',
        }),
        metric('cycle_chunks_total', {
          label: 'Cycle Chunks',
          color: MetricColor.Blue600,
          aggregation: 'sum',
          integerValued: true,
          description: 'Сколько REST-чанков (≤BOOKS_CHUNK_SIZE токенов) round-robin обход обработал за минуту.',
        }),
        metric('cycle_duration_ms', {
          label: 'Cycle Duration (ms)',
          color: MetricColor.Violet600,
          aggregation: 'avg',
          unit: 'durationMs',
          description:
            'Сколько миллисекунд занял один полный проход round-robin обхода всего worklist, от старта до последнего чанка.',
        }),
        metric('cycle_chunk_size_avg', {
          label: 'Cycle Chunk Size: Avg',
          color: MetricColor.Blue600,
          aggregation: 'avg',
          integerValued: true,
          description: 'Средний размер REST-чанка за минуту — обычно близко к BOOKS_CHUNK_SIZE.',
        }),
        metric('cycle_chunk_size_max', {
          label: 'Cycle Chunk Size: Max',
          color: MetricColor.Blue400,
          aggregation: 'max',
          integerValued: true,
          description: 'Самый большой REST-чанк за минуту.',
        }),
        metric('cycle_chunk_ms_avg', {
          label: 'Cycle Chunk Duration: Avg (ms)',
          color: MetricColor.Violet600,
          aggregation: 'avg',
          unit: 'durationMs',
          description: 'Средняя длительность обработки одного чанка за минуту (стаканы + принятие решений).',
        }),
        metric('cycle_chunk_ms_max', {
          label: 'Cycle Chunk Duration: Max (ms)',
          color: MetricColor.Violet400,
          aggregation: 'max',
          unit: 'durationMs',
          description: 'Самая долгая обработка одного чанка за минуту.',
        }),
        metric('cycle_chunk_books_ms_avg', {
          label: 'Cycle Chunk Books: Avg (ms)',
          color: MetricColor.Violet600,
          aggregation: 'avg',
          unit: 'durationMs',
          description: 'Из cycle_chunk_ms_avg — сколько в среднем занял именно REST-запрос /books внутри чанка.',
        }),
        metric('cycle_chunk_books_ms_max', {
          label: 'Cycle Chunk Books: Max (ms)',
          color: MetricColor.Violet400,
          aggregation: 'max',
          unit: 'durationMs',
          description: 'Самый долгий REST-запрос /books внутри одного чанка за минуту.',
        }),
        metric('cycle_chunk_reconcile_ms_avg', {
          label: 'Cycle Chunk Reconcile: Avg (ms)',
          color: MetricColor.Violet600,
          aggregation: 'avg',
          unit: 'durationMs',
          description:
            'Из cycle_chunk_ms_avg — сколько в среднем заняло принятие и исполнение решений по чанку (без загрузки стаканов).',
        }),
        metric('cycle_chunk_reconcile_ms_max', {
          label: 'Cycle Chunk Reconcile: Max (ms)',
          color: MetricColor.Violet400,
          aggregation: 'max',
          unit: 'durationMs',
          description: 'Самое долгое исполнение решений по одному чанку за минуту.',
        }),
      ],
    },
    {
      id: 'dust-sweep',
      label: 'Dust Sweep',
      metrics: [
        metric('dust_sweep_batches_total', {
          label: 'Dust Sweep Batches',
          color: MetricColor.Blue600,
          aggregation: 'sum',
          integerValued: true,
          description:
            'Сколько раз за час прошёл dust-sweep проход, у которого нашлись реальные кандидаты на ликвидацию мусорного остатка.',
        }),
        metric('dust_sweep_size', {
          label: 'Dust Sweep Size',
          color: MetricColor.Blue600,
          aggregation: 'last',
          integerValued: true,
          description: 'Сколько токенов было в последнем dust-sweep проходе.',
        }),
        metric('dust_sweep_ms', {
          label: 'Dust Sweep Duration (ms)',
          color: MetricColor.Violet600,
          aggregation: 'avg',
          unit: 'durationMs',
          description: 'Сколько миллисекунд занял один часовой проход dust-sweep (DUST_SWEEP_INTERVAL).',
        }),
      ],
    },
    {
      id: 'redeem',
      label: 'Redeem',
      metrics: [
        metric('redeem_sweep_redeemed_total', {
          label: 'Redeem: Redeemed',
          color: MetricColor.Green600,
          aggregation: 'sum',
          integerValued: true,
          description:
            'Сколько разрешившихся (resolved) позиций бот успешно закрыл через Relayer за период (REDEEM_INTERVAL).',
        }),
        metric('redeem_sweep_failed_total', {
          label: 'Redeem: Failed',
          color: MetricColor.Red600,
          aggregation: 'sum',
          integerValued: true,
          description: 'Сколько попыток закрыть разрешившуюся позицию закончились ошибкой Relayer.',
        }),
        metric('redeem_sweep_fetch_failed_total', {
          label: 'Redeem: Fetch Failed',
          color: MetricColor.Red600,
          aggregation: 'sum',
          integerValued: true,
          description: 'Сколько раз не удалось даже загрузить список разрешимых позиций — до попытки редима.',
        }),
        metric('redeem_sweep_realized_pnl_total', {
          label: 'Redeem: Realized PnL',
          color: MetricColor.Green600,
          unit: 'money',
          aggregation: 'sum',
          description: 'Суммарный реализованный PnL (USD) по редимнутым за период позициям — может быть отрицательным.',
        }),
        metric('redeem_sweep_redeemable_found', {
          label: 'Redeem: Redeemable Found',
          color: MetricColor.Blue600,
          aggregation: 'last',
          integerValued: true,
          description: 'Сколько разрешимых позиций найдено в последнем redeem-проходе.',
        }),
        metric('redeem_sweep_ms', {
          label: 'Redeem Sweep Duration (ms)',
          color: MetricColor.Violet600,
          aggregation: 'avg',
          unit: 'durationMs',
          description: 'Сколько миллисекунд занял один redeem-проход.',
        }),
      ],
    },
    {
      id: 'account-state',
      label: 'Account State',
      metrics: [
        metric('account_state_refresh_total', {
          label: 'Account State Refreshes',
          color: MetricColor.Blue600,
          aggregation: 'sum',
          integerValued: true,
          description:
            'Сколько раз account-state (баланс/позиции) был успешно обновлён с биржи — по сделке, реконнекту WS, старту или часовому потолку.',
        }),
        metric('account_state_refresh_ms', {
          label: 'Account State Refresh Duration (ms)',
          color: MetricColor.Violet600,
          aggregation: 'avg',
          unit: 'durationMs',
          description: 'Сколько миллисекунд заняло одно обновление account-state.',
        }),
        metric('account_state_pending_confirmation_total', {
          label: 'Account State Pending Confirmation',
          color: MetricColor.Amber600,
          aggregation: 'sum',
          integerValued: true,
          description:
            'Сколько раз токен поставлен на паузу из-за неподтверждённого исхода cancel/replace/place — реальное состояние заявки неизвестно до следующего полного обновления account-state.',
        }),
      ],
    },
    {
      id: 'orders',
      label: 'Orders and Trades',
      metrics: [
        metric('orders_total', {
          label: 'Open Orders',
          color: MetricColor.Blue600,
          aggregation: 'last',
          integerValued: true,
          description: 'Сколько ордеров сейчас реально стоит на бирже, по данным биржи.',
        }),
        metric('orders_buy', {
          label: 'Buy Orders',
          color: MetricColor.Blue600,
          aggregation: 'last',
          integerValued: true,
          description: 'Сколько заявок на покупку сейчас открыто.',
        }),
        metric('orders_sell', {
          label: 'Sell Orders',
          color: MetricColor.Blue600,
          aggregation: 'max',
          integerValued: true,
          description:
            'Сколько заявок на продажу открыто. На минутном графике — текущее значение, на 5-минутных карточках, часовом и дневном — максимум за период.',
        }),
        metric('orders_buy_shares', {
          label: 'Buy Orders: Shares',
          color: MetricColor.Blue600,
          aggregation: 'last',
          description: 'Суммарный объём в контрактах по всем открытым заявкам на покупку.',
        }),
        metric('orders_sell_shares', {
          label: 'Sell Orders: Shares',
          color: MetricColor.Blue600,
          aggregation: 'last',
          description: 'Суммарный объём в контрактах по всем открытым заявкам на продажу.',
        }),
        metric('orders_buy_unique', {
          label: 'Buy Orders: Unique Markets',
          color: MetricColor.Blue400,
          aggregation: 'last',
          integerValued: true,
          description: 'Сколько разных рынков покрыто хотя бы одной заявкой на покупку.',
        }),
        metric('orders_sell_unique', {
          label: 'Sell Orders: Unique Markets',
          color: MetricColor.Blue400,
          aggregation: 'last',
          integerValued: true,
          description: 'Сколько разных рынков покрыто хотя бы одной заявкой на продажу.',
        }),
        metric('orders_buy_duplicates', {
          label: 'Buy Orders: Duplicates',
          color: MetricColor.Amber600,
          aggregation: 'last',
          integerValued: true,
          description:
            'Сколько лишних заявок на покупку сверх одной на рынок стоит сейчас (см. duplicate_orders_canceled).',
        }),
        metric('orders_sell_duplicates', {
          label: 'Sell Orders: Duplicates',
          color: MetricColor.Amber600,
          aggregation: 'last',
          integerValued: true,
          description: 'То же самое для заявок на продажу.',
        }),
        metric('duplicate_orders_canceled', {
          label: 'Duplicate Orders Canceled',
          color: MetricColor.Amber600,
          aggregation: 'sum',
          integerValued: true,
          description: 'Сколько дублирующих ордеров бот сам обнаружил и успешно отменил за минуту.',
        }),
        metric('duplicate_orders_not_confirmed', {
          label: 'Duplicate Orders Cancel Not Confirmed',
          color: MetricColor.Red600,
          aggregation: 'sum',
          integerValued: true,
          description:
            'Сколько попыток отменить дубль биржа не подтвердила. Токен временно приостанавливается до следующего account-state refresh.',
        }),
        metric('duplicate_orders_cancel_failed', {
          label: 'Duplicate Orders Cancel Failed',
          color: MetricColor.Red600,
          aggregation: 'sum',
          integerValued: true,
          description: 'Сколько попыток отменить дубль закончились ошибкой биржи.',
        }),
        metric('blacklisted_entries', {
          label: 'Blacklisted Entries',
          color: MetricColor.Orange600,
          aggregation: 'last',
          integerValued: true,
          description:
            'Сколько рынков сейчас в чёрном списке на покупку — биржа несколько раз подряд отказала (tick_size_violation/invalid_token_id).',
        }),
        metric('trade_post', {
          label: 'Post Actions',
          color: MetricColor.Blue600,
          aggregation: 'sum',
          integerValued: true,
          description: 'Сколько заявок бот реально успешно выставил на биржу за минуту (новых и после переустановки).',
        }),
        metric('trade_cancel', {
          label: 'Cancel Actions',
          color: MetricColor.Blue600,
          aggregation: 'sum',
          integerValued: true,
          description: 'Сколько заявок бот реально успешно отменил на бирже за минуту.',
        }),
        metric('order_events_total', {
          label: 'Order Events',
          color: MetricColor.Cyan700,
          aggregation: 'sum',
          integerValued: true,
          description: 'Сколько событий по своим ордерам пришло с приватного WS-канала за минуту.',
        }),
        metric('order_events_applied', {
          label: 'Order Events: Applied',
          color: MetricColor.Cyan700,
          aggregation: 'sum',
          integerValued: true,
          description: 'Сколько WS-событий по ордерам успешно применено к локальному кэшу.',
        }),
        metric('order_events_removed', {
          label: 'Order Events: Removed',
          color: MetricColor.Cyan700,
          aggregation: 'sum',
          integerValued: true,
          description: 'Сколько ордеров удалено из локального кэша по терминальному WS-событию.',
        }),
        metric('order_events_unknown_status', {
          label: 'Order Events: Unknown Status',
          color: MetricColor.Amber600,
          aggregation: 'sum',
          integerValued: true,
          description:
            'Сколько WS-событий пришло с незнакомым статусом ордера — не должно появляться в здоровом прогоне.',
        }),
        metric('order_events_parse_failed', {
          label: 'Order Events: Parse Failed',
          color: MetricColor.Red600,
          aggregation: 'sum',
          integerValued: true,
          description: 'Сколько WS-сообщений о событии ордера не удалось распарсить.',
        }),
        metric('ws_user_connected_total', {
          label: 'User WS Connected',
          color: MetricColor.Cyan700,
          aggregation: 'sum',
          integerValued: true,
          description: 'Сколько раз приватный user-канал успешно подключился за минуту (включая переподключения).',
        }),
        metric('ws_user_dropped_total', {
          label: 'User WS Dropped',
          color: MetricColor.Red600,
          aggregation: 'sum',
          integerValued: true,
          description: 'Сколько раз приватный user-канал оборвался за минуту.',
        }),
        metric('ws_user_terminal_trade_total', {
          label: 'User WS Terminal Trades',
          color: MetricColor.Blue600,
          aggregation: 'sum',
          integerValued: true,
          description:
            'Сколько терминальных событий сделки (CONFIRMED/FAILED) прислал приватный канал — именно они триггерят обновление account-state.',
        }),
        metric('buy_place_confirmed', {
          label: 'Buy: Place Confirmed',
          color: MetricColor.Orange600,
          aggregation: 'sum',
          integerValued: true,
          description: 'Сколько buy-заявок биржа подтвердила размещёнными за минуту.',
        }),
        metric('sell_place_confirmed', {
          label: 'Sell: Place Confirmed',
          color: MetricColor.Pink600,
          aggregation: 'sum',
          integerValued: true,
          description: 'Сколько sell-заявок биржа подтвердила размещёнными за минуту.',
        }),
        metric('buy_place_rejected', {
          label: 'Buy: Place Rejected',
          color: MetricColor.Red600,
          aggregation: 'sum',
          integerValued: true,
          description: 'Сколько buy-заявок биржа отклонила при размещении.',
        }),
        metric('sell_place_rejected', {
          label: 'Sell: Place Rejected',
          color: MetricColor.Red600,
          aggregation: 'sum',
          integerValued: true,
          description: 'Сколько sell-заявок биржа отклонила при размещении.',
        }),
        metric('buy_exchange_rejected_insufficient_balance', {
          label: 'Buy: Rejected — Insufficient Balance',
          color: MetricColor.Red600,
          aggregation: 'sum',
          integerValued: true,
          description: 'Из buy_place_rejected — сколько именно из-за нехватки свободного баланса на момент размещения.',
        }),
        metric('sell_exchange_rejected_insufficient_balance', {
          label: 'Sell: Rejected — Insufficient Balance',
          color: MetricColor.Red600,
          aggregation: 'sum',
          integerValued: true,
          description: 'Из sell_place_rejected — сколько именно из-за нехватки баланса.',
        }),
        metric('buy_place_not_confirmed', {
          label: 'Buy: Place Not Confirmed',
          color: MetricColor.Red600,
          aggregation: 'sum',
          integerValued: true,
          description:
            'Сколько попыток разместить buy-заявку биржа не подтвердила (исход неясен) — токен приостанавливается до полного обновления account-state.',
        }),
        metric('sell_place_not_confirmed', {
          label: 'Sell: Place Not Confirmed',
          color: MetricColor.Red600,
          aggregation: 'sum',
          integerValued: true,
          description: 'То же самое для sell-заявок.',
        }),
        metric('buy_place_blocked_invalid_request', {
          label: 'Buy: Place Blocked — Invalid Request',
          color: MetricColor.Red600,
          aggregation: 'sum',
          integerValued: true,
          description:
            'Сколько попыток разместить buy-заявку отклонено ещё до отправки — запрос сам по себе невалиден.',
        }),
        metric('sell_place_blocked_invalid_request', {
          label: 'Sell: Place Blocked — Invalid Request',
          color: MetricColor.Red600,
          aggregation: 'sum',
          integerValued: true,
          description: 'То же самое для sell-заявок.',
        }),
        metric('buy_cancel_confirmed', {
          label: 'Buy: Cancel Confirmed',
          color: MetricColor.Orange600,
          aggregation: 'sum',
          integerValued: true,
          description: 'Сколько buy-заявок биржа подтвердила отменёнными.',
        }),
        metric('sell_cancel_confirmed', {
          label: 'Sell: Cancel Confirmed',
          color: MetricColor.Pink600,
          aggregation: 'sum',
          integerValued: true,
          description: 'Сколько sell-заявок биржа подтвердила отменёнными.',
        }),
        metric('buy_cancel_not_confirmed', {
          label: 'Buy: Cancel Not Confirmed',
          color: MetricColor.Red600,
          aggregation: 'sum',
          integerValued: true,
          description: 'Сколько попыток отменить buy-заявку биржа не подтвердила.',
        }),
        metric('sell_cancel_not_confirmed', {
          label: 'Sell: Cancel Not Confirmed',
          color: MetricColor.Red600,
          aggregation: 'sum',
          integerValued: true,
          description: 'То же самое для sell-заявок.',
        }),
        metric('buy_cancel_transport_error', {
          label: 'Buy: Cancel Transport Error',
          color: MetricColor.Red600,
          aggregation: 'sum',
          integerValued: true,
          description:
            'Сколько попыток отменить buy-заявку упало на транспортном уровне (сетевая ошибка, не ответ биржи).',
        }),
        metric('sell_cancel_transport_error', {
          label: 'Sell: Cancel Transport Error',
          color: MetricColor.Red600,
          aggregation: 'sum',
          integerValued: true,
          description: 'То же самое для sell-заявок.',
        }),
        metric('buy_matched_shares_total', {
          label: 'Buy: Matched Shares',
          color: MetricColor.Orange600,
          aggregation: 'sum',
          description:
            'Суммарный объём в контрактах, исполнившийся по buy-заявкам за минуту (по терминальным WS-событиям сделки).',
        }),
        metric('sell_matched_shares_total', {
          label: 'Sell: Matched Shares',
          color: MetricColor.Pink600,
          aggregation: 'sum',
          description: 'Суммарный объём в контрактах, исполнившийся по sell-заявкам за минуту.',
        }),
      ],
    },
    {
      id: 'buy',
      label: 'Buy Actions',
      metrics: [
        metric('buy_place', {
          label: 'Buy Place',
          color: MetricColor.Orange600,
          aggregation: 'sum',
          integerValued: true,
          description: 'Сколько раз за минуту бот впервые поставил новую buy-заявку там, где её раньше не было.',
        }),
        metric('buy_keep', {
          label: 'Buy Keep',
          color: MetricColor.Orange600,
          aggregation: 'sum',
          integerValued: true,
          description: 'Сколько уже стоящих buy-заявок бот оставил без изменений за минуту.',
        }),
        metric('buy_replace', {
          label: 'Buy Replace',
          color: MetricColor.Orange600,
          aggregation: 'sum',
          integerValued: true,
          description: 'Сколько уже стоящих buy-заявок бот переставил за минуту — причина в группе ниже.',
        }),
        metric('buy_replace_reprice', {
          label: 'Buy Replace: Reprice',
          color: MetricColor.Orange600,
          aggregation: 'sum',
          integerValued: true,
          description: 'Из buy_replace — переставлено только из-за смены цены reward-aware формулы, размер не менялся.',
        }),
        metric('buy_replace_rung_topup', {
          label: 'Buy Replace: Rung Topup',
          color: MetricColor.Orange600,
          aggregation: 'sum',
          integerValued: true,
          description:
            'Из buy_replace — переставлено, чтобы добрать размер до целевой доли reward-ступени (target_share/est_share).',
        }),
        metric('buy_blocked', {
          label: 'Buy Blocked',
          color: MetricColor.Orange600,
          aggregation: 'sum',
          integerValued: true,
          description: 'Сколько раз бот хотел поставить/поддержать buy-заявку, но не смог — причина в группе ниже.',
        }),
        metric('buy_blocked_trading_halted', {
          label: 'Buy Blocked: Trading Halted',
          color: MetricColor.Orange600,
          aggregation: 'sum',
          integerValued: true,
          description: 'Из buy_blocked — глобальный стоп-гейт торговли активен.',
        }),
        metric('buy_blocked_backoff', {
          label: 'Buy Blocked: Backoff',
          color: MetricColor.Orange600,
          aggregation: 'sum',
          integerValued: true,
          description: 'Из buy_blocked — рынок сейчас под backoff после недавней серии ошибок.',
        }),
        metric('buy_stop', {
          label: 'Buy Stop',
          color: MetricColor.Orange600,
          aggregation: 'sum',
          integerValued: true,
          description:
            'Сколько buy-заявок бот полностью отменил за минуту, потому что покупать больше не нужно или нельзя.',
        }),
        metric('buy_stop_not_candidate', {
          label: 'Buy Stop: Not Candidate',
          color: MetricColor.Orange600,
          aggregation: 'sum',
          integerValued: true,
          description:
            'Из buy_stop — рынок больше не проходит фильтры кандидатуры (price-band/rate/конкурентность/reward-window).',
        }),
        metric('buy_stop_position_ceiling_reached', {
          label: 'Buy Stop: Position Ceiling Reached',
          color: MetricColor.Orange600,
          aggregation: 'sum',
          integerValued: true,
          description:
            'Из buy_stop — позиция уже достигла потолка (POSITION_CEILING_MULTIPLIER), докупать дальше не нужно.',
        }),
        metric('buy_stop_capital_preservation', {
          label: 'Buy Stop: Capital Preservation',
          color: MetricColor.Orange600,
          aggregation: 'sum',
          integerValued: true,
          description:
            'Из buy_stop — массовая отмена из-за cash-floor guard (CASH_PRICE_LADDER): свободного баланса стало слишком мало.',
        }),
      ],
    },
    {
      id: 'sell',
      label: 'Sell Actions',
      metrics: [
        metric('sell_place', {
          label: 'Sell Place',
          color: MetricColor.Pink600,
          aggregation: 'sum',
          integerValued: true,
          description: 'Сколько раз за минуту бот впервые поставил sell-заявку по купленной позиции без неё.',
        }),
        metric('sell_dust_liquidation_attempted_shares', {
          label: 'Sell: Dust Liquidation Attempted (shares)',
          color: MetricColor.Pink600,
          aggregation: 'sum',
          description:
            'Суммарный объём в контрактах, который бот попытался продать как «пыль» — остаток меньше REWARD_MIN, не покрытый обычной sell-логикой.',
        }),
        metric('sell_keep', {
          label: 'Sell Keep',
          color: MetricColor.Pink600,
          aggregation: 'sum',
          integerValued: true,
          description: 'Сколько уже стоящих sell-заявок бот оставил без изменений за минуту.',
        }),
        metric('sell_replace', {
          label: 'Sell Replace',
          color: MetricColor.Pink600,
          aggregation: 'sum',
          integerValued: true,
          description: 'Сколько уже стоящих sell-заявок бот переставил за минуту (репрайс по midpoint).',
        }),
        metric('sell_blocked', {
          label: 'Sell Blocked',
          color: MetricColor.Pink600,
          aggregation: 'sum',
          integerValued: true,
          description: 'Сколько раз бот хотел поставить/поддержать sell-заявку, но не смог — причина в группе ниже.',
        }),
        metric('sell_blocked_trading_halted', {
          label: 'Sell Blocked: Trading Halted',
          color: MetricColor.Pink600,
          aggregation: 'sum',
          integerValued: true,
          description: 'Из sell_blocked — глобальный стоп-гейт торговли активен.',
        }),
        metric('sell_blocked_backoff', {
          label: 'Sell Blocked: Backoff',
          color: MetricColor.Pink600,
          aggregation: 'sum',
          integerValued: true,
          description: 'Из sell_blocked — рынок сейчас под backoff после недавней серии ошибок.',
        }),
        metric('sell_stop', {
          label: 'Sell Stop',
          color: MetricColor.Pink600,
          aggregation: 'sum',
          integerValued: true,
          description: 'Сколько sell-заявок бот полностью отменил за минуту без переустановки — причина в группе ниже.',
        }),
        metric('sell_stop_no_inventory', {
          label: 'Sell Stop: No Inventory',
          color: MetricColor.Pink600,
          aggregation: 'sum',
          integerValued: true,
          description: 'Из sell_stop — продавать больше нечего, позиция уже распродана.',
        }),
        metric('sell_stop_below_reward_min_waiting', {
          label: 'Sell Stop: Below Reward Min (Waiting)',
          color: MetricColor.Pink600,
          aggregation: 'sum',
          integerValued: true,
          description:
            'Из sell_stop — остаток позиции меньше REWARD_MIN, но рынок ещё в reward-окне, бот ждёт возможности собрать в один лот вместо мгновенной ликвидации.',
        }),
        metric('sell_stop_below_reward_min_no_candidate', {
          label: 'Sell Stop: Below Reward Min (No Candidate)',
          color: MetricColor.Pink600,
          aggregation: 'sum',
          integerValued: true,
          description:
            'Из sell_stop — остаток меньше REWARD_MIN и рынок больше не в reward-окне — ждать нет смысла, уйдёт через dust-sweep.',
        }),
        metric('sell_stop_no_book', {
          label: 'Sell Stop: No Book',
          color: MetricColor.Pink600,
          aggregation: 'sum',
          integerValued: true,
          description: 'Из sell_stop — нет доступного стакана для расчёта безопасной цены продажи.',
        }),
      ],
    },
    {
      id: 'process',
      label: 'Process (Linux only)',
      metrics: [
        metric('process_cpu_ratio_avg', {
          label: 'Process CPU: Avg',
          color: MetricColor.Slate500,
          aggregation: 'avg',
          unit: 'ratio',
          description:
            'Средняя загрузка CPU процессом за минуту (0..1). Только на Linux — на macOS/dev-машине не собирается (process_metrics_disabled).',
        }),
        metric('process_cpu_ratio_max', {
          label: 'Process CPU: Max',
          color: MetricColor.Slate500,
          aggregation: 'max',
          unit: 'ratio',
          description: 'Пиковая загрузка CPU процессом за минуту.',
        }),
        metric('process_rss_bytes', {
          label: 'Process RSS',
          color: MetricColor.Slate500,
          aggregation: 'avg',
          unit: 'bytes',
          description: 'Резидентная память процесса (RSS).',
        }),
        metric('process_goroutines', {
          label: 'Process Goroutines',
          color: MetricColor.Slate500,
          aggregation: 'avg',
          integerValued: true,
          description: 'Число активных горутин Go-процесса — устойчивый рост может указывать на утечку.',
        }),
      ],
    },
  ],
};
