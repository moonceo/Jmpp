import type { Pool } from "pg";
import { describe, expect, it, vi } from "vitest";
import type { TransactionClient } from "@/lib/server/db";
import type {
  InboundClaimContext,
  InboundClaimSnapshotPayloadInput,
} from "@/lib/server/claims/schemas";
import { ClaimPersistenceError } from "@/lib/server/claims";
import { PostgresNaverSyncStore } from "@/lib/server/workers/naver-orders/postgres-store";
import type {
  LeasedNaverSyncRun,
  PreparedNaverRecord,
} from "@/lib/server/workers/naver-orders/types";

const NOW = new Date("2026-07-10T03:00:00.000Z");
const TENANT_ID = "00000000-0000-4000-8000-000000000001";
const ACCOUNT_ID = "00000000-0000-4000-8000-000000000002";
const RUN_ID = "00000000-0000-4000-8000-000000000003";
const ORDER_ID = "00000000-0000-4000-8000-000000000004";
const ITEM_ID = "00000000-0000-4000-8000-000000000005";
const SNAPSHOT_ID = "00000000-0000-4000-8000-000000000006";
const EVENT_ID = "00000000-0000-4000-8000-000000000007";

function result(rows: unknown[] = []) {
  return { rows, rowCount: rows.length, command: "SELECT", oid: 0, fields: [] };
}

function fakePool(options: { deferredConstraintError?: Error } = {}) {
  let subtransactionAborted = false;
  const query = vi.fn(async (statement: unknown, values?: unknown[]) => {
    void values;
    const sql = String(statement);
    if (subtransactionAborted) {
      if (sql === "ROLLBACK TO SAVEPOINT claim_snapshot_upsert") {
        subtransactionAborted = false;
        return result();
      }
      throw Object.assign(new Error("current transaction is aborted"), {
        code: "25P02",
      });
    }
    if (
      sql === "SET CONSTRAINTS claim_cases_line_consistency, claim_lines_case_consistency IMMEDIATE"
      && options.deferredConstraintError
    ) {
      subtransactionAborted = true;
      throw options.deferredConstraintError;
    }
    if (sql.includes("SELECT 1") && sql.includes("FROM sync_runs")) {
      return result([{}]);
    }
    if (sql.includes("INSERT INTO raw_snapshots")) {
      return result([{ id: SNAPSHOT_ID }]);
    }
    if (sql.includes("INSERT INTO integration_events")) {
      return result([{ id: EVENT_ID }]);
    }
    if (sql.includes("INSERT INTO sales_orders")) {
      return result([{ id: ORDER_ID, inserted: false }]);
    }
    if (sql.includes("INSERT INTO order_items")) {
      return result([{ id: ITEM_ID, inserted: false }]);
    }
    if (sql.includes("array_agg(internal_work_status")) {
      return result([{ item_total: "10000", item_statuses: ["READY_TO_SHIP"] }]);
    }
    return result();
  });
  const release = vi.fn();
  const pool = {
    connect: vi.fn(async () => ({ query, release })),
  } as unknown as Pool;
  return { pool, query };
}

function record(input: {
  carrierCode: string | null;
  trackingNumber: string | null;
}): PreparedNaverRecord {
  const timestamp = NOW.toISOString();
  return {
    change: {
      productOrderId: "provider-item-1",
      orderId: "provider-order-1",
      productOrderStatus: "PAYED",
      lastChangedDate: timestamp,
      lastChangedType: "PRODUCT_ORDER_STATUS_CHANGED",
    },
    detail: null,
    rawPayload: "{}",
    payloadSha256: "a".repeat(64),
    externalResourceId: "provider-item-1",
    sourceEventAt: timestamp,
    dedupeKey: `event:${input.carrierCode ?? "none"}:${input.trackingNumber ?? "none"}`,
    claimMapping: { snapshots: [], issues: [] },
    mapping: {
      ok: true,
      value: {
        order: {
          externalOrderId: "provider-order-1",
          externalOrderNumber: "provider-order-1",
          normalizedStatus: "READY_TO_SHIP",
          marketStatusRaw: "PAYED",
          grossAmount: 10_000,
          paidAmount: 10_000,
          buyerNameMasked: "구*",
          orderedAt: timestamp,
          paidAt: timestamp,
          sourceCreatedAt: timestamp,
          sourceUpdatedAt: timestamp,
          marketStatusUpdatedAt: timestamp,
          attributes: {},
        },
        item: {
          externalOrderItemId: "provider-item-1",
          sourceLineKey: "provider-item-1",
          marketProductId: "product-1",
          marketOptionId: null,
          sellerSku: null,
          productName: "상품",
          optionName: null,
          productUrl: null,
          thumbnailUrl: null,
          quantity: 1,
          unitPrice: 10_000,
          itemTotal: 10_000,
          paymentShippingFee: 0,
          internalWorkStatus: "READY_TO_SHIP",
          marketStatusRaw: "PAYED",
          marketFulfillmentStatus: "ACKNOWLEDGED",
          marketDeliveryMethod: "DELIVERY",
          domesticCarrierCode: input.carrierCode,
          domesticTrackingNumber: input.trackingNumber,
          sourceUpdatedAt: timestamp,
          attributes: {},
        },
        recipient: null,
      },
    },
  };
}

