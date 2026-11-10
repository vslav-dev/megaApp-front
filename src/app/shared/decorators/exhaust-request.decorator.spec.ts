import { exhaustRequest } from './exhaust-request.decorator';

describe('exhaustRequest', () => {
  it('returns the same in-flight promise for calls that overlap before resolution', async () => {
    let resolveFetch!: (value: number) => void;
    class Service {
      public callCount = 0;
      @exhaustRequest()
      public fetch(): Promise<number> {
        this.callCount++;
        return new Promise<number>((resolve) => (resolveFetch = resolve));
      }
    }
    const service = new Service();

    const first = service.fetch();
    const second = service.fetch();

    expect(second).toBe(first);
    expect(service.callCount).toBe(1);

    resolveFetch(42);
    await expect(first).resolves.toBe(42);
  });

  it('calls the original method again once the previous call has settled', async () => {
    class Service {
      public callCount = 0;
      @exhaustRequest()
      public fetch(): Promise<number> {
        this.callCount++;
        return Promise.resolve(this.callCount);
      }
    }
    const service = new Service();

    await service.fetch();
    await service.fetch();

    expect(service.callCount).toBe(2);
  });
});
