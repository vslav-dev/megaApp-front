import { MetricColor } from '@app/shared/metric-colors';
import { metric, MetricsServiceDefinition } from '@app/shared/metrics-catalog-metric';

export const TG_TRANSCRIBER_BOT_METRICS_DEFINITION: MetricsServiceDefinition = {
  service: 'tg-transcriber-bot',
  groups: [
    {
      id: 'traffic',
      label: 'Traffic',
      metrics: [
        metric('audio_received', {
          label: 'Audio Received',
          color: MetricColor.Blue600,
          aggregation: 'sum',
          integerValued: true,
          description:
            'Сколько голосовых/аудио/аудио-документов дошло до обработчика за эту минуту — точка отсчёта воронки, ещё до проверки размера файла.',
        }),
        metric('access_denied', {
          label: 'Access Denied',
          color: MetricColor.Red600,
          aggregation: 'sum',
          integerValued: true,
          description:
            'Сколько сообщений пришло от отправителя не из whitelist и не от админа. Такие сообщения игнорируются без ответа — метрика единственный способ увидеть попытки постороннего доступа.',
        }),
        metric('file_too_large', {
          label: 'File Too Large',
          color: MetricColor.Amber600,
          aggregation: 'sum',
          integerValued: true,
          description:
            'Сколько файлов отсеяно проверкой лимита размера ещё до скачивания (лимит — MAX_FILE_SIZE_BYTES, не больше 20 МБ — предел самого Telegram Bot API).',
        }),
      ],
    },
    {
      id: 'transcription',
      label: 'Transcription',
      metrics: [
        metric('transcriptions_started', {
          label: 'Transcriptions Started',
          color: MetricColor.Violet600,
          aggregation: 'sum',
          integerValued: true,
          description: 'Сколько раз за эту минуту запущен вызов распознавания через OpenRouter (файл уже успешно скачан).',
        }),
        metric('transcriptions_completed', {
          label: 'Transcriptions Completed',
          color: MetricColor.Green600,
          aggregation: 'sum',
          integerValued: true,
          description: 'Сколько распознаваний за эту минуту завершились успешно.',
        }),
        metric('transcriptions_failed', {
          label: 'Transcriptions Failed',
          color: MetricColor.Red600,
          aggregation: 'sum',
          integerValued: true,
          description:
            'Сколько вызовов OpenRouter закончились ошибкой (недоступность API, неподдерживаемый формат, пустой ответ и т.п.) — файл при этом был успешно скачан, проблема на стороне распознавания.',
        }),
        metric('download_failed', {
          label: 'Download Failed',
          color: MetricColor.Amber600,
          aggregation: 'sum',
          integerValued: true,
          description:
            'Сколько раз не удалось скачать файл с серверов Telegram. Отдельно от transcriptions_failed — это сбой на более раннем шаге, до обращения к OpenRouter.',
        }),
        metric('transcription_duration_ms', {
          label: 'Transcription Duration (ms)',
          color: MetricColor.Violet600,
          aggregation: 'avg',
          description:
            'Сколько миллисекунд занял последний завершившийся в эту минуту вызов распознавания. При нескольких распознаваниях в одну минуту (до 2 параллельно) в снепшот попадает только последнее значение.',
        }),
        metric('audio_size_bytes', {
          label: 'Audio Size',
          color: MetricColor.Cyan600,
          aggregation: 'avg',
          description: 'Размер скачанного аудиофайла последнего распознавания в этой минуте, в байтах.',
        }),
      ],
    },
    {
      id: 'usage',
      label: 'OpenRouter Usage',
      metrics: [
        metric('openrouter_input_tokens', {
          label: 'Input Tokens',
          color: MetricColor.Teal700,
          aggregation: 'sum',
          integerValued: true,
          description: 'Сколько входных токенов (аудио + промпт) израсходовано за эту минуту по всем завершённым распознаваниям.',
        }),
        metric('openrouter_output_tokens', {
          label: 'Output Tokens',
          color: MetricColor.Teal500,
          aggregation: 'sum',
          integerValued: true,
          description: 'Сколько выходных токенов (текст транскрипта) сгенерировано за эту минуту.',
        }),
        metric('openrouter_cost_usd', {
          label: 'Cost',
          color: MetricColor.Amber600,
          unit: 'money',
          aggregation: 'sum',
          description: 'Сколько реально потрачено на OpenRouter за эту минуту, в долларах — прямой сигнал стоимости нагрузки на бота.',
        }),
      ],
    },
    {
      id: 'delivery',
      label: 'Delivery',
      metrics: [
        metric('delivery_failed', {
          label: 'Delivery Failed',
          color: MetricColor.Red600,
          aggregation: 'sum',
          integerValued: true,
          description:
            'Сколько раз готовый транскрипт не удалось отправить пользователю — ни текстом, ни файлом. Распознавание при этом уже успешно завершилось, результат теряется на последнем шаге.',
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
            'Сколько байт памяти занято в heap процесса (Go runtime.MemStats.Alloc), снимается раз в минуту. Канарейка на утечки памяти: устойчивый рост без плато — плохой знак, колебания вверх-вниз от сборщика мусора — норма.',
        }),
        metric('goroutines', {
          label: 'Goroutines',
          color: MetricColor.Cyan600,
          aggregation: 'max',
          integerValued: true,
          description:
            'Сколько горутин активно в процессе, снимается раз в минуту. Канарейка на утечки горутин — устойчивый рост без стабилизации сигнализирует о проблеме.',
        }),
      ],
    },
    {
      id: 'process',
      label: 'Bot Process',
      metrics: [
        metric('process_cpu_ratio_avg', {
          label: 'Bot CPU Avg',
          color: MetricColor.Pink600,
          aggregation: 'avg',
          description: 'Средняя доля общей CPU-мощности сервера, которую за минуту съел сам процесс бота.',
        }),
        metric('process_cpu_ratio_max', {
          label: 'Bot CPU Peak',
          color: MetricColor.Pink500,
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
    {
      id: 'pulse',
      label: 'Pulse',
      metrics: [
        metric('heartbeat', {
          label: 'Heartbeat',
          aggregation: 'last',
          integerValued: true,
          description:
            'Техническая отметка живости процесса — экспортёр метрик автоматически проставляет 1 в каждый минутный снепшот. Подтверждает, что процесс жив и успешно сформировал снепшот.',
        }),
      ],
    },
  ],
};