function recordWithClaim(): PreparedNaverRecord {
  const prepared = record({ carrierCode: null, trackingNumber: null });
  prepared.claimMapping = {
    issues: [],
    snapshots: [{
      externalOrderId: "provider-order-1",
      externalClaimId: "provider-claim-1",
      claimType: "RETURN",
      source: "MARKET",
      requesterType: "CUSTOMER",
      normalizedStatus: "REQUESTED",
      marketStatusRaw: "RETURN_REQUEST",
      resolutionType: "REFUND",
      resolutionStatus: "PENDING",
      requestedAt: NOW.toISOString(),
      sourceUpdatedAt: NOW.toISOString(),
      lines: [{
        externalOrderItemId: "provider-item-1",
        requestedQuantity: 1,
        resolutionType: "REFUND",
        resolutionStatus: "PENDING",
      }],
    }],
  };
  return prepared;
}

const APPLIED_CLAIM_RESULT = {
  claimId: "00000000-0000-4000-8000-000000000099",
  version: "1",
  normalizedStatus: "REQUESTED" as const,
  applied: true,
  replayed: false,
  ignoredReason: null,
};

const run: LeasedNaverSyncRun = {
  id: RUN_ID,
  tenantId: TENANT_ID,
  marketAccountId: ACCOUNT_ID,
  stream: "ORDERS",
  attemptCount: 1,
  maxAttempts: 3,
  windowStart: NOW.toISOString(),
  windowEnd: NOW.toISOString(),
};

