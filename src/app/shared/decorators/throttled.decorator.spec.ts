import { throttled } from './throttled.decorator';

// Same as cached-request.decorator.spec.ts: `lastCall` lives in the descriptor closure shared by
// every instance of the class, so each test declares its own `class Service`.

describe('throttled', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('invokes the method on the first call', () => {
    class Service {
      public callCount = 0;
      @throttled(100)
      public act(): void {
        this.callCount++;
      }
    }
    const service = new Service();
    service.act();
    expect(service.callCount).toBe(1);
  });

  it('suppresses further calls within the delay window', () => {
    class Service {
      public callCount = 0;
      @throttled(100)
      public act(): void {
        this.callCount++;
      }
    }
    const service = new Service();
    service.act();
    service.act();
    service.act();
    expect(service.callCount).toBe(1);
  });

  it('allows a call again once the delay has elapsed', () => {
    class Service {
      public callCount = 0;
      @throttled(100)
      public act(): void {
        this.callCount++;
      }
    }
    const service = new Service();
    service.act();
    vi.advanceTimersByTime(101);
    service.act();
    expect(service.callCount).toBe(2);
  });
});
