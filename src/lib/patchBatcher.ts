type PatchWaiter<Result> = {
  resolve: (result: Result) => void;
  reject: (error: unknown) => void;
};

export function createPatchBatcher<Patch extends object, Result>(
  send: (patch: Patch) => Promise<Result>,
  delayMs = 350,
) {
  let pendingPatch: Patch | null = null;
  let pendingWaiters: PatchWaiter<Result>[] = [];
  let timer: ReturnType<typeof setTimeout> | null = null;
  let inFlight: Promise<void> = Promise.resolve();

  const flush = async () => {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
    if (!pendingPatch) {
      await inFlight;
      return;
    }

    const patch = pendingPatch;
    const waiters = pendingWaiters;
    pendingPatch = null;
    pendingWaiters = [];

    const operation = inFlight
      .catch(() => undefined)
      .then(() => send(patch));
    inFlight = operation.then(() => undefined, () => undefined);

    try {
      const result = await operation;
      waiters.forEach((waiter) => waiter.resolve(result));
    } catch (error) {
      waiters.forEach((waiter) => waiter.reject(error));
    }
  };

  const enqueue = (patch: Patch) => new Promise<Result>((resolve, reject) => {
    pendingPatch = Object.assign(pendingPatch ?? {}, patch) as Patch;
    pendingWaiters.push({ resolve, reject });
    if (timer) {
      clearTimeout(timer);
    }
    timer = setTimeout(() => void flush(), delayMs);
  });

  return {
    enqueue,
    flush,
    hasPending: () => pendingPatch != null,
  };
}
