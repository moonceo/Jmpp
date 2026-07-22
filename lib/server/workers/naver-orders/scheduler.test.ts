import { describe, expect, it, vi } from "vitest";

import {
  runNaverOrderSchedulerIteration,
  runNaverOrderSchedulerLoop,
  validateNaverOrderSchedulerConfig,
  type NaverOrderSchedulerDependencies,
} from "@/lib/server/workers/naver-orders/scheduler";

const NOW = new Date("2026-07-12T03:00:00.000Z");

function dependencies(
  overrides: Partial<NaverOrderSchedulerDependencies> = {},
): NaverOrderSchedulerDependencies {
  return {
    store: {
      enqueueDue: vi.fn(async () => []),
    },
    clock: { now: () => NOW },
    sleep: vi.fn(async () => undefined),
    config: {
      pollIntervalMs: 5_000,
      syncIntervalMs: 60_000,
      initialLookbackMs: 86_400_000,
      maxAttempts: 8,
      batchSize: 100,
    },
    ...overrides,
  };
}

describe("Naver order scheduler", () => {
  it("passes a single clock snapshot and collection policy to the store", async () => {
    const enqueueDue = vi.fn(async () => [
      {
        id: "00000000-0000-4000-8000-000000000001",
        tenantId: "00000000-0000-4000-8000-000000000002",
        marketAccountId: "00000000-0000-4000-8000-000000000003",
        correlationId: "00000000-0000-4000-8000-000000000004",
        windowStart: "2026-07-11T03:00:00.000Z",
        windowEnd: NOW.toISOString(),
      },
    ]);
    const setup = dependencies({ store: { enqueueDue } });

    await expect(
      runNaverOrderSchedulerIteration(
        setup,
        new AbortController().signal,
      ),
    ).resolves.toBe(1);
    expect(enqueueDue).toHaveBeenCalledWith({
      now: NOW,
      syncIntervalMs: 60_000,
      initialLookbackMs: 86_400_000,
      maxAttempts: 8,
      batchSize: 100,
    });
  });

  it("does not touch PostgreSQL when already aborted", async () => {
    const setup = dependencies();
    const controller = new AbortController();
    controller.abort();

    await expect(
      runNaverOrderSchedulerIteration(setup, controller.signal),
    ).resolves.toBe(0);
    expect(setup.store.enqueueDue).not.toHaveBeenCalled();
  });

  it("sleeps between checks and exits promptly when sleep observes abort", async () => {
    const controller = new AbortController();
    const sleep = vi.fn(async (_milliseconds: number, signal: AbortSignal) => {
      expect(signal).toBe(controller.signal);
      controller.abort();
    });
    const setup = dependencies({ sleep });

    await runNaverOrderSchedulerLoop(setup, controller.signal);

    expect(setup.store.enqueueDue).toHaveBeenCalledOnce();
    expect(sleep).toHaveBeenCalledWith(5_000, controller.signal);
  });

  it.each([
    ["pollIntervalMs", 0],
    ["syncIntervalMs", 0],
    ["initialLookbackMs", 0],
    ["maxAttempts", 101],
    ["batchSize", 1_001],
  ] as const)("rejects invalid %s", (name, value) => {
    const setup = dependencies();
    const config = { ...setup.config, [name]: value };

    expect(() => validateNaverOrderSchedulerConfig(config)).toThrow(name);
  });
});
