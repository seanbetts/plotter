import { describe, expect, it } from 'vitest';
import { OpenRouteServiceError } from './openRouteService';
import { createOpenRouteServiceScheduler } from './openRouteServiceScheduler';

function createFakeClock() {
  let currentTime = 0;
  const pendingSleeps: Array<{ resolve: () => void; wakeTime: number }> = [];

  return {
    sleeps: [] as number[],
    now: () => currentTime,
    sleep: (milliseconds: number) =>
      new Promise<void>((resolve) => {
        pendingSleeps.push({ resolve, wakeTime: currentTime + milliseconds });
      }),
    async advance(milliseconds: number) {
      currentTime += milliseconds;
      const readySleeps = pendingSleeps
        .filter((entry) => entry.wakeTime <= currentTime)
        .sort((left, right) => left.wakeTime - right.wakeTime);

      for (const entry of readySleeps) {
        const index = pendingSleeps.indexOf(entry);
        if (index >= 0) pendingSleeps.splice(index, 1);
        entry.resolve();
      }

      await Promise.resolve();
    },
  };
}

async function flushMicrotasks(turns = 5) {
  for (let turn = 0; turn < turns; turn += 1) {
    await Promise.resolve();
  }
}

describe('OpenRouteService scheduler', () => {
  it('waits for the next window before starting the next request', async () => {
    const clock = createFakeClock();
    const scheduler = createOpenRouteServiceScheduler({
      maxRequests: 2,
      windowMs: 1_000,
      now: clock.now,
      sleep: async (milliseconds) => {
        clock.sleeps.push(milliseconds);
        await clock.sleep(milliseconds);
      },
    });

    await scheduler.schedule(async () => 'first');
    await scheduler.schedule(async () => 'second');
    const third = scheduler.schedule(async () => 'third');

    await flushMicrotasks();
    expect(clock.sleeps).toEqual([1_000]);
    await clock.advance(1_000);
    await expect(third).resolves.toBe('third');
  });

  it('serializes concurrent admissions so extra callers cannot start early', async () => {
    const clock = createFakeClock();
    const startTimes: number[] = [];
    const scheduler = createOpenRouteServiceScheduler({
      maxRequests: 2,
      windowMs: 1_000,
      now: clock.now,
      sleep: async (milliseconds) => {
        clock.sleeps.push(milliseconds);
        await clock.sleep(milliseconds);
      },
    });

    const first = scheduler.schedule(async () => {
      startTimes.push(clock.now());
      return 'first';
    });
    const second = scheduler.schedule(async () => {
      startTimes.push(clock.now());
      return 'second';
    });
    const third = scheduler.schedule(async () => {
      startTimes.push(clock.now());
      return 'third';
    });

    await Promise.all([first, second]);
    expect(startTimes).toEqual([0, 0]);
    expect(clock.sleeps).toEqual([1_000]);

    await clock.advance(1_000);
    await expect(third).resolves.toBe('third');
    expect(startTimes).toEqual([0, 0, 1_000]);
  });

  it('retries one rate-limited request after the longer provider or window delay', async () => {
    const clock = createFakeClock();
    const scheduler = createOpenRouteServiceScheduler({
      maxRequests: 1,
      windowMs: 1_000,
      now: clock.now,
      sleep: async (milliseconds) => {
        clock.sleeps.push(milliseconds);
        await clock.sleep(milliseconds);
      },
    });
    let attempts = 0;

    const scheduled = scheduler.schedule(async () => {
      attempts += 1;
      if (attempts === 1) {
        throw new OpenRouteServiceError({
          status: 429,
          providerMessage: 'Rate limit exceeded.',
          profile: 'driving-car',
          retryAfterMs: 2_000,
        });
      }

      return 'success';
    });

    await flushMicrotasks();
    expect(clock.sleeps).toEqual([2_000]);

    await clock.advance(2_000);
    await expect(scheduled).resolves.toBe('success');
    expect(attempts).toBe(2);
  });

  it.each([404, 401, 403])('does not retry non-recoverable provider failures (%i)', async (status) => {
    const clock = createFakeClock();
    const scheduler = createOpenRouteServiceScheduler({
      now: clock.now,
      sleep: async (milliseconds) => {
        clock.sleeps.push(milliseconds);
        await clock.sleep(milliseconds);
      },
    });
    let attempts = 0;

    await expect(
      scheduler.schedule(async () => {
        attempts += 1;
        throw new OpenRouteServiceError({
          status,
          providerMessage: 'Provider error',
          profile: 'driving-car',
          retryAfterMs: 2_000,
        });
      }),
    ).rejects.toMatchObject({ status });

    expect(attempts).toBe(1);
    expect(clock.sleeps).toEqual([]);
  });
});
