export function exhaustRequest() {
  return function <TArgs extends unknown[], TResult>(
    _target: object,
    _propertyKey: string,
    descriptor: TypedPropertyDescriptor<(...args: TArgs) => Promise<TResult>>,
  ) {
    const originalMethod = descriptor.value!;
    let inFlightPromise: Promise<TResult> | null = null;

    descriptor.value = function (this: unknown, ...args: TArgs): Promise<TResult> {
      if (inFlightPromise) {
        return inFlightPromise;
      }

      const promise = originalMethod.apply(this, args).finally(() => {
        inFlightPromise = null;
      });
      inFlightPromise = promise;

      return promise;
    };

    return descriptor;
  };
}
