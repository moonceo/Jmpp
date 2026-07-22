import {
  NAVER_CHANGED_ORDERS_MAX_PAGE_SIZE,
  NAVER_PRODUCT_ORDER_DETAIL_MAX_BATCH_SIZE,
  NaverCommerceClient,
  type NaverChangedProductOrder,
  type NaverCommerceCredentials,
  type NaverProductOrderDetail,
} from "@/lib/server/integrations/naver";
import { decryptCredential } from "@/lib/server/security";
import {
  buildInitialNaverQuery,
  checkpointAfterPage,
  dedupeChangedProductOrders,
  prepareNaverRecord,
  productOrderIdFromDetail,
} from "@/lib/server/workers/naver-orders/mapper";
import {
  NaverSyncStoreError,
  PostgresNaverSyncStore,
} from "@/lib/server/workers/naver-orders/postgres-store";
import { buildNaverVerifiedAccountCapabilities } from "@/lib/server/workers/naver-orders/verified-capabilities";
import type {
  LeasedNaverSyncRun,
  NaverOrderSyncClient,
  NaverSyncContext,
  NaverWorkerConfig,
  NaverWorkerDependencies,
  NaverWorkerSleep,
  SafeWorkerFailure,
} from "@/lib/server/workers/naver-orders/types";

