import { MetricColor } from '@app/shared/metric-colors';
import { metric, MetricsServiceDefinition } from '@app/shared/metrics-catalog-metric';

export const CYCLE_BOOKS_FETCHER_BOT_METRICS_DEFINITION: MetricsServiceDefinition = {
  service: 'cycle-books-fetcher-bot',
  groups: [
    {
      id: 'connection',
      label: 'Connection',
      metrics: [
        metric('ws_connected', {
          label: 'WS Connected',
          color: MetricColor.Blue600,
          aggregation: 'last',
          integerValued: true,
          description:
            'Жив ли сейчас WebSocket-коннект к публичному market-каналу Polymarket (CLOB), через который бот получает live-котировки bid/ask по отслеживаемым токенам. 1 — соединение установлено, 0 — сейчас разорвано (идёт переподключение). Кратковременные провалы в 0 — норма при реконнекте; если метрика подолгу держится на 0, бот вообще не видит новых цен.',
        }),
        metric('ws_reconnects_total', {
          label: 'WS Reconnects',
          color: MetricColor.Amber600,
          aggregation: 'sum',
          integerValued: true,
          description:
            'Сколько раз за эту минуту боту пришлось заново подключаться к WS-каналу Polymarket — из-за разрыва соединения, обрыва сети или молчания сервера дольше сторожевого таймера (ping/pong). Ноль — соединение стабильно продержалось всю минуту. Частые реконнекты сами по себе не катастрофа (после каждого бот досылает заново все подписки), но означают периоды, когда цены временно не обновлялись.',
        }),
        metric('max_quote_staleness_seconds', {
          label: 'Max Quote Staleness (s)',
          color: MetricColor.Amber600,
          unit: 'count',
          aggregation: 'max',
          description:
            'Худший случай среди всех сейчас отслеживаемых токенов: сколько секунд прошло с последнего полученного обновления цены. Один номер ловит зависшую котировку по любому из ~20 подписанных токенов сразу, не требуя метрики на каждый токен отдельно. Токены, по которым ещё не было ни одной котировки (только что подписались), в расчёт не берутся. Устойчиво растущее число — признак, что WS формально жив (ws_connected=1), но реальные апдейты цен перестали приходить.',
        }),
      ],
    },
    {
      id: 'tracking',
      label: 'Market Tracking',
      metrics: [
        metric('markets_tracked', {
          label: 'Markets Tracked',
          color: MetricColor.Cyan700,
          aggregation: 'last',
          integerValued: true,
          description:
            'Сколько рынков (live и next суммарно, по всем отслеживаемым монетам из конфига COINS) реально в трекинге прямо сейчас. Ожидаемое значение — 2 на каждую монету: один live-рынок текущего слота и один next на смену. Просадка ниже ожидаемого означает, что discovery не успевает находить новые рынки вовремя.',
        }),
        metric('markets_missing_next', {
          label: 'Markets Missing Next',
          color: MetricColor.Red600,
          aggregation: 'last',
          integerValued: true,
          description:
            'По скольким из отслеживаемых монет прямо сейчас нет закэшированного next-рынка — того, что должен сменить текущий live-рынок на ближайшей границе слота. В норме — 0. Любое значение больше нуля — самый прямой сигнал, что discovery-цикл сломался или отстаёт: если не исправится до конца текущего слота, при смене live/next по этой монете возникнет провал в записи данных.',
        }),
      ],
    },
    {
      id: 'storage',
      label: 'Storage',
      metrics: [
        metric('quote_rows_written_total', {
          label: 'Quote Rows Written',
          color: MetricColor.Green600,
          aggregation: 'sum',
          integerValued: true,
          description:
            'Сколько строк с котировками (top-of-book bid/ask) бот записал в свой NDJSON-файл за эту минуту — по одной строке на каждое WS-событие обновления цены по отслеживаемому токену, без фильтрации и дедупликации на этапе записи. Последняя линия обороны против «тихого» зависания: если WS формально подключён, но эта метрика перестала расти, значит запись на диск где-то сломалась.',
        }),
        metric('store_bytes_written_total', {
          label: 'Store Bytes Written',
          color: MetricColor.Default,
          unit: 'bytes',
          aggregation: 'sum',
          description:
            'Сколько байт бот реально записал на диск за эту минуту — в файл котировок и в файл метаданных рынков суммарно. Прямое измерение фактического расхода места вместо расчётной оценки на этапе проектирования. Помогает вовремя заметить аномальный рост объёма — например, шторм переподключений или всплеск активности в стакане.',
        }),
        metric('archive_failures_total', {
          label: 'Archive Failures',
          color: MetricColor.Red600,
          aggregation: 'sum',
          integerValued: true,
          description:
            'Сколько раз за эту минуту фоновая архивация — сжатие закрытого суточного (или досрочно закрытого по объёму) NDJSON-файла в zip — закончилась ошибкой. Ноль — архивация идёт штатно. Если не ноль, необработанный файл рискует остаться неубранным в рабочей директории вместо архива; при повторяющихся ошибках стоит проверить свободное место на диске и права на запись.',
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
            'Техническая отметка живости процесса — экспортёр метрик автоматически проставляет 1 в каждый минутный снепшот, независимо от того, что происходило в этой минуте. Подтверждает, что процесс жив и успешно сформировал снепшот; ничего не говорит о состоянии самого сбора котировок.',
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
