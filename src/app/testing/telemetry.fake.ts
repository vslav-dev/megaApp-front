import { TelemetryService } from '@app/services/telemetry.service';

// TelemetryService is itself heavy (injects HttpClient/Router/DeviceInfoService/LocalStorageService,
// runs setTimeout-based timers and global listeners in its constructor). Every Группа B/C test that
// has it as a direct dependency should override it via this fake instead of letting TestBed
// construct the real thing — see plans/29-frontend-unit-test-coverage.implementation-plan.md.
export function createTelemetryFake(): Pick<
  TelemetryService,
  'measure' | 'measureAsync' | 'record' | 'recordAfterPaint' | 'logError' | 'log'
> {
  return {
    measure: (_operation, work) => work(),
    measureAsync: (_operation, work) => work(),
    record: () => {},
    recordAfterPaint: async () => {},
    logError: () => {},
    log: () => {},
  };
}
