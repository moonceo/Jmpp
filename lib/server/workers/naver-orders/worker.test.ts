import { describe, expect, it, vi } from "vitest";

import type {
  IntegrationResult,
  RawHttpResponse,
} from "@/lib/server/integrations/core";
import type {
  NaverChangedProductOrdersPage,
  NaverProductOrderDetails,
} from "@/lib/server/integrations/naver";
import type {
  LeasedNaverSyncRun,
  NaverOrderSyncClient,
  NaverSyncStore,
  NaverWorkerConfig,
  NaverWorkerDependencies,
} from "@/lib/server/workers/naver-orders/types";
import {
  calculateRetryDelayMs,
  parseNaverCredentials,
  runNaverWorkerIteration,
} from "@/lib/server/workers/naver-orders/worker";

const raw: RawHttpResponse = {
  requestUrl: "https://api.commerce.naver.com/test",
  requestMethod: "GET",
  status: 200,
  statusText: "OK",
  headers: {},
  body: {},
  bodyText: "{}",
  receivedAtMs: Date.parse("2026-07-10T02:00:00.000Z"),
};

const config: NaverWorkerConfig = {
  leaseOwner: "test-worker",
  leaseDurationMs: 120_000,
  pollIntervalMs: 1_000,
  changedOrdersPageSize: 300,
  detailBatchSize: 300,
  initialLookbackMs: 86_400_000,
  defaultOverlapSeconds: 300,
  rawRetentionDays: 90,
  retryBaseMs: 5_000,
  retryCapMs: 60_000,
  accountVerificationWindowMs: 300_000,
};

function leasedRun(stream: "ORDERS" | "ACCOUNT_VERIFY"): LeasedNaverSyncRun {
  return {
    id: "00000000-0000-4000-8000-000000000001",
    tenantId: "00000000-0000-4000-8000-000000000002",
    marketAccountId: "00000000-0000-4000-8000-000000000003",
    stream,
    attemptCount: 1,
    maxAttempts: 8,
    windowStart: null,
    windowEnd: "2026-07-10T02:00:00.000Z",
  };
}

function success<T>(data: T): IntegrationResult<T> {
  return { ok: true, outcome: "success", data, raw };
}

function fakeStore(run: LeasedNaverSyncRun): NaverSyncStore {
  return {
    leaseNext: vi.fn(async () => run),
    renewLease: vi.fn(async () => undefined),
    loadContext: vi.fn(async () => ({
      encryptedCredentials: "encrypted",
      credentialSecretType: "MARKET_API_CREDENTIALS" as const,
      accountSettings: {},
      cursor: null,
    })),
    persistPage: vi.fn(async () => ({
      inserted: 1,
      updated: 0,
      skipped: 0,
      errors: 0,
    })),
    finishRun: vi.fn(async () => undefined),
    failRun: vi.fn(async () => undefined),
    completeAccountVerification: vi.fn(async () => undefined),
  };
}

function dependencies(input: {
  run: LeasedNaverSyncRun;
  client: NaverOrderSyncClient;
}): NaverWorkerDependencies {
  return {
    store: fakeStore(input.run),
    clientFactory: () => input.client,
    decryptCredentials: () =>
      JSON.stringify({
        clientId: "client-id",
        clientSecret: "client-secret",
        type: "SELF",
      }),
    clock: { now: () => new Date("2026-07-10T02:00:00.000Z") },
    sleep: vi.fn(async () => undefined),
    config,
  };
}

const oneChangedOrderPage: NaverChangedProductOrdersPage = {
  items: [
    {
      productOrderStatus: "PAYED",
      productOrderId: "po-1",
      orderId: "order-1",
      lastChangedDate: "2026-07-10T01:30:00.000Z",
      lastChangedType: "PAYED",
    },
  ],
  count: 1,
  cursor: null,
  hasMore: false,
};

const oneOrderDetail: NaverProductOrderDetails = {
  items: [
    {
      order: {
        orderId: "order-1",
        orderDate: "2026-07-10T01:00:00.000Z",
        paymentDate: "2026-07-10T01:01:00.000Z",
      },
      productOrder: {
        productOrderId: "po-1",
        orderId: "order-1",
        productName: "상품",
        productOrderStatus: "PAYED",
        quantity: 1,
        totalPaymentAmount: 10_000,
      },
    },
  ],
};

