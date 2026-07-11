type ScheduleOperation<T> = () => Promise<T>;

type OpenRouteServiceSchedulerOptions = {
  maxRequests?: number;
  windowMs?: number;
  now?: () => number;
  sleep?: (milliseconds: number) => Promise<void>;
};

type RateLimitedOpenRouteServiceError = {
  name: string;
  status: number;
  retryAfterMs?: number;
  attempts?: number;
  retryAttempts?: number;
};

function defaultSleep(milliseconds: number) {
  return new Promise<void>((resolve) => {
    setTimeout(resolve, milliseconds);
  });
}

function isRateLimitedOpenRouteServiceError(error: unknown): error is RateLimitedOpenRouteServiceError {
  return (
    typeof error === 'object' &&
    error !== null &&
    'name' in error &&
    error.name === 'OpenRouteServiceError' &&
    'status' in error &&
    error.status === 429
  );
}

export function createOpenRouteServiceScheduler(options: OpenRouteServiceSchedulerOptions = {}) {
  const maxRequests = options.maxRequests ?? 40;
  const windowMs = options.windowMs ?? 60_000;
  const now = options.now ?? Date.now;
  const sleep = options.sleep ?? defaultSleep;
  const requestStartTimes: number[] = [];
  let admissionQueue = Promise.resolve();

  function pruneRequestStartTimes(currentTime: number) {
    while (requestStartTimes[0] !== undefined && requestStartTimes[0] <= currentTime - windowMs) {
      requestStartTimes.shift();
    }
  }

  function nextWindowDelay(currentTime: number) {
    pruneRequestStartTimes(currentTime);

    if (requestStartTimes.length < maxRequests) {
      return 0;
    }

    return Math.max(requestStartTimes[0] + windowMs - currentTime, 0);
  }

  async function reserveStartTime() {
    const priorAdmission = admissionQueue;
    let releaseAdmission = () => {};
    admissionQueue = new Promise<void>((resolve) => {
      releaseAdmission = resolve;
    });

    await priorAdmission;

    try {
      while (true) {
        const currentTime = now();
        pruneRequestStartTimes(currentTime);

        if (requestStartTimes.length < maxRequests) {
          requestStartTimes.push(currentTime);
          return;
        }

        await sleep(nextWindowDelay(currentTime));
      }
    } finally {
      releaseAdmission();
    }
  }

  async function schedule<T>(operation: ScheduleOperation<T>, didRetry = false): Promise<T> {
    await reserveStartTime();

    try {
      return await operation();
    } catch (error) {
      if (!didRetry && isRateLimitedOpenRouteServiceError(error)) {
        const delayMs = Math.max(error.retryAfterMs ?? 0, nextWindowDelay(now()));
        if (delayMs > 0) {
          await sleep(delayMs);
        }

        return schedule(operation, true);
      }

      if (didRetry && isRateLimitedOpenRouteServiceError(error)) {
        error.attempts = 2;
        error.retryAttempts = 1;
      }

      throw error;
    }
  }

  return { schedule };
}

export const openRouteServiceDirectionsScheduler = createOpenRouteServiceScheduler({
  maxRequests: 40,
  windowMs: 60_000,
});
