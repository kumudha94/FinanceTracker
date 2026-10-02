// Runs async jobs one at a time in arrival order. Used for incoming SMS: two balance-bearing SMS
// for one account processed in parallel would each sync against the other's half-applied
// balance and raise false balance gaps.
export function createSerialQueue() {
  let tail: Promise<unknown> = Promise.resolve();
  return function run<T>(job: () => Promise<T>): Promise<T> {
    const result = tail.then(job, job);
    // Keep the chain alive after a failure; the caller still sees its own rejection.
    tail = result.catch(() => undefined);
    return result;
  };
}