describe("runNaverWorkerIteration", () => {
  it("persists a complete order page before advancing the cursor", async () => {
    const run = leasedRun("ORDERS");
    const client: NaverOrderSyncClient = {
      getChangedProductOrders: vi.fn(async () => success(oneChangedOrderPage)),
      getProductOrderDetails: vi.fn(async () => success(oneOrderDetail)),
    };
    const deps = dependencies({ run, client });

    expect(
      await runNaverWorkerIteration(deps, new AbortController().signal),
    ).toBe(true);

    expect(deps.store.persistPage).toHaveBeenCalledWith(
      expect.objectContaining({
        run,
        advanceCursor: true,
        cursorAfter: {
          cursorValue: { lastChangedFrom: run.windowEnd },
          watermarkAt: run.windowEnd,
        },
      }),
    );
    expect(client.getProductOrderDetails).toHaveBeenCalledWith(
      ["po-1"],
      { quantityClaimCompatibility: true },
    );
    expect(deps.store.finishRun).toHaveBeenCalledWith(
      expect.objectContaining({ status: "SUCCEEDED" }),
    );
    expect(deps.store.failRun).not.toHaveBeenCalled();
  });

  it("advances a complete partial result but records the run as PARTIAL", async () => {
    const run = leasedRun("ORDERS");
    const client: NaverOrderSyncClient = {
      getChangedProductOrders: vi.fn(async () => ({
        ok: false as const,
        outcome: "partial" as const,
        data: oneChangedOrderPage,
        issues: [
          {
            kind: "warning" as const,
            code: "NAVER_WARNING",
            message: "remote warning detail",
            retryable: false,
          },
        ],
        raw,
      })),
      getProductOrderDetails: vi.fn(async () => success(oneOrderDetail)),
    };
    const deps = dependencies({ run, client });

    await runNaverWorkerIteration(deps, new AbortController().signal);

    expect(deps.store.persistPage).toHaveBeenCalledWith(
      expect.objectContaining({ advanceCursor: true }),
    );
    expect(deps.store.finishRun).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "PARTIAL",
        errorCode: "NAVER_SYNC_PARTIAL",
      }),
    );
    expect(deps.store.failRun).not.toHaveBeenCalled();
  });

  it("persists the raw change but does not advance the cursor when detail is missing", async () => {
    const run = leasedRun("ORDERS");
    const client: NaverOrderSyncClient = {
      getChangedProductOrders: vi.fn(async () => success(oneChangedOrderPage)),
      getProductOrderDetails: vi.fn(async () => success({ items: [] })),
    };
    const deps = dependencies({ run, client });

    await runNaverWorkerIteration(deps, new AbortController().signal);

    expect(deps.store.persistPage).toHaveBeenCalledWith(
      expect.objectContaining({ advanceCursor: false }),
    );
    expect(deps.store.failRun).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "RETRY",
        failure: expect.objectContaining({
          code: "NAVER_INCOMPLETE_ORDER_PAGE",
        }),
      }),
    );
    expect(deps.store.finishRun).not.toHaveBeenCalled();
  });

  it("records fetched changes before retrying a failed detail request", async () => {
    const run = leasedRun("ORDERS");
    const client: NaverOrderSyncClient = {
      getChangedProductOrders: vi.fn(async () => success(oneChangedOrderPage)),
      getProductOrderDetails: vi.fn(async () => ({
        ok: false as const,
        outcome: "failure" as const,
        error: {
          kind: "timeout" as const,
          code: "DETAIL_TIMEOUT",
          message: "remote detail",
          retryable: true,
        },
      })),
    };
    const deps = dependencies({ run, client });

    await runNaverWorkerIteration(deps, new AbortController().signal);

    expect(deps.store.persistPage).toHaveBeenCalledWith(
      expect.objectContaining({
        advanceCursor: false,
        records: [
          expect.objectContaining({
            externalResourceId: "po-1",
            detail: null,
          }),
        ],
      }),
    );
    expect(deps.store.failRun).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "RETRY",
        failure: expect.objectContaining({ code: "DETAIL_TIMEOUT" }),
      }),
    );
  });

  it("stores only a safe error classification for remote failures", async () => {
    const run = leasedRun("ORDERS");
    const client: NaverOrderSyncClient = {
      getChangedProductOrders: vi.fn(async () => ({
        ok: false as const,
        outcome: "failure" as const,
        error: {
          kind: "network" as const,
          code: "ECONNRESET",
          message: "secret-token and customer address",
          retryable: true,
        },
      })),
      getProductOrderDetails: vi.fn(),
    };
    const deps = dependencies({ run, client });

    await runNaverWorkerIteration(deps, new AbortController().signal);

    const failMock = vi.mocked(deps.store.failRun);
    expect(failMock).toHaveBeenCalledOnce();
    const failure = failMock.mock.calls[0][0].failure;
    expect(failure).toMatchObject({
      code: "ECONNRESET",
      message: "The marketplace could not be reached.",
      retryable: true,
    });
    expect(JSON.stringify(failure)).not.toContain("secret-token");
    expect(JSON.stringify(failure)).not.toContain("customer address");
  });

  it("verifies account access without touching the order cursor", async () => {
    const run = leasedRun("ACCOUNT_VERIFY");
    const client: NaverOrderSyncClient = {
      getChangedProductOrders: vi.fn(async () =>
        success({ items: [], count: 0, cursor: null, hasMore: false }),
      ),
      getProductOrderDetails: vi.fn(),
    };
    const deps = dependencies({ run, client });

    await runNaverWorkerIteration(deps, new AbortController().signal);

    expect(deps.store.completeAccountVerification).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "SUCCEEDED",
        capabilities: expect.objectContaining({
          ORDER_CONFIRM: expect.objectContaining({
            mode: "MANUAL_FALLBACK",
            uatStatus: "NOT_RUN",
          }),
          INVOICE_SUBMIT: expect.objectContaining({
            mode: "MANUAL_FALLBACK",
            uatStatus: "NOT_RUN",
          }),
          DIRECT_DELIVERY: expect.objectContaining({
            mode: "MANUAL_FALLBACK",
            uatStatus: "NOT_RUN",
          }),
          SELLER_CANCEL: expect.objectContaining({
            mode: "MANUAL_FALLBACK",
            uatStatus: "NOT_RUN",
          }),
          RETURN_CLAIM: expect.objectContaining({ mode: "UNSUPPORTED" }),
          adapterManifest: expect.objectContaining({ documentVersion: "2.82.0" }),
        }),
      }),
    );
    expect(deps.store.persistPage).not.toHaveBeenCalled();
    expect(deps.store.finishRun).not.toHaveBeenCalled();
  });

  it("marks rejected account credentials for reauthentication", async () => {
    const run = leasedRun("ACCOUNT_VERIFY");
    const client: NaverOrderSyncClient = {
      getChangedProductOrders: vi.fn(async () => ({
        ok: false as const,
        outcome: "failure" as const,
        error: {
          kind: "authentication" as const,
          code: "INVALID_TOKEN",
          message: "remote response details",
          retryable: false,
        },
      })),
      getProductOrderDetails: vi.fn(),
    };
    const deps = dependencies({ run, client });

    await runNaverWorkerIteration(deps, new AbortController().signal);

    expect(deps.store.failRun).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "FAILED",
        failure: expect.objectContaining({
          accountStatus: "REAUTH_REQUIRED",
        }),
      }),
    );
    expect(deps.store.completeAccountVerification).not.toHaveBeenCalled();
  });
});

describe("worker policies", () => {
  it("uses bounded exponential retry delay and honors retry-after", () => {
    expect(
      calculateRetryDelayMs({
        attemptCount: 3,
        baseMs: 1_000,
        capMs: 10_000,
      }),
    ).toBe(4_000);
    expect(
      calculateRetryDelayMs({
        attemptCount: 3,
        baseMs: 1_000,
        capMs: 10_000,
        retryAfterMs: 8_000,
      }),
    ).toBe(8_000);
  });

  it("validates seller-scoped credential shape", () => {
    expect(
      parseNaverCredentials(
        JSON.stringify({
          clientId: "id",
          clientSecret: "secret",
          type: "SELLER",
          accountId: "seller",
        }),
      ),
    ).toEqual({
      clientId: "id",
      clientSecret: "secret",
      type: "SELLER",
      accountId: "seller",
    });
    expect(() =>
      parseNaverCredentials(
        JSON.stringify({
          clientId: "id",
          clientSecret: "secret",
          type: "SELLER",
        }),
      ),
    ).toThrow();
  });
});