class SafeSyncError extends Error {
  constructor(readonly failure: SafeWorkerFailure) {
    super(failure.code);
    this.name = "SafeSyncError";
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function nonEmptyString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

export function parseNaverCredentials(plaintext: string): NaverCommerceCredentials {
  let parsed: unknown;
  try {
    parsed = JSON.parse(plaintext);
  } catch {
    throw new SafeSyncError({
      code: "INVALID_MARKET_CREDENTIALS",
      message: "The stored marketplace credentials are not valid JSON.",
      retryable: false,
      accountStatus: "ERROR",
    });
  }

  if (!isRecord(parsed)) {
    throw new SafeSyncError({
      code: "INVALID_MARKET_CREDENTIALS",
      message: "The stored marketplace credentials have an invalid shape.",
      retryable: false,
      accountStatus: "ERROR",
    });
  }

  const clientId = nonEmptyString(parsed.clientId);
  const clientSecret = nonEmptyString(parsed.clientSecret);
  if (
    parsed.type !== undefined &&
    parsed.type !== "SELF" &&
    parsed.type !== "SELLER"
  ) {
    throw new SafeSyncError({
      code: "INVALID_MARKET_CREDENTIALS",
      message: "The stored marketplace credential scope is invalid.",
      retryable: false,
      accountStatus: "ERROR",
    });
  }
  const type = parsed.type === "SELLER" ? "SELLER" : "SELF";
  const accountId = nonEmptyString(parsed.accountId);
  if (!clientId || !clientSecret || (type === "SELLER" && !accountId)) {
    throw new SafeSyncError({
      code: "INVALID_MARKET_CREDENTIALS",
      message: "The stored marketplace credentials are incomplete.",
      retryable: false,
      accountStatus: "ERROR",
    });
  }

  return {
    clientId,
    clientSecret,
    type,
    ...(accountId ? { accountId } : {}),
  };
}

function safeCode(value: unknown, fallback: string): string {
  const text = nonEmptyString(value);
  if (!text) return fallback;
  const normalized = text.toUpperCase().replace(/[^A-Z0-9_.-]/g, "_");
  return normalized.slice(0, 100) || fallback;
}

function safeAdapterFailure(result: {
  error: {
    kind: string;
    code?: string;
    retryable: boolean;
    retryAfterMs?: number;
  };
}): SafeWorkerFailure {
  const kind = result.error.kind;
  const messages: Record<string, string> = {
    validation: "The marketplace request did not pass local validation.",
    configuration: "The marketplace integration is not configured correctly.",
    authentication: "The marketplace rejected the account credentials.",
    authorization: "The marketplace account does not have the required permission.",
    not_found: "The requested marketplace resource was not found.",
    conflict: "The marketplace rejected the request because of a state conflict.",
    rate_limit: "The marketplace rate limit was reached.",
    timeout: "The marketplace request timed out.",
    aborted: "The marketplace request was interrupted.",
    network: "The marketplace could not be reached.",
    server: "The marketplace returned a temporary server error.",
    remote_rejection: "The marketplace rejected the request.",
    unexpected_response: "The marketplace returned an unsupported response.",
    http: "The marketplace returned an unsuccessful response.",
  };

  return {
    code: safeCode(result.error.code, `NAVER_${kind}`),
    message: messages[kind] ?? "The marketplace request failed.",
    retryable: result.error.retryable,
    ...(result.error.retryAfterMs === undefined
      ? {}
      : { retryAfterMs: result.error.retryAfterMs }),
    ...(kind === "authentication"
      ? { accountStatus: "REAUTH_REQUIRED" as const }
      : kind === "authorization" || kind === "configuration"
        ? { accountStatus: "ERROR" as const }
        : {}),
  };
}

function safeUnexpectedFailure(error: unknown): SafeWorkerFailure {
  if (error instanceof SafeSyncError) return error.failure;
  if (error instanceof NaverSyncStoreError) {
    if (
      error.code === "SYNC_CREDENTIALS_NOT_FOUND" ||
      error.code === "SYNC_CONTEXT_NOT_FOUND"
    ) {
      return {
        code: error.code,
        message: "The marketplace sync configuration is unavailable.",
        retryable: false,
        accountStatus: "ERROR",
      };
    }
    if (error.code === "ORDER_UPSERT_FAILED") {
      return {
        code: error.code,
        message: "The marketplace data could not be persisted.",
        retryable: true,
      };
    }
    return {
      code: error.code,
      message: "The marketplace sync lease is no longer available.",
      retryable: true,
    };
  }
  if (error instanceof Error && error.name === "CredentialEncryptionError") {
    return {
      code: "CREDENTIAL_DECRYPTION_FAILED",
      message: "The marketplace credentials could not be decrypted.",
      retryable: false,
      accountStatus: "ERROR",
    };
  }
  if (error instanceof Error && error.name === "AbortError") {
    return {
      code: "WORKER_ABORTED",
      message: "The worker stopped before the sync completed.",
      retryable: true,
    };
  }

  return {
    code: "NAVER_SYNC_INTERNAL_ERROR",
    message: "The marketplace sync failed because of an internal error.",
    retryable: true,
  };
}

export function calculateRetryDelayMs(input: {
  attemptCount: number;
  baseMs: number;
  capMs: number;
  retryAfterMs?: number;
}): number {
  const exponent = Math.min(Math.max(input.attemptCount - 1, 0), 20);
  const exponential = Math.min(input.capMs, input.baseMs * 2 ** exponent);
  const requested = input.retryAfterMs ?? 0;
  return Math.min(input.capMs, Math.max(exponential, requested));
}

function chunks<T>(values: readonly T[], size: number): T[][] {
  const result: T[][] = [];
  for (let index = 0; index < values.length; index += size) {
    result.push(values.slice(index, index + size));
  }
  return result;
}

function retryablePartial(issues: readonly { retryable: boolean }[]): boolean {
  return issues.some((issue) => issue.retryable);
}

async function fetchDetails(input: {
  client: NaverOrderSyncClient;
  changes: readonly NaverChangedProductOrder[];
  run: LeasedNaverSyncRun;
  dependencies: NaverWorkerDependencies;
  signal: AbortSignal;
}): Promise<{
  details: NaverProductOrderDetail[];
  partial: boolean;
  retryablePartial: boolean;
  failure?: SafeWorkerFailure;
}> {
  const details: NaverProductOrderDetail[] = [];
  let partial = false;
  let hasRetryablePartial = false;
  const productOrderIds = input.changes.map((change) => change.productOrderId);

  for (const batch of chunks(
    productOrderIds,
    input.dependencies.config.detailBatchSize,
  )) {
    if (input.signal.aborted) {
      throw new DOMException("Worker aborted", "AbortError");
    }
    const now = input.dependencies.clock.now();
    await input.dependencies.store.renewLease(
      input.run,
      input.dependencies.config.leaseOwner,
      now,
      input.dependencies.config.leaseDurationMs,
    );
    const result = await input.client.getProductOrderDetails(batch, {
      quantityClaimCompatibility: true,
    });
    if (result.outcome === "failure") {
      return {
        details,
        partial: true,
        retryablePartial: result.error.retryable,
        failure: safeAdapterFailure(result),
      };
    }

    details.push(...result.data.items);
    if (result.outcome === "partial") {
      partial = true;
      hasRetryablePartial ||= retryablePartial(result.issues);
    }
  }

  return { details, partial, retryablePartial: hasRetryablePartial };
}

async function syncOrders(input: {
  run: LeasedNaverSyncRun;
  context: NaverSyncContext;
  client: NaverOrderSyncClient;
  dependencies: NaverWorkerDependencies;
  signal: AbortSignal;
}): Promise<void> {
  const { run, context, client, dependencies, signal } = input;
  const initial = buildInitialNaverQuery({
    cursor: context.cursor,
    windowStart: run.windowStart,
    windowEnd: run.windowEnd,
    initialLookbackMs: dependencies.config.initialLookbackMs,
    defaultOverlapSeconds: dependencies.config.defaultOverlapSeconds,
  });
  const overlapSeconds =
    context.cursor?.overlapSeconds ?? dependencies.config.defaultOverlapSeconds;
  let query = {
    ...initial.query,
    limitCount: dependencies.config.changedOrdersPageSize,
  };
  let completedWithOmissions = false;
  const seenCursors = new Set<string>();

  while (true) {
    if (signal.aborted) throw new DOMException("Worker aborted", "AbortError");
    const beforeRequest = dependencies.clock.now();
    await dependencies.store.renewLease(
      run,
      dependencies.config.leaseOwner,
      beforeRequest,
      dependencies.config.leaseDurationMs,
    );
    const changedResult = await client.getChangedProductOrders(query);
    if (changedResult.outcome === "failure") {
      throw new SafeSyncError(safeAdapterFailure(changedResult));
    }

    const page = changedResult.data;
    const changes = dedupeChangedProductOrders(page.items);
    const detailResult = await fetchDetails({
      client,
      changes,
      run,
      dependencies,
      signal,
    });
    const detailsById = new Map<string, NaverProductOrderDetail>();
    let unexpectedDetailCount = 0;
    const expectedIds = new Set(changes.map((change) => change.productOrderId));
    for (const detail of detailResult.details) {
      const id = productOrderIdFromDetail(detail);
      if (!id || !expectedIds.has(id)) {
        unexpectedDetailCount += 1;
        continue;
      }
      detailsById.set(id, detail);
    }

    const records = changes.map((change) =>
      prepareNaverRecord(
        change,
        detailsById.get(change.productOrderId) ?? null,
      ),
    );
    const missingDetails = changes.some(
      (change) => !detailsById.has(change.productOrderId),
    );
    const mappingOmissions = records.some((record) => (
      !record.mapping.ok || record.claimMapping.issues.length > 0
    ));
    const pagePartial =
      changedResult.outcome === "partial" ||
      detailResult.partial ||
      detailResult.failure !== undefined ||
      missingDetails ||
      unexpectedDetailCount > 0 ||
      mappingOmissions;
    const mustRetryPage =
      (changedResult.outcome === "partial" &&
        retryablePartial(changedResult.issues)) ||
      detailResult.retryablePartial ||
      detailResult.failure !== undefined ||
      missingDetails;
    completedWithOmissions ||= pagePartial;
    const checkpoint = checkpointAfterPage({
      nextCursor: page.cursor,
      windowEnd: run.windowEnd,
    });

    const persistence = await dependencies.store.persistPage({
      run,
      leaseOwner: dependencies.config.leaseOwner,
      leaseDurationMs: dependencies.config.leaseDurationMs,
      now: dependencies.clock.now(),
      queryStartedAt: initial.queryStartedAt,
      cursorBefore: initial.cursorBefore,
      cursorAfter: checkpoint,
      advanceCursor: !mustRetryPage,
      records,
      additionalSeen: unexpectedDetailCount,
      additionalSkipped: unexpectedDetailCount,
      additionalErrors: unexpectedDetailCount,
      overlapSeconds,
      rawRetentionDays: dependencies.config.rawRetentionDays,
    });
    completedWithOmissions ||= persistence.errors > 0;

    if (detailResult.failure) {
      throw new SafeSyncError(detailResult.failure);
    }
    if (mustRetryPage) {
      throw new SafeSyncError({
        code: "NAVER_INCOMPLETE_ORDER_PAGE",
        message: "The marketplace order page was incomplete and will be retried.",
        retryable: true,
      });
    }
    if (!page.hasMore || !page.cursor) break;

    const cursorKey = `${page.cursor.lastChangedFrom}:${page.cursor.moreSequence}`;
    if (seenCursors.has(cursorKey)) {
      throw new SafeSyncError({
        code: "NAVER_CURSOR_DID_NOT_ADVANCE",
        message: "The marketplace pagination cursor did not advance.",
        retryable: true,
      });
    }
    seenCursors.add(cursorKey);
    query = {
      lastChangedFrom: page.cursor.lastChangedFrom,
      lastChangedTo: run.windowEnd,
      cursor: page.cursor,
      limitCount: dependencies.config.changedOrdersPageSize,
    };
  }

  await dependencies.store.finishRun({
    run,
    leaseOwner: dependencies.config.leaseOwner,
    now: dependencies.clock.now(),
    status: completedWithOmissions ? "PARTIAL" : "SUCCEEDED",
    ...(completedWithOmissions
      ? {
          errorCode: "NAVER_SYNC_PARTIAL",
          errorMessage: "The marketplace sync completed with omissions.",
        }
      : {}),
  });
}

async function verifyAccount(input: {
  run: LeasedNaverSyncRun;
  client: NaverOrderSyncClient;
  dependencies: NaverWorkerDependencies;
  signal: AbortSignal;
}): Promise<void> {
  const { run, client, dependencies, signal } = input;
  if (signal.aborted) throw new DOMException("Worker aborted", "AbortError");
  const now = dependencies.clock.now();
  await dependencies.store.renewLease(
    run,
    dependencies.config.leaseOwner,
    now,
    dependencies.config.leaseDurationMs,
  );
  const windowEnd = now;
  const result = await client.getChangedProductOrders({
    lastChangedFrom: new Date(
      windowEnd.getTime() - dependencies.config.accountVerificationWindowMs,
    ).toISOString(),
    lastChangedTo: windowEnd.toISOString(),
    limitCount: 1,
  });
  if (result.outcome === "failure") {
    throw new SafeSyncError(safeAdapterFailure(result));
  }
  if (
    result.outcome === "partial" &&
    retryablePartial(result.issues)
  ) {
    throw new SafeSyncError({
      code: "NAVER_ACCOUNT_VERIFY_PARTIAL",
      message: "The marketplace account verification was incomplete.",
      retryable: true,
    });
  }

  const partial = result.outcome === "partial";
  await dependencies.store.completeAccountVerification({
    run,
    leaseOwner: dependencies.config.leaseOwner,
    now: dependencies.clock.now(),
    status: partial ? "PARTIAL" : "SUCCEEDED",
    capabilities: buildNaverVerifiedAccountCapabilities(),
    ...(partial
      ? {
          errorCode: "NAVER_ACCOUNT_VERIFY_PARTIAL",
          errorMessage: "The marketplace account verification completed with warnings.",
        }
      : {}),
  });
}

async function markFailure(
  run: LeasedNaverSyncRun,
  dependencies: NaverWorkerDependencies,
  error: unknown,
): Promise<void> {
  const failure = safeUnexpectedFailure(error);
  const now = dependencies.clock.now();
  const canRetry = failure.retryable && run.attemptCount < run.maxAttempts;
  const delayMs = calculateRetryDelayMs({
    attemptCount: run.attemptCount,
    baseMs: dependencies.config.retryBaseMs,
    capMs: dependencies.config.retryCapMs,
    retryAfterMs: failure.retryAfterMs,
  });
  await dependencies.store.failRun({
    run,
    leaseOwner: dependencies.config.leaseOwner,
    now,
    status: canRetry ? "RETRY" : "FAILED",
    nextAttemptAt: new Date(now.getTime() + delayMs),
    failure,
  });
}

export async function runNaverWorkerIteration(
  dependencies: NaverWorkerDependencies,
  signal: AbortSignal,
): Promise<boolean> {
  if (signal.aborted) return false;
  const run = await dependencies.store.leaseNext({
    leaseOwner: dependencies.config.leaseOwner,
    now: dependencies.clock.now(),
    leaseDurationMs: dependencies.config.leaseDurationMs,
    retryBaseMs: dependencies.config.retryBaseMs,
    retryCapMs: dependencies.config.retryCapMs,
  });
  if (!run) return false;

  try {
    const context = await dependencies.store.loadContext(
      run,
      dependencies.config.leaseOwner,
      dependencies.clock.now(),
    );
    const plaintext = dependencies.decryptCredentials(
      context.encryptedCredentials,
      {
        tenantId: run.tenantId,
        marketAccountId: run.marketAccountId,
        secretType: context.credentialSecretType,
      },
    );
    const credentials = parseNaverCredentials(plaintext);
    const client = dependencies.clientFactory(
      credentials,
      context.accountSettings,
    );

    if (run.stream === "ACCOUNT_VERIFY") {
      await verifyAccount({ run, client, dependencies, signal });
    } else {
      await syncOrders({ run, context, client, dependencies, signal });
    }
  } catch (error) {
    if (
      error instanceof NaverSyncStoreError &&
      error.code === "SYNC_LEASE_LOST"
    ) {
      return true;
    }
    await markFailure(run, dependencies, error);
  }

  return true;
}

export const defaultNaverWorkerSleep: NaverWorkerSleep = (
  milliseconds,
  signal,
) =>
  new Promise((resolve) => {
    if (signal.aborted || milliseconds <= 0) {
      resolve();
      return;
    }
    const timeout = setTimeout(done, milliseconds);
    signal.addEventListener("abort", done, { once: true });

    function done(): void {
      clearTimeout(timeout);
      signal.removeEventListener("abort", done);
      resolve();
    }
  });

export function createDefaultNaverWorkerDependencies(
  config: NaverWorkerConfig,
): NaverWorkerDependencies {
  return {
    store: new PostgresNaverSyncStore(),
    clientFactory: (credentials) => new NaverCommerceClient({ credentials }),
    decryptCredentials: decryptCredential,
    clock: { now: () => new Date() },
    sleep: defaultNaverWorkerSleep,
    config,
  };
}

export function validateNaverWorkerConfig(config: NaverWorkerConfig): void {
  const positiveValues: Array<[string, number]> = [
    ["leaseDurationMs", config.leaseDurationMs],
    ["pollIntervalMs", config.pollIntervalMs],
    ["changedOrdersPageSize", config.changedOrdersPageSize],
    ["detailBatchSize", config.detailBatchSize],
    ["initialLookbackMs", config.initialLookbackMs],
    ["rawRetentionDays", config.rawRetentionDays],
    ["retryBaseMs", config.retryBaseMs],
    ["retryCapMs", config.retryCapMs],
    ["accountVerificationWindowMs", config.accountVerificationWindowMs],
  ];
  for (const [name, value] of positiveValues) {
    if (!Number.isSafeInteger(value) || value <= 0) {
      throw new Error(`${name} must be a positive safe integer.`);
    }
  }
  if (!config.leaseOwner.trim()) throw new Error("leaseOwner is required.");
  if (
    !Number.isSafeInteger(config.defaultOverlapSeconds) ||
    config.defaultOverlapSeconds < 0 ||
    config.defaultOverlapSeconds > 86_400
  ) {
    throw new Error("defaultOverlapSeconds must be between 0 and 86400.");
  }
  if (config.changedOrdersPageSize > NAVER_CHANGED_ORDERS_MAX_PAGE_SIZE) {
    throw new Error(
      `changedOrdersPageSize must not exceed ${NAVER_CHANGED_ORDERS_MAX_PAGE_SIZE}.`,
    );
  }
  if (config.detailBatchSize > NAVER_PRODUCT_ORDER_DETAIL_MAX_BATCH_SIZE) {
    throw new Error(
      `detailBatchSize must not exceed ${NAVER_PRODUCT_ORDER_DETAIL_MAX_BATCH_SIZE}.`,
    );
  }
  if (config.retryBaseMs > config.retryCapMs) {
    throw new Error("retryBaseMs must not exceed retryCapMs.");
  }
}

export async function runNaverWorkerLoop(
  dependencies: NaverWorkerDependencies,
  signal: AbortSignal,
): Promise<void> {
  validateNaverWorkerConfig(dependencies.config);

  while (!signal.aborted) {
    let handled = false;
    try {
      handled = await runNaverWorkerIteration(dependencies, signal);
    } catch {
      // The loop deliberately logs no exception object because database and
      // transport errors can contain request payloads or connection secrets.
      console.error("A Naver worker iteration failed before it could be recorded.");
    }
    if (!handled && !signal.aborted) {
      await dependencies.sleep(
        dependencies.config.pollIntervalMs,
        signal,
      );
    }
  }
}
