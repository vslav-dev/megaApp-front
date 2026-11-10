import { Component, computed, inject } from '@angular/core';
import { MetricsHealthService } from '@app/services/metrics-health.service';
import { severityDotClass } from '@app/shared/metrics-severity';

// Overall metrics health as one colored dot. Not mounted anywhere at the moment: it was taken off the
// sidebar (next to the collapse button, admin only) on request. To bring it back, add
// `<metrics-health-dot />` there again — MetricsHealthService still runs, the dashboard uses it.
@Component({
  selector: 'metrics-health-dot',
  templateUrl: './metrics-health-dot.html',
})
export class MetricsHealthDot {
  protected readonly metricsHealthService = inject(MetricsHealthService);

  protected readonly dotClass$$ = computed(() => severityDotClass(this.metricsHealthService.overallSeverity$$()));
}
