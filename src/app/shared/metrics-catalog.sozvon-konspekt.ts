import { MetricColor } from '@app/shared/metric-colors';
import { metric, MetricsServiceDefinition } from '@app/shared/metrics-catalog-metric';

export const SOZVON_KONSPEKT_METRICS_DEFINITION: MetricsServiceDefinition = {
  service: 'sozvon-konspekt',
  groups: [
    {
      id: 'recognition',
      label: 'Recognition',
      metrics: [
        metric('recognition_success', {
          label: 'Successful Recognitions',
          color: MetricColor.Green600,
          aggregation: 'sum',
          integerValued: true,
          description:
            'Сколько голосовых записей за эту минуту были успешно скачаны, распознаны через OpenRouter и сохранены обратно на Яндекс.Диск в виде текстового файла. Ноль — нормально, если в эту минуту просто не было новых записей для обработки.',
        }),
        metric('recognition_failed', {
          label: 'Failed Recognitions',
          color: MetricColor.Red600,
          aggregation: 'sum',
          integerValued: true,
          description:
            'Сколько попыток распознать запись за эту минуту закончились ошибкой — на любом из шагов: скачивание с Диска, отправка в модель или загрузка готового текста обратно. Запись, упавшая с ошибкой, останется без .txt-файла и будет подхвачена повторно на следующем цикле поллинга.',
        }),
        metric('recognition_cost_usd', {
          label: 'Recognition Cost',
          color: MetricColor.Blue600,
          unit: 'money',
          aggregation: 'sum',
          description:
            'Сколько долларов США суммарно стоили все успешные распознавания за эту минуту, по тарифам OpenRouter (входные + выходные токены модели). Ноль — либо не было успешных распознаваний, либо OpenRouter не вернул данные о стоимости для конкретного запроса.',
        }),
      ],
    },
    {
      id: 'performance',
      label: 'Performance',
      metrics: [
        metric('convert_time_ratio', {
          label: 'Conversion Time Ratio',
          color: MetricColor.Violet600,
          aggregation: 'avg',
          description:
            'Сколько секунд реального времени уходит на сжатие звука перед отправкой в модель, в пересчёте на одну секунду самой записи — например, 5% означает, что минутный звонок сжимается за 3 секунды. Считается не по одной записи, а по сумме времени и сумме длительностей всех записей, сжатых за эту минуту, — это важно, потому что одна 59-минутная запись и пятьдесят 1-минутных иначе перекосили бы число в любую сторону. Метрика появляется только в минуты, когда сжатие реально происходило.',
        }),
        metric('recognition_time_ratio', {
          label: 'Recognition Time Ratio',
          color: MetricColor.Violet400,
          aggregation: 'avg',
          description:
            'Сколько секунд реального времени уходит на сам запрос распознавания в OpenRouter, в пересчёте на одну секунду записи — например, 50% означает, что минутный звонок распознаётся примерно за 30 секунд. Как и у convert_time_ratio, это отношение суммы времени к сумме длительностей всех записей за минуту, а не среднее по отдельным записям — короткие и длинные звонки не искажают число друг относительно друга. Метрика появляется только в минуты, когда хотя бы одна запись дошла до этапа распознавания.',
        }),
      ],
    },
    {
      id: 'reliability',
      label: 'Reliability',
      metrics: [
        metric('application_errors', {
          label: 'Application Errors',
          color: MetricColor.Orange600,
          aggregation: 'sum',
          integerValued: true,
          description:
            'Сколько раз за эту минуту приложение столкнулось с любой ошибкой — неважно какой: не скачался файл с Диска, не сработал ffmpeg при сжатии, модель не ответила, не загрузился готовый текст обратно, или что-то ещё непредвиденное. Ошибки в этом приложении — редкость по своей природе, поэтому здесь специально не разбито по типам: любое отклонение от нормальной работы достаточно важно само по себе, чтобы тут появиться. Ноль — всё работает штатно.',
        }),
      ],
    },
  ],
};
