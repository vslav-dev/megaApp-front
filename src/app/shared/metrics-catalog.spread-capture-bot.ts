import { MetricColor } from '@app/shared/metric-colors';
import { metric, MetricsServiceDefinition } from '@app/shared/metrics-catalog-metric';

export const SPREAD_CAPTURE_BOT_METRICS_DEFINITION: MetricsServiceDefinition = {
  service: 'spread-capture-bot-v3',
  groups: [
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
            'Сколько живых денег (USD) свободно на торговом счету бота прямо сейчас — то, что не потрачено на открытые позиции и не нужно под уже выставленные ордера. Это не вся ценность счёта, а только «живые» деньги, готовые к новым покупкам. Число растёт, когда бот продаёт позиции, и падает, когда покупает новые.',
        }),
        metric('estimated_open_positions_value', {
          label: 'Estimated Open Positions Value',
          color: MetricColor.Green600,
          unit: 'money',
          aggregation: 'last',
          description:
            'Сколько реально можно было бы получить прямо сейчас, если бы бот продал все открытые позиции по текущим ценам в стакане (та же оценка по реальному спросу, что участвует в estimated_account_value, но отдельно от свободных денег).',
        }),
        metric('estimated_account_value', {
          label: 'Estimated Account Value',
          color: MetricColor.Green600,
          unit: 'money',
          aggregation: 'last',
          description:
            'Оценочная полная стоимость торгового счёта в USD: свободные деньги (free_cash) плюс то, сколько реально можно было бы получить, если бы бот сейчас продал все купленные позиции по текущим ценам в стакане (estimated_open_positions_value). Это не «бумажная» оценка по последней сделке, а консервативная оценка по реальному спросу в стакане — поэтому она честнее показывает, сколько денег можно реально достать.',
        }),
      ],
    },
    {
      id: 'pulse',
      label: 'Pulse',
      metrics: [
        metric('cycle_errors', {
          label: 'Cycle Errors',
          color: MetricColor.Red600,
          aggregation: 'sum',
          integerValued: true,
          description:
            'Сколько раз за этот цикл попытка отправить, переставить или отменить ордер на бирже закончилась ошибкой (биржа отказала). Ноль — это хорошо, значит все попытки прошли успешно. Если число равно количеству всех попыток за цикл — значит вообще ничего не получилось отправить, и стоит посмотреть логи бота.',
        }),
        metric('reconcile_failures', {
          label: 'Reconcile Failures',
          color: MetricColor.Red600,
          aggregation: 'sum',
          integerValued: true,
          description:
            'Сколько раз за эту минуту весь торговый цикл бота полностью не смог начаться — потому что не получилось загрузить базовые данные со счёта (открытые ордера, позиции) или книги заявок. Если это не ноль, в соответствующем цикле бот вообще не принимал никаких торговых решений — не «решил ничего не делать», а технически не смог даже попытаться. Этим отличается от cycle_errors, где попытки были, но часть из них не получилась.',
        }),
        metric('no_mutation_streak', {
          label: 'No-Mutation Streak',
          color: MetricColor.Amber600,
          aggregation: 'last',
          integerValued: true,
          description:
            'Сколько торговых циклов подряд бот не сделал ни одного реального изменения ордеров — не выставил, не переставил и не отменил ни одной заявки. Ноль означает, что в последнем цикле что-то изменилось. Большое число само по себе не обязательно плохо — рынок может быть просто стабильным и не требовать действий. Но если оно растёт без остановки очень долго, а вы ожидали активность, — стоит проверить, не застрял ли бот.',
        }),
      ],
    },
    {
      id: 'performance',
      label: 'Performance',
      metrics: [
        metric('fetch_ms', {
          label: 'Fetch Duration (ms)',
          color: MetricColor.Violet600,
          aggregation: 'avg',
          description:
            'Сколько миллисекунд заняло получение базового состояния счёта (открытые ордера, позиции, баланс) с биржи в начале этого торгового цикла. Чем меньше — тем быстрее бот видит актуальную картину. Большие скачки чаще говорят о медленном ответе биржи, а не о проблеме в самом боте.',
        }),
        metric('books_ms', {
          label: 'Books Duration (ms)',
          color: MetricColor.Violet600,
          aggregation: 'avg',
          description:
            'Сколько миллисекунд заняла загрузка стаканов (книг заявок) по всем рынкам из рабочего списка в этом цикле. Чем больше рынков нужно отследить, тем дольше может занимать этот шаг — само по себе это не ошибка.',
        }),
        metric('reconcile_ms', {
          label: 'Reconcile Duration (ms)',
          color: MetricColor.Violet600,
          aggregation: 'avg',
          description:
            'Сколько миллисекунд заняло принятие и исполнение всех торговых решений по покупке и продаже в этом цикле, уже после того как данные счёта и стаканы были получены. Это «расчётная» часть цикла без учёта сетевых задержек на загрузку данных.',
        }),
        metric('cycle_duration_ms', {
          label: 'Cycle Duration (ms)',
          color: MetricColor.Violet600,
          aggregation: 'avg',
          description:
            'Сколько миллисекунд занял весь торговый цикл целиком — от начала до конца, включая загрузку данных счёта, стаканов и принятие решений. Это самая верхнеуровневая метрика скорости работы бота: если она стабильно растёт, стоит посмотреть на fetch_ms, books_ms и reconcile_ms по отдельности, чтобы понять, какой именно шаг стал медленнее.',
        }),
      ],
    },
    {
      id: 'discovery',
      label: 'Discovery',
      metrics: [
        metric('catalog_markets_total', {
          label: 'Catalog Markets Total',
          color: MetricColor.Cyan600,
          aggregation: 'last',
          integerValued: true,
          description:
            'Сколько всего рынков (предсказательных событий) бот видит и анализирует на этапе поиска кандидатов — ещё до применения фильтров спреда, объёма и прочего. Это размер «сырого» списка рынков, который потом отфильтровывается до catalog_candidates. Большое число тут — это нормально, оно просто показывает, что данные о рынках вообще загружаются.',
        }),
        metric('discovery_dropped_date_like', {
          label: 'Discovery Dropped: Date-Like',
          color: MetricColor.Slate500,
          aggregation: 'last',
          integerValued: true,
          description:
            'Сколько рынков было отброшено целиком (сразу обеими сторонами — да и нет) при последнем обновлении списка кандидатов, потому что рынок похож на привязанное к конкретной дате спортивное событие — такие рынки бот сознательно не рассматривает для своей стратегии.',
        }),
        metric('discovery_duration_ms', {
          label: 'Discovery Duration (ms)',
          color: MetricColor.Violet600,
          aggregation: 'avg',
          description:
            'Сколько миллисекунд занял весь процесс обновления списка рынков-кандидатов — от загрузки списка событий до построения финального отфильтрованного списка. Это отдельная метрика от cycle_duration_ms, потому что обновление списка кандидатов и торговый цикл — два независимых процесса с разной частотой запуска.',
        }),
        metric('discovery_errors', {
          label: 'Discovery Errors',
          color: MetricColor.Red600,
          aggregation: 'sum',
          integerValued: true,
          description:
            'Сколько раз за это окно обновление списка рынков-кандидатов полностью завершилось с ошибкой. Если не ноль — список кандидатов в этом цикле обновления не обновился, и бот продолжает работать со старым списком до следующей успешной попытки.',
        }),
      ],
    },
    {
      id: 'candidates',
      label: 'Candidates and Worklist',
      metrics: [
        metric('catalog_candidates', {
          label: 'Catalog Candidates',
          color: MetricColor.Cyan600,
          aggregation: 'last',
          integerValued: true,
          description:
            'Сколько рынков (точнее, отдельных сторон рынка — да/нет) сейчас проходят все фильтры бота и считаются подходящими для новой покупки. Это весь список того, что бот в принципе готов покупать прямо сейчас, без привязки к тому, покупает ли он там что-то на самом деле. Обновляется редко — только когда бот пересматривает список рынков (discovery), а не на каждом торговом цикле.',
        }),
        metric('books_missing', {
          label: 'Missing Books',
          color: MetricColor.Amber600,
          aggregation: 'last',
          integerValued: true,
          description:
            'Сколько рынков из текущего рабочего списка бота не удалось получить «стакан» (книгу заявок — текущие цены покупки/продажи других участников) в этом цикле. Без стакана бот физически не может принять решение по такому рынку — он просто пропускается в этом цикле. Это число может быть стабильно довольно большим само по себе: часть рынков в рабочем списке — это уже неактивные или малоликвидные рынки, у которых стакана на нужной стороне нет уже давно. Большое, но СТАБИЛЬНОЕ значение — это не авария; внимания заслуживает только резкий внезапный рост.',
        }),
        metric('worklist_candidates', {
          label: 'Worklist Candidates',
          color: MetricColor.Cyan600,
          aggregation: 'last',
          integerValued: true,
          description:
            'Сколько рынков из текущего списка кандидатов бот реально обрабатывает в этом конкретном торговом цикле — то есть для них прямо сейчас принимаются решения о покупке. Обновляется каждый цикл (часто), в отличие от catalog_candidates, который обновляется редко. В норме это число почти всегда совпадает с catalog_candidates; разница означает, что список кандидатов недавно обновился, а этот торговый цикл ещё не успел его подхватить (или наоборот).',
        }),
        metric('worklist_ex_candidates', {
          label: 'Worklist Ex-Candidates',
          color: MetricColor.Cyan600,
          aggregation: 'last',
          integerValued: true,
          description:
            'Сколько рынков в текущем рабочем списке бота больше НЕ входят в список кандидатов (то есть уже не проходят фильтры на новый вход), но у бота там либо открытая позиция, либо открытый ордер — и поэтому их всё равно нужно сопровождать, например выставить продажу, чтобы выйти из позиции. Это нормально и ожидаемо: бот не бросает уже купленное только потому, что рынок перестал быть «привлекательным» для новых покупок.',
        }),
      ],
    },
    {
      id: 'drop-reasons',
      label: 'Drop Reasons',
      metrics: [
        metric('discovery_dropped_no_price', {
          label: 'Discovery Dropped: No Price',
          color: MetricColor.Slate500,
          aggregation: 'last',
          integerValued: true,
          description:
            'Сколько сторон рынка было отброшено, потому что по ним не пришли нормальные цены покупки/продажи — например, цена покупки оказалась выше цены продажи или одна из цен вообще не пришла. Без корректной цены оценить рынок невозможно.',
        }),
        metric('discovery_dropped_bid_range', {
          label: 'Discovery Dropped: Bid Range',
          color: MetricColor.Slate500,
          aggregation: 'last',
          integerValued: true,
          description:
            'Сколько сторон рынка было отброшено, потому что текущая цена покупки находится за пределами разрешённого диапазона входа — рынок либо слишком дорогой, либо слишком дешёвый по текущим настройкам стратегии.',
        }),
        metric('discovery_dropped_spread', {
          label: 'Discovery Dropped: Spread',
          color: MetricColor.Slate500,
          aggregation: 'last',
          integerValued: true,
          description:
            'Сколько сторон рынка было отброшено, потому что разница между ценой покупки и продажи (спред) слишком маленькая — на таком узком спреде стратегии бота невыгодно работать.',
        }),
        metric('discovery_dropped_volume', {
          label: 'Discovery Dropped: Volume',
          color: MetricColor.Slate500,
          aggregation: 'last',
          integerValued: true,
          description:
            'Сколько сторон рынка было отброшено, потому что объём торгов по ним меньше минимально допустимого — слишком тихий рынок, чтобы безопасно входить и выходить из позиции.',
        }),
        metric('discovery_dropped_days_to_end', {
          label: 'Discovery Dropped: Days to End',
          color: MetricColor.Slate500,
          aggregation: 'last',
          integerValued: true,
          description:
            'Сколько сторон рынка было отброшено, потому что до завершения события осталось меньше минимально нужного количества дней — слишком близкий к разрешению рынок не подходит под стратегию бота.',
        }),
        metric('discovery_dropped_market_age', {
          label: 'Discovery Dropped: Market Age',
          color: MetricColor.Slate500,
          aggregation: 'last',
          integerValued: true,
          description:
            'Сколько сторон рынка было отброшено, потому что сам рынок слишком молодой, создан совсем недавно — у новых рынков обычно ещё нестабильные цены, и бот выжидает, пока рынок «устоится».',
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
          description:
            'Сколько ордеров (заявок на покупку или продажу) сейчас реально стоит у бота на бирже Polymarket, по данным самой биржи. Это общее число открытых заявок прямо сейчас; разбивка на покупку и продажу — в orders_buy и orders_sell.',
        }),
        metric('orders_buy', {
          label: 'Buy Orders',
          color: MetricColor.Blue600,
          aggregation: 'last',
          integerValued: true,
          description:
            'Сколько именно заявок на покупку сейчас стоит открытыми на бирже. Каждая такая заявка — это попытка бота купить контракты на каком-то рынке по конкретной цене, которая ещё не исполнилась.',
        }),
        metric('orders_sell', {
          label: 'Sell Orders',
          color: MetricColor.Blue600,
          aggregation: 'max',
          integerValued: true,
          description:
            'Сколько именно заявок на продажу стоит открытыми на бирже. На минутном графике — текущее значение, на 5-минутных карточках, часовом и дневном — максимум за период. Каждая такая заявка защищает уже купленную ботом позицию — она выставлена, чтобы при подходящей цене продать то, что уже куплено.',
        }),
        metric('trade_post', {
          label: 'Post Actions',
          color: MetricColor.Blue600,
          aggregation: 'avg',
          integerValued: true,
          description:
            'Сколько заявок на покупку или продажу бот реально успешно выставил на биржу в этом цикле — то есть запрос принят биржей. Считает и совсем новые заявки, и те, что появились после переустановки уже стоящей заявки.',
        }),
        metric('trade_cancel', {
          label: 'Cancel Actions',
          color: MetricColor.Blue600,
          aggregation: 'avg',
          integerValued: true,
          description:
            'Сколько заявок бот реально успешно отменил на бирже в этом цикле. Считает и самостоятельные отмены, и отмены, которые были частью переустановки заявки.',
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
          description:
            'Сколько раз в этом цикле бот впервые поставил новую заявку на покупку на рынке, где раньше открытой заявки на покупку не было. Ноль — нормально, если все целевые позиции уже набраны или подходящих новых рынков сейчас нет.',
        }),
        metric('buy_keep', {
          label: 'Buy Keep',
          color: MetricColor.Orange600,
          aggregation: 'avg',
          integerValued: true,
          description:
            'Сколько уже стоящих заявок на покупку бот в этом цикле оставил без изменений, потому что цена и размер всё ещё подходящие. Как и с продажей, большое число тут — признак стабильности рынка, а не проблема.',
        }),
        metric('buy_replace', {
          label: 'Buy Replace',
          color: MetricColor.Orange600,
          aggregation: 'avg',
          integerValued: true,
          description:
            'Сколько уже стоящих заявок на покупку бот в этом цикле отменил и переставил заново — по новой цене или с новым размером (подробности — в buy_replace_reprice и buy_replace_size_change).',
        }),
        metric('buy_blocked', {
          label: 'Buy Blocked',
          color: MetricColor.Orange600,
          aggregation: 'avg',
          integerValued: true,
          description:
            'Сколько раз в этом цикле бот хотел поставить или поддержать заявку на покупку, но не смог — конкретная причина видна в buy_blocked_no_book и buy_blocked_below_min.',
        }),
        metric('buy_stop', {
          label: 'Buy Stop',
          color: MetricColor.Orange600,
          aggregation: 'sum',
          integerValued: true,
          description:
            'Сколько заявок на покупку бот в этом цикле отменил полностью, потому что покупать дальше уже не нужно или нельзя — например, нужный размер позиции уже набран, рынок выпал из списка кандидатов или попал в чёрный список (точная причина — в buy_stop_no_deficit, buy_stop_market_dropped_out, buy_stop_no_candidate, buy_stop_entry_blacklisted, buy_stop_queue_too_deep).',
        }),
        metric('blacklisted_entries', {
          label: 'Blacklisted Entries',
          color: MetricColor.Amber600,
          aggregation: 'last',
          integerValued: true,
          description:
            'Сколько разных рынков сейчас находятся в «чёрном списке» на покупку — это рынки, где биржа несколько раз подряд отказала в покупке из-за нехватки баланса, и бот временно перестал туда заходить, чтобы не тратить попытки впустую. Рынок убирается из списка автоматически, когда перестаёт быть проблемным. Это защитный механизм, а не показатель размера потерь.',
        }),
      ],
    },
    {
      id: 'buy-reasons',
      label: 'Buy: Reasons',
      metrics: [
        metric('buy_blocked_no_book', {
          label: 'Buy Blocked: No Book',
          color: MetricColor.Orange600,
          aggregation: 'avg',
          integerValued: true,
          description:
            'Сколько раз бот не смог поставить или обновить заявку на покупку, потому что не было доступного стакана продавцов по этому рынку — без него непонятно, по какой цене безопасно покупать.',
        }),
        metric('buy_blocked_below_min', {
          label: 'Buy Blocked: Below Min',
          color: MetricColor.Orange600,
          aggregation: 'avg',
          integerValued: true,
          description:
            'Сколько раз бот не стал ставить заявку на покупку, потому что нужный объём докупки оказался меньше минимального размера заявки, разрешённого биржей.',
        }),
        metric('buy_replace_reprice', {
          label: 'Buy Replace: Reprice',
          color: MetricColor.Orange600,
          aggregation: 'avg',
          integerValued: true,
          description:
            'Сколько заявок на покупку бот переставил в этом цикле только из-за изменения цены — желаемый размер позиции не менялся, просто появилась более выгодная цена для входа.',
        }),
        metric('buy_replace_size_change', {
          label: 'Buy Replace: Size Change',
          color: MetricColor.Orange600,
          aggregation: 'sum',
          integerValued: true,
          description:
            'Сколько заявок на покупку бот переставил в этом цикле из-за изменения нужного объёма докупки — например, часть заявки уже исполнилась, или целевой размер позиции изменился, а цена осталась прежней.',
        }),
        metric('buy_stop_no_deficit', {
          label: 'Buy Stop: No Deficit',
          color: MetricColor.Orange600,
          aggregation: 'sum',
          integerValued: true,
          description:
            'Сколько заявок на покупку бот отменил в этом цикле, потому что нужный размер позиции уже набран целиком — докупать больше не требуется. Это хороший, ожидаемый исход.',
        }),
        metric('buy_stop_market_dropped_out', {
          label: 'Buy Stop: Market Dropped Out',
          color: MetricColor.Orange600,
          aggregation: 'sum',
          integerValued: true,
          description:
            'Сколько заявок на покупку бот отменил в этом цикле, потому что рынок, где уже стояла заявка, перестал проходить фильтры на новый вход — например, спред сузился или объём упал. Продолжать наращивать позицию там больше нельзя, хотя уже купленное при этом не трогается.',
        }),
        metric('buy_stop_no_candidate', {
          label: 'Buy Stop: No Candidate',
          color: MetricColor.Orange600,
          aggregation: 'sum',
          integerValued: true,
          description:
            'Похоже на buy_stop_market_dropped_out, но для случая, когда заявки на покупку ещё не было: рынок к началу цикла уже не входил в список кандидатов, поэтому новую заявку на покупку по нему даже не стали выставлять.',
        }),
        metric('buy_stop_entry_blacklisted', {
          label: 'Buy Stop: Entry Blacklisted',
          color: MetricColor.Orange600,
          aggregation: 'sum',
          integerValued: true,
          description:
            'Сколько заявок на покупку бот отменил или не стал выставлять в этом цикле из-за того, что рынок попал в чёрный список на покупку — биржа несколько раз подряд отказала там в покупке из-за нехватки баланса, и бот временно перестал туда заходить.',
        }),
        metric('buy_stop_queue_too_deep', {
          label: 'Buy Stop: Queue Too Deep',
          color: MetricColor.Orange600,
          aggregation: 'sum',
          integerValued: true,
          description:
            'Сколько заявок на покупку бот отменил в этом цикле, потому что перед выгодной ценой уже стоит слишком большой объём чужих заявок на покупку (больше разрешённого лимита в USD) — войти по разумной цене сейчас не получится.',
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
          description:
            'Сколько раз в этом цикле бот впервые поставил заявку на продажу по какой-то купленной позиции, у которой раньше не было ни одной заявки на продажу. Ноль — нормально, если все уже купленные позиции и так уже сопровождаются продающими заявками.',
        }),
        metric('sell_keep', {
          label: 'Sell Keep',
          color: MetricColor.Pink600,
          aggregation: 'avg',
          integerValued: true,
          description:
            'Сколько уже стоящих заявок на продажу бот в этом цикле оставил без изменений, потому что их цена и размер всё ещё оптимальны. Большое число — хороший знак стабильности: бот не дёргает заявки без нужды.',
        }),
        metric('sell_replace', {
          label: 'Sell Replace',
          color: MetricColor.Pink600,
          aggregation: 'avg',
          integerValued: true,
          description:
            'Сколько уже стоящих заявок на продажу бот в этом цикле отменил и переставил заново — по новой цене или с другим размером (подробная причина — в sell_replace_reprice, sell_replace_expand и sell_replace_reduce). Сама переустановка — это нормальная рабочая активность, а не ошибка.',
        }),
        metric('sell_blocked', {
          label: 'Sell Blocked',
          color: MetricColor.Pink600,
          aggregation: 'avg',
          integerValued: true,
          description:
            'Сколько раз в этом цикле бот хотел поставить или поддержать заявку на продажу, но не смог — по одной из конкретных причин: нет стакана, слишком маленький размер или слишком длинная очередь перед нужной ценой (детали — в sell_blocked_no_book, sell_blocked_below_min и sell_blocked_queue_too_deep).',
        }),
        metric('sell_stop', {
          label: 'Sell Stop',
          color: MetricColor.Pink600,
          aggregation: 'sum',
          integerValued: true,
          description:
            'Сколько заявок на продажу бот в этом цикле отменил полностью, без переустановки, потому что продавать больше нечего — позиция уже распродана. Это ожидаемое завершение жизненного цикла позиции, а не сбой.',
        }),
      ],
    },
    {
      id: 'sell-reasons',
      label: 'Sell: Reasons',
      metrics: [
        metric('sell_blocked_no_book', {
          label: 'Sell Blocked: No Book',
          color: MetricColor.Pink600,
          aggregation: 'avg',
          integerValued: true,
          description:
            'Сколько раз в этом цикле бот не смог поставить или обновить заявку на продажу, потому что не было доступного стакана покупателей по этому рынку — без него непонятно, по какой цене продавать безопасно. Ноль — значит со стаканами для продажи всё было в порядке.',
        }),
        metric('sell_blocked_below_min', {
          label: 'Sell Blocked: Below Min',
          color: MetricColor.Pink600,
          aggregation: 'avg',
          integerValued: true,
          description:
            'Сколько раз бот не стал ставить заявку на продажу, потому что объём, который нужно продать, оказался меньше минимального размера заявки, разрешённого биржей. Обычно касается совсем небольших остатков позиции — это нормальная защита от заявки, которую биржа просто не примет.',
        }),
        metric('sell_blocked_queue_too_deep', {
          label: 'Sell Blocked: Queue Too Deep',
          color: MetricColor.Pink600,
          aggregation: 'avg',
          integerValued: true,
          description:
            'Сколько раз бот не стал ставить заявку на продажу, потому что перед выгодной ценой уже стоит слишком большой объём чужих заявок (больше разрешённого лимита в USD) — то есть очередь на продажу слишком глубокая, и заявка бота простояла бы там почти без шансов исполниться по адекватной цене.',
        }),
        metric('sell_replace_reprice', {
          label: 'Sell Replace: Reprice',
          color: MetricColor.Pink600,
          aggregation: 'avg',
          integerValued: true,
          description:
            'Сколько заявок на продажу бот переставил в этом цикле только из-за изменения цены — размер заявки остался тот же, просто рынок изменился и появилась более выгодная или более безопасная цена для продажи.',
        }),
        metric('sell_replace_expand', {
          label: 'Sell Replace: Expand',
          color: MetricColor.Pink600,
          aggregation: 'sum',
          integerValued: true,
          description:
            'Сколько заявок на продажу бот переставил в этом цикле, увеличив размер. Это происходит, когда позиция выросла — например, докупили ещё контрактов — и старая заявка на продажу покрывала только часть позиции, а новая покрывает больше.',
        }),
        metric('sell_replace_reduce', {
          label: 'Sell Replace: Reduce',
          color: MetricColor.Pink600,
          aggregation: 'sum',
          integerValued: true,
          description:
            'Сколько заявок на продажу бот переставил в этом цикле, уменьшив размер. Обычно это значит, что часть позиции уже была продана ранее, и заявку нужно скорректировать под то, что осталось.',
        }),
        metric('sell_stop_no_inventory', {
          label: 'Sell Stop: No Inventory',
          color: MetricColor.Pink600,
          aggregation: 'sum',
          integerValued: true,
          description:
            'Сколько заявок на продажу бот отменил в этом цикле, потому что продавать больше нечего — позиция по этому рынку уже полностью распродана. Сейчас это единственная причина, по которой продажа вообще останавливается.',
        }),
      ],
    },
    {
      id: 'process',
      label: 'Bot Process',
      metrics: [
        metric('process_cpu_ratio_avg', {
          label: 'Bot CPU Avg',
          color: MetricColor.Red600,
          aggregation: 'avg',
          description: 'Средняя доля общей CPU-мощности сервера, которую за минуту съел сам процесс бота.',
        }),
        metric('process_cpu_ratio_max', {
          label: 'Bot CPU Peak',
          color: MetricColor.Red500,
          aggregation: 'max',
          description: 'Пиковая доля CPU сервера, которую занимал процесс бота в одном из 5-секундных замеров этой минуты.',
        }),
        metric('process_rss_bytes', {
          label: 'Bot RSS',
          color: MetricColor.Orange600,
          aggregation: 'avg',
          description: 'Текущий RSS процесса бота: сколько физической памяти реально держит сам сервис прямо сейчас.',
        }),
      ],
    },
  ],
};
