import { Component, computed, inject } from '@angular/core';
import { MetricsHealthService } from '@app/services/metrics-health.service';
import { severityDotClass } from '@app/shared/metrics-severity';

@Component({
  selector: 'metrics-health-dot',
  templateUrl: './metrics-health-dot.html',
})
export class MetricsHealthDot {
  protected readonly metricsHealthService = inject(MetricsHealthService);

  protected readonly dotClass$$ = computed(() => severityDotClass(this.metricsHealthService.overallSeverity$$()));
}
