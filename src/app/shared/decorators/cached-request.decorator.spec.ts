import { cached } from './cached-request.decorator';

// The decorator's `cache` variable lives in the descriptor closure created once when the class
// body is evaluated — it is shared across every instance of that class, not per-instance. Each
// test below therefore declares its own `class Service` so tests don't leak cache state into
// each other.

describe('cached', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns the same in-flight/cached promise for calls within the timeout window', async () => {
    class Service {
      public callCount = 0;
      @cached(1000)
      public fetch(): Promise<number> {
        this.callCount++;
        return Promise.resolve(this.callCount);
      }
    }
    const service = new Service();
    const first = service.fetch();
    const second = service.fetch();
    expect(second).toBe(first);
    await expect(first).resolves.toBe(1);
    expect(service.callCount).toBe(1);
  });

  it('calls the original method again once the timeout has elapsed', async () => {
    class Service {
      public callCount = 0;
      @cached(1000)
      public fetch(): Promise<number> {
        this.callCount++;
        return Promise.resolve(this.callCount);
      }
    }
    const service = new Service();
    await service.fetch();
    vi.advanceTimersByTime(1001);
    await service.fetch();
    expect(service.callCount).toBe(2);
  });

  it('still hits the cache right up to the boundary before the timeout elapses', async () => {
    class Service {
      public callCount = 0;
      @cached(1000)
      public fetch(): Promise<number> {
        this.callCount++;
        return Promise.resolve(this.callCount);
      }
    }
    const service = new Service();
    await service.fetch();
    vi.advanceTimersByTime(999);
    await service.fetch();
    expect(service.callCount).toBe(1);
  });
});
