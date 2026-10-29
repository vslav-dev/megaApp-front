import { Service, computed, inject, signal } from '@angular/core';
import { MetricsSettingsService } from '@app/services/metrics-settings.service';
import { MetricsBinaryFrameType, NetworkService } from '@app/services/network.service';
import { DEFAULT_SEVERITY_THRESHOLDS, SeverityThresholds } from '@app/shared/metrics-severity';
import { decodeMetricsWireToLatestSnapshot } from '@app/shared/metrics-wire';
import { MetricsHealthSeverity, ServiceHealth, ServiceLatest } from '@app/shared/types';

const SEVERITY_RANK: Record<MetricsHealthSeverity, number> = { ok: 0, warn: 1, error: 2 };
const NOW_TICK_INTERVAL_MS = 30_000;

@Service()
export class MetricsHealthService {
  public readonly services$$ = computed<ServiceHealth[]>(() => {
    const nowSeconds = Math.floor(this.now$$() / 1000);
    return this.latestServices$$().map((service) => ({
      service: service.service,
      severity: this.severityFromLatest(service, nowSeconds),
    }));
  });

  public readonly overallSeverity$$ = computed<MetricsHealthSeverity | null>(() => {
    const services = this.services$$();
    if (services.length === 0) return null;
    return services.reduce<MetricsHealthSeverity>(
      (worst, service) => (SEVERITY_RANK[service.severity] > SEVERITY_RANK[worst] ? service.severity : worst),
      'ok',
    );
  });

  private readonly networkService = inject(NetworkService);
  private readonly metricsSettingsService = inject(MetricsSettingsService);
  private readonly latestServices$$ = signal<ServiceLatest[]>([]);
  private readonly now$$ = signal(Date.now());
  private readonly nowTickIntervalId = setInterval(() => this.now$$.set(Date.now()), NOW_TICK_INTERVAL_MS);

  public constructor() {
    this.networkService.metricsBinaryFrames$.subscribe((frame) => {
      if (frame.frameType === MetricsBinaryFrameType.Latest) {
        this.latestServices$$.set(decodeMetricsWireToLatestSnapshot(frame.payload).services);
      }
    });
  }

  public severityThresholds(service: string): SeverityThresholds {
    return this.metricsSettingsService.severityThresholdOverrides$$()[service] ?? DEFAULT_SEVERITY_THRESHOLDS;
  }

  public setSeverityThresholds(service: string, thresholds: SeverityThresholds): void {
    this.metricsSettingsService.setSeverityThresholdOverrides({
      ...this.metricsSettingsService.severityThresholdOverrides$$(),
      [service]: thresholds,
    });
  }

  private severityFromLatest(service: ServiceLatest, nowSeconds: number): MetricsHealthSeverity {
    if (!Number.isFinite(service.lastBucket) || service.lastBucket <= 0) {
      return 'error';
    }

    const thresholds = this.severityThresholds(service.service);
    const ageSeconds = nowSeconds - service.lastBucket;
    if (ageSeconds > thresholds.errorAfterSeconds) {
      return 'error';
    }
    if (ageSeconds > thresholds.warnAfterSeconds) {
      return 'warn';
    }
    return 'ok';
  }
}