describe("PostgresNaverSyncStore domestic invoice projection", () => {
  it.each([
    [null, null, null, null],
    ["CJGLS", null, null, null],
    [null, "1234567890", null, null],
    ["CJGLS", "1234567890", "CJGLS", "1234567890"],
  ] as const)(
    "binds provider pair %s/%s atomically as %s/%s",
    async (carrierCode, trackingNumber, expectedCarrier, expectedTracking) => {
      const fake = fakePool();
      const store = new PostgresNaverSyncStore({
        pool: fake.pool,
        encryptPayload: () => "encrypted",
      });

      await store.persistPage({
        run,
        leaseOwner: "worker-1",
        leaseDurationMs: 60_000,
        now: NOW,
        queryStartedAt: NOW.toISOString(),
        cursorBefore: {},
        cursorAfter: { cursorValue: {}, watermarkAt: null },
        advanceCursor: false,
        records: [record({ carrierCode, trackingNumber })],
        additionalSeen: 0,
        additionalSkipped: 0,
        additionalErrors: 0,
        overlapSeconds: 300,
        rawRetentionDays: 90,
      });

      const itemCall = fake.query.mock.calls.find(([statement]) =>
        String(statement).includes("INSERT INTO order_items"));
      expect(itemCall).toBeDefined();
      expect(itemCall?.[1]?.[19]).toBe(expectedCarrier);
      expect(itemCall?.[1]?.[20]).toBe(expectedTracking);

      const sql = String(itemCall?.[0]);
      expect(sql).toContain("WHEN EXCLUDED.domestic_carrier_code IS NOT NULL");
      expect(sql).toContain("AND EXCLUDED.domestic_tracking_number IS NOT NULL");
      expect(sql).toContain("ELSE order_items.domestic_carrier_code");
      expect(sql).toContain("ELSE order_items.domestic_tracking_number");
    },
  );

  it("injects the leased tenant context when persisting normalized Naver claims", async () => {
    const fake = fakePool();
    const upsertInboundClaim = vi.fn(async (...args: [
      TransactionClient,
      InboundClaimContext,
      InboundClaimSnapshotPayloadInput,
    ]) => {
      void args;
      return APPLIED_CLAIM_RESULT;
    });
    const store = new PostgresNaverSyncStore({
      pool: fake.pool,
      encryptPayload: () => "encrypted",
      upsertInboundClaim,
    });
    const prepared = recordWithClaim();

    await store.persistPage({
      run,
      leaseOwner: "worker-1",
      leaseDurationMs: 60_000,
      now: NOW,
      queryStartedAt: NOW.toISOString(),
      cursorBefore: {},
      cursorAfter: { cursorValue: {}, watermarkAt: null },
      advanceCursor: false,
      records: [prepared],
      additionalSeen: 0,
      additionalSkipped: 0,
      additionalErrors: 0,
      overlapSeconds: 300,
      rawRetentionDays: 90,
    });

    expect(upsertInboundClaim).toHaveBeenCalledWith(
      expect.anything(),
      {
        tenantId: TENANT_ID,
        marketAccountId: ACCOUNT_ID,
        correlationId: EVENT_ID,
      },
      expect.objectContaining({
        externalClaimId: "provider-claim-1",
        rawSnapshotRef: SNAPSHOT_ID,
      }),
    );
    const providerPayload = upsertInboundClaim.mock.calls[0]?.[2];
    expect(providerPayload).not.toHaveProperty("tenantId");
    expect(providerPayload).not.toHaveProperty("marketAccountId");

    const statements = fake.query.mock.calls.map(([statement]) => String(statement));
    const savepointIndex = statements.indexOf("SAVEPOINT claim_snapshot_upsert");
    const immediateIndex = statements.indexOf(
      "SET CONSTRAINTS claim_cases_line_consistency, claim_lines_case_consistency IMMEDIATE",
    );
    const deferredIndex = statements.indexOf(
      "SET CONSTRAINTS claim_cases_line_consistency, claim_lines_case_consistency DEFERRED",
    );
    const releaseIndex = statements.indexOf("RELEASE SAVEPOINT claim_snapshot_upsert");
    expect(savepointIndex).toBeGreaterThan(-1);
    expect(immediateIndex).toBeGreaterThan(savepointIndex);
    expect(deferredIndex).toBeGreaterThan(immediateIndex);
    expect(releaseIndex).toBeGreaterThan(deferredIndex);
  });

  it("quarantines a claim constraint failure without rolling back sibling orders", async () => {
    const constraintError = Object.assign(
      new Error("unsafe database detail must not be persisted"),
      { code: "23514" },
    );
    const fake = fakePool({ deferredConstraintError: constraintError });
    const upsertInboundClaim = vi.fn(async () => APPLIED_CLAIM_RESULT);
    const store = new PostgresNaverSyncStore({
      pool: fake.pool,
      encryptPayload: () => "encrypted",
      upsertInboundClaim,
    });
    const quarantined = recordWithClaim();
    const sibling = record({
      carrierCode: "CJGLS",
      trackingNumber: "1234567890",
    });

    const persisted = await store.persistPage({
      run,
      leaseOwner: "worker-1",
      leaseDurationMs: 60_000,
      now: NOW,
      queryStartedAt: NOW.toISOString(),
      cursorBefore: {},
      cursorAfter: {
        cursorValue: { lastChangedFrom: NOW.toISOString() },
        watermarkAt: NOW.toISOString(),
      },
      advanceCursor: true,
      records: [quarantined, sibling],
      additionalSeen: 0,
      additionalSkipped: 0,
      additionalErrors: 0,
      overlapSeconds: 300,
      rawRetentionDays: 90,
    });

    expect(persisted.errors).toBe(1);
    const calls = fake.query.mock.calls;
    expect(fake.query.mock.calls.filter(([statement]) =>
      String(statement).includes("INSERT INTO order_items"))).toHaveLength(2);
    expect(fake.query).toHaveBeenCalledWith("SAVEPOINT claim_snapshot_upsert");
    expect(fake.query).toHaveBeenCalledWith(
      "SET CONSTRAINTS claim_cases_line_consistency, claim_lines_case_consistency IMMEDIATE",
    );
    expect(fake.query).toHaveBeenCalledWith(
      "ROLLBACK TO SAVEPOINT claim_snapshot_upsert",
    );
    expect(fake.query).toHaveBeenCalledWith(
      "RELEASE SAVEPOINT claim_snapshot_upsert",
    );

    const quarantineAudit = fake.query.mock.calls.find(([statement]) =>
      String(statement).includes("CLAIM_INBOUND_QUARANTINED"));
    expect(quarantineAudit?.[1]?.[4]).toContain(
      '"code":"CLAIM_CONSTRAINT_VIOLATION"',
    );
    expect(quarantineAudit?.[1]?.[4]).not.toContain(
      "unsafe database detail",
    );
    expect(JSON.stringify(calls.flatMap(([, values]) => values ?? [])))
      .not.toContain("unsafe database detail");

    const failedEvent = fake.query.mock.calls.find(([statement, values]) =>
      String(statement).includes("UPDATE integration_events")
      && values?.[2] === "FAILED");
    expect(failedEvent?.[1]?.[4]).toBe("CLAIM_CONSTRAINT_VIOLATION");

    const indexOf = (predicate: (statement: string, values?: unknown[]) => boolean) =>
      calls.findIndex(([statement, values]) => predicate(String(statement), values));
    const rollbackIndex = indexOf((statement) =>
      statement === "ROLLBACK TO SAVEPOINT claim_snapshot_upsert");
    const releaseIndex = indexOf((statement) =>
      statement === "RELEASE SAVEPOINT claim_snapshot_upsert");
    const auditIndex = indexOf((statement) =>
      statement.includes("CLAIM_INBOUND_QUARANTINED"));
    const failedEventIndex = indexOf((statement, values) =>
      statement.includes("UPDATE integration_events") && values?.[2] === "FAILED");
    const cursorIndex = indexOf((statement) =>
      statement.includes("INSERT INTO sync_cursors"));
    const commitIndex = indexOf((statement) => statement === "COMMIT");
    expect(rollbackIndex).toBeGreaterThan(-1);
    expect(releaseIndex).toBeGreaterThan(rollbackIndex);
    expect(auditIndex).toBeGreaterThan(releaseIndex);
    expect(failedEventIndex).toBeGreaterThan(auditIndex);
    expect(cursorIndex).toBeGreaterThan(failedEventIndex);
    expect(commitIndex).toBeGreaterThan(cursorIndex);
  });

  it("durably audits a ClaimPersistenceError without persisting its unsafe message", async () => {
    const fake = fakePool();
    const upsertInboundClaim = vi.fn(async () => {
      throw new ClaimPersistenceError(
        "CLAIM_ORDER_ITEM_NOT_FOUND",
        "unsafe provider identifier and database context",
      );
    });
    const store = new PostgresNaverSyncStore({
      pool: fake.pool,
      encryptPayload: () => "encrypted",
      upsertInboundClaim,
    });

    const persisted = await store.persistPage({
      run,
      leaseOwner: "worker-1",
      leaseDurationMs: 60_000,
      now: NOW,
      queryStartedAt: NOW.toISOString(),
      cursorBefore: {},
      cursorAfter: {
        cursorValue: { lastChangedFrom: NOW.toISOString() },
        watermarkAt: NOW.toISOString(),
      },
      advanceCursor: true,
      records: [recordWithClaim()],
      additionalSeen: 0,
      additionalSkipped: 0,
      additionalErrors: 0,
      overlapSeconds: 300,
      rawRetentionDays: 90,
    });

    expect(persisted.errors).toBe(1);
    const audit = fake.query.mock.calls.find(([statement]) =>
      String(statement).includes("CLAIM_INBOUND_QUARANTINED"));
    expect(audit?.[1]?.[4]).toContain('"code":"CLAIM_ORDER_ITEM_NOT_FOUND"');
    const failedEvent = fake.query.mock.calls.find(([statement, values]) =>
      String(statement).includes("UPDATE integration_events")
      && values?.[2] === "FAILED");
    expect(failedEvent?.[1]?.[4]).toBe("CLAIM_ORDER_ITEM_NOT_FOUND");
    expect(failedEvent?.[1]?.[5]).toBe(
      "One or more marketplace claim snapshots were quarantined.",
    );
    expect(JSON.stringify(fake.query.mock.calls.flatMap(([, values]) => values ?? [])))
      .not.toContain("unsafe provider identifier");

    const statements = fake.query.mock.calls.map(([statement]) => String(statement));
    expect(statements.indexOf("ROLLBACK TO SAVEPOINT claim_snapshot_upsert"))
      .toBeLessThan(statements.findIndex((statement) =>
        statement.includes("CLAIM_INBOUND_QUARANTINED")));
    expect(statements.findIndex((statement) => statement.includes("INSERT INTO sync_cursors")))
      .toBeLessThan(statements.indexOf("COMMIT"));
  });
});
