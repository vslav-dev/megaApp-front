import { MetricColor } from '@app/shared/metric-colors';
import { metric, MetricsServiceDefinition } from '@app/shared/metrics-catalog-metric';

export const MEGAAPP_METRICS_DEFINITION: MetricsServiceDefinition = {
  service: 'megaapp',
  groups: [
    {
      id: 'activity',
      label: 'Activity',
      metrics: [
        metric('food_diary_entry_created', {
          label: 'Food Entries Created',
          color: MetricColor.Green600,
          aggregation: 'sum',
          integerValued: true,
          description:
            'Сколько новых записей о приёме еды было добавлено в дневник питания за эту минуту. Каждая такая запись — это одно сохранённое блюдо или продукт за конкретный день.',
        }),
        metric('food_diary_entry_updated', {
          label: 'Food Entries Updated',
          color: MetricColor.Green600,
          aggregation: 'sum',
          integerValued: true,
          description:
            'Сколько уже существующих записей о приёме еды было изменено за эту минуту — например, поменяли вес продукта или сам продукт в уже сохранённой записи.',
        }),
        metric('food_diary_entry_deleted', {
          label: 'Food Entries Deleted',
          color: MetricColor.Green600,
          aggregation: 'sum',
          integerValued: true,
          description: 'Сколько записей о приёме еды было удалено из дневника питания за эту минуту.',
        }),
        metric('food_diary_day_deleted', {
          label: 'Food Days Deleted',
          color: MetricColor.Green600,
          aggregation: 'sum',
          integerValued: true,
          description:
            'Сколько раз за эту минуту был полностью удалён целый день дневника питания — все записи о еде за конкретную дату сразу.',
        }),
        metric('food_diary_day_restored', {
          label: 'Food Days Restored',
          color: MetricColor.Green600,
          aggregation: 'sum',
          integerValued: true,
          description:
            'Сколько раз за эту минуту был восстановлен ранее удалённый день дневника питания (отмена удаления всего дня).',
        }),
        metric('food_body_weight_updated', {
          label: 'Body Weight Updates',
          color: MetricColor.Green600,
          aggregation: 'sum',
          integerValued: true,
          description: 'Сколько раз за эту минуту было сохранено новое значение веса тела пользователя.',
        }),
        metric('food_catalogue_entry_created', {
          label: 'Products Created',
          color: MetricColor.Cyan600,
          aggregation: 'sum',
          integerValued: true,
          description: 'Сколько новых продуктов было добавлено в каталог продуктов за эту минуту.',
        }),
        metric('food_catalogue_entry_updated', {
          label: 'Products Updated',
          color: MetricColor.Cyan600,
          aggregation: 'sum',
          integerValued: true,
          description:
            'Сколько существующих продуктов в каталоге было изменено за эту минуту — например, обновили калорийность или состав КБЖУ.',
        }),
        metric('food_catalogue_entry_deleted', {
          label: 'Products Deleted',
          color: MetricColor.Cyan600,
          aggregation: 'sum',
          integerValued: true,
          description: 'Сколько продуктов было удалено из каталога продуктов за эту минуту.',
        }),
        metric('food_personal_kcal_job_ran', {
          label: 'Personal Kcal Job Runs',
          color: MetricColor.Slate500,
          aggregation: 'sum',
          integerValued: true,
          description:
            'Показывает, что в эту минуту отработала фоновая ежемесячная задача пересчёта личной калорийности продуктов и нормы для пользователей — она запускается по расписанию один раз в месяц, 1-го числа. Значение 1 означает, что задача запустилась; в остальные минуты месяца эта метрика просто не приходит, и это нормально.',
        }),
        metric('backup_job_ran', {
          label: 'Backup Job Runs',
          color: MetricColor.Slate500,
          aggregation: 'sum',
          integerValued: true,
          description:
            'Показывает, что в эту минуту отработала фоновая ежедневная задача резервного копирования базы данных — она запускается по расписанию один раз в сутки. Значение 1 означает, что задача запустилась; в остальное время суток эта метрика не приходит, и это нормально.',
        }),
      ],
    },
    {
      id: 'process',
      label: 'MegaApp Process',
      metrics: [
        metric('process_cpu_ratio_avg', {
          label: 'MegaApp CPU Avg',
          color: MetricColor.Red600,
          aggregation: 'avg',
          description: 'Средняя доля общей CPU-мощности сервера, которую за минуту съел сам процесс megaapp-back.',
        }),
        metric('process_cpu_ratio_max', {
          label: 'MegaApp CPU Peak',
          color: MetricColor.Red500,
          aggregation: 'max',
          description:
            'Пиковая доля CPU сервера, которую занимал процесс megaapp-back в одном из 5-секундных замеров этой минуты.',
        }),
        metric('process_rss_bytes', {
          label: 'MegaApp RSS',
          color: MetricColor.Orange600,
          aggregation: 'avg',
          description:
            'Текущий RSS процесса megaapp-back: сколько физической памяти реально держит сам сервис прямо сейчас.',
        }),
      ],
    },
  ],
};
