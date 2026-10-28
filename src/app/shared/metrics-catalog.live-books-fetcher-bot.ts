import { MetricColor } from '@app/shared/metric-colors';
import { metric, MetricsServiceDefinition } from '@app/shared/metrics-catalog-metric';

export const LIVE_BOOKS_FETCHER_BOT_METRICS_DEFINITION: MetricsServiceDefinition = {
  service: 'live-books-fetcher-bot',
  groups: [
    {
      id: 'discovery',
      label: 'Discovery',
      metrics: [
        metric('catalog_markets_total', {
          label: 'Catalog Markets Total',
          color: MetricColor.Cyan700,
          aggregation: 'last',
          integerValued: true,
          description:
            'Сколько рынков попало в каталог после последнего успешного Discovery-цикла — уже после отсева «похожих на спортивные/датированные» рынков (catalog_dropped_date_like). Именно по этому списку дальше непрерывно крутится Sweep, опрашивающий котировки. Резкая просадка — сигнал, что Gamma отдала меньше рынков, чем обычно, или сама выборка сузилась.',
        }),
        metric('catalog_dropped_date_like', {
          label: 'Catalog Dropped: Date-Like',
          color: MetricColor.Cyan700,
          aggregation: 'last',
          integerValued: true,
          description:
            'Сколько рынков в этом Discovery-цикле отфильтровано эвристикой «похоже на ежедневный спортивный/датированный рынок» (по слагу события/рынка и тексту вопроса) — такие рынки в итоговый каталог (catalog_markets_total) не попадают. Та же by-design эвристика, что и в discovery_dropped_date_like у spread-capture-bot-v4.',
        }),
        metric('discovery_duration_ms', {
          label: 'Discovery Duration (ms)',
          color: MetricColor.Cyan700,
          aggregation: 'avg',
          description:
            'Сколько миллисекунд занял весь Discovery-цикл целиком — от первого постраничного запроса к Gamma до готового обновлённого каталога рынков. Выполняется раз в DISCOVERY_INTERVAL (по умолчанию раз в час), не на каждом Sweep. Если растёт, смотри discovery_gamma_ms и discovery_collect_ms по отдельности, чтобы понять, какой шаг замедлился.',
        }),
        metric('discovery_gamma_ms', {
          label: 'Discovery Gamma Duration (ms)',
          color: MetricColor.Cyan700,
          aggregation: 'avg',
          description:
            'Сколько миллисекунд суммарно заняли все постраничные запросы к Gamma API (keyset-пагинация по всем активным событиям) в этом Discovery-цикле — обычно самый тяжёлый шаг, чаще всего доминирует в discovery_duration_ms.',
        }),
        metric('discovery_collect_ms', {
          label: 'Discovery Collect Duration (ms)',
          color: MetricColor.Cyan700,
          aggregation: 'avg',
          description:
            'Сколько миллисекунд заняли разбор полученных от Gamma событий и построение итогового списка рынков (включая отсев date-like рынков) в этом Discovery-цикле.',
        }),
        metric('catalog_revision', {
          label: 'Catalog Revision',
          color: MetricColor.Cyan700,
          aggregation: 'last',
          integerValued: true,
          description:
            'Растущий номер ревизии каталога рынков — увеличивается на 1 при каждой успешной замене каталога очередным Discovery-циклом. Само число не важно, важна динамика: если оно перестало расти между ожидаемыми Discovery-циклами, каталог не обновляется, хотя процесс формально жив.',
        }),
        metric('discovery_errors', {
          label: 'Discovery Errors',
          color: MetricColor.Red600,
          aggregation: 'sum',
          integerValued: true,
          description:
            'Сколько раз за эту минуту Discovery-цикл закончился ошибкой — не удалось получить события с Gamma или применить новый каталог. Ноль — Discovery работает исправно. При ошибке бот продолжает Sweep по старому каталогу, но новые рынки перестают появляться, а закрывшиеся — вовремя пропадать.',
        }),
        metric('catalog_recovered_from_previous', {
          label: 'Catalog Recovered From Previous',
          color: MetricColor.Amber600,
          aggregation: 'sum',
          integerValued: true,
          description:
            'Разовое событие: старт процесса из сохранённого предыдущего каталога (markets.previous.ndjson) вместо построения нового через Discovery. В норме почти никогда не появляется — сигнализирует, что при последнем старте актуальный каталог на диске оказался повреждён или отсутствовал, и бот подстраховался старой копией.',
        }),
      ],
    },
    {
      id: 'sweep',
      label: 'Sweep',
      metrics: [
        metric('sweep_duration_ms', {
          label: 'Sweep Duration (ms)',
          color: MetricColor.Violet600,
          aggregation: 'avg',
          description:
            'Сколько миллисекунд занял один полный проход Sweep — параллельный опрос текущих bid/ask цен по всем рынкам каталога через CLOB /prices, батчами по нескольку сотен токенов. Sweep крутится без пауз: один проход сразу сменяется следующим, поэтому рост этой метрики напрямую означает, что свежие котировки в /v1/spread-candidates обновляются реже.',
        }),
        metric('sweep_markets_total', {
          label: 'Sweep Markets Total',
          color: MetricColor.Violet600,
          aggregation: 'last',
          integerValued: true,
          description:
            'Сколько рынков было в каталоге на момент именно этого Sweep — тот же список, что и catalog_markets_total, но зафиксированный в момент опроса котировок, а не в момент последнего Discovery-цикла.',
        }),
        metric('sweep_valid_quotes', {
          label: 'Sweep Valid Quotes',
          color: MetricColor.Violet600,
          aggregation: 'avg',
          integerValued: true,
          description:
            'Сколько котировок из этого Sweep оказались валидными — хотя бы одна сторона (bid или ask) с корректной ценой. Если заметно меньше sweep_markets_total, значит по значительной части рынков биржа не вернула цену в этом конкретном проходе.',
        }),
        metric('quote_generation', {
          label: 'Quote Generation',
          color: MetricColor.Violet600,
          aggregation: 'last',
          integerValued: true,
          description:
            'Монотонно растущий номер снепшота котировок — увеличивается на 1 при публикации результата каждого успешного Sweep. Если перестал расти, Sweep-цикл встал, а потребители API (/v1/spread-candidates — например, spread-capture-bot-v4) продолжают получать один и тот же, всё более устаревший снепшот.',
        }),
        metric('sweeps_completed', {
          label: 'Sweeps Completed',
          color: MetricColor.Green600,
          aggregation: 'sum',
          integerValued: true,
          description:
            'Сколько Sweep-проходов за эту минуту завершились успешно — все батчи запросов к CLOB отработали, снепшот котировок опубликован. Sweep крутится без пауз, поэтому за одну минуту их обычно несколько.',
        }),
        metric('sweeps_failed', {
          label: 'Sweeps Failed',
          color: MetricColor.Red600,
          aggregation: 'sum',
          integerValued: true,
          description:
            'Сколько Sweep-проходов за эту минуту не удалось завершить — ошибка запроса к CLOB или неполный результат (не все батчи или не все рынки каталога вернули котировку). Ноль — все проходы этой минуты прошли штатно.',
        }),
        metric('sweep_requests', {
          label: 'Sweep Requests',
          color: MetricColor.Blue600,
          aggregation: 'sum',
          integerValued: true,
          description:
            'Сколько HTTP-запросов к CLOB /prices бот выполнил за эту минуту в рамках Sweep (по батчам токенов). Растёт вместе с размером каталога и с частотой самих Sweep-проходов.',
        }),
        metric('sweep_retries', {
          label: 'Sweep Retries',
          color: MetricColor.Amber600,
          aggregation: 'sum',
          integerValued: true,
          description:
            'Сколько из запросов sweep_requests пришлось повторить из-за сетевой ошибки или ответа биржи 5xx/429. Ноль — все запросы прошли с первой попытки.',
        }),
        metric('sweep_rate_limited', {
          label: 'Sweep Rate Limited',
          color: MetricColor.Amber600,
          aggregation: 'sum',
          integerValued: true,
          description:
            'Сколько запросов к CLOB получили ответ 429 (превышен лимит запросов биржи) за эту минуту. Отличается от sweep_retries тем, что здесь причина повтора — конкретно рейт-лимит, а не любая сетевая проблема.',
        }),
      ],
    },
    {
      id: 'process-health',
      label: 'Process Health',
      metrics: [
        metric('heap_alloc_bytes', {
          label: 'Heap Allocated',
          color: MetricColor.Cyan600,
          unit: 'bytes',
          aggregation: 'max',
          description:
            'Сколько байт памяти занято в heap процесса (Go runtime.MemStats.Alloc) на момент снятия метрики. Канарейка на утечки памяти: устойчивый рост без выхода на плато — плохой знак, обычные колебания вверх-вниз от работы сборщика мусора — норма.',
        }),
        metric('goroutines', {
          label: 'Goroutines',
          color: MetricColor.Cyan600,
          aggregation: 'max',
          integerValued: true,
          description:
            'Сколько горутин сейчас активно в процессе. Канарейка на утечки горутин — например, зависшие воркеры Sweep, которые не завершились и продолжают копиться. Устойчивый рост без стабилизации — сигнал проблемы, не нормальная работа.',
        }),
      ],
    },
    {
      id: 'archive',
      label: 'Archive',
      metrics: [
        metric('archive_publish_duration_ms', {
          label: 'Archive Publish Duration (ms)',
          color: MetricColor.Pink600,
          aggregation: 'avg',
          description:
            'Сколько миллисекунд заняла публикация очередного часового архива — запись поминутного и почасового parquet-файлов вместе с манифестом на диск. Срабатывает раз в час, при закрытии текущего часового буфера накопленных котировок.',
        }),
        metric('archive_minute_rows', {
          label: 'Archive Minute Rows',
          color: MetricColor.Pink600,
          aggregation: 'last',
          integerValued: true,
          description: 'Сколько строк поминутных котировок попало в только что опубликованный часовой parquet-архив.',
        }),
        metric('archive_hour_rows', {
          label: 'Archive Hour Rows',
          color: MetricColor.Pink600,
          aggregation: 'last',
          integerValued: true,
          description:
            'Сколько строк часовых OHLC-баров (open/high/low/close по bid и ask за час) попало в только что опубликованный часовой архив.',
        }),
        metric('archive_publish_errors', {
          label: 'Archive Publish Errors',
          color: MetricColor.Red600,
          aggregation: 'sum',
          integerValued: true,
          description:
            'Сколько раз публикация часового архива закончилась ошибкой. Такая ошибка сейчас фатальна для всего процесса — весь Run() завершается — так что счётчик подсказывает причину падения ещё до того, как придётся лезть в логи сервера.',
        }),
      ],
    },
    {
      id: 'candidate-server',
      label: 'Candidate Server',
      metrics: [
        metric('candidate_requests_total', {
          label: 'Candidate Requests',
          color: MetricColor.Blue600,
          aggregation: 'sum',
          integerValued: true,
          description:
            'Сколько всего запросов на /v1/spread-candidates получил HTTP-сервер бота за эту минуту — от других ботов (например, spread-capture-bot-v4), которым нужны текущие котировки по каталогу рынков.',
        }),
        metric('candidate_requests_stale_snapshot', {
          label: 'Candidate Requests: Stale Snapshot',
          color: MetricColor.Red600,
          aggregation: 'sum',
          integerValued: true,
          description:
            'Сколько запросов получили ответ 503, потому что последний снепшот котировок устарел (старше CANDIDATE_MAX_AGE) или его ещё вообще нет. Самый критичный сигнал в этой группе: если растёт, потребители (V4 и другие боты) вообще не получают свежих кандидатов через этот сервис.',
        }),
        metric('candidate_requests_invalid', {
          label: 'Candidate Requests: Invalid',
          color: MetricColor.Amber600,
          aggregation: 'sum',
          integerValued: true,
          description:
            'Сколько запросов получили ответ 400 из-за невалидного тела запроса — профиль кандидата не прошёл декодирование или проверку. Признак рассинхрона протокола между версией клиента и этого сервиса.',
        }),
      ],
    },
    {
      id: 'startup',
      label: 'Startup',
      metrics: [
        metric('catalog_startup_source', {
          label: 'Catalog Startup Source',
          color: MetricColor.Default,
          aggregation: 'last',
          integerValued: true,
          description:
            'Откуда взялся каталог рынков при последнем старте процесса: 1 — использован сохранённый каталог с диска, 0 — потребовался полный Discovery-цикл «с нуля». Пишется один раз при старте, дальше значение просто повторяется как обычный gauge — по нему видно, был ли последний рестарт «холодным» или «тёплым».',
        }),
      ],
    },
    {
      id: 'pulse',
      label: 'Pulse',
      metrics: [
        metric('heartbeat', {
          label: 'Heartbeat',
          aggregation: 'last',
          integerValued: true,
          description:
            'Техническая отметка живости процесса — экспортёр метрик автоматически проставляет 1 в каждый минутный снепшот, независимо от того, что происходило в этой минуте. Подтверждает, что процесс жив и успешно сформировал снепшот; ничего не говорит о состоянии Discovery, Sweep или Archive по отдельности.',
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
