import type { Pool } from "pg";
import type { TransactionClient } from "@/lib/server/db";
import type {
  InboundClaimContext,
  InboundClaimSnapshotPayloadInput,
} from "@/lib/server/claims/schemas";
import type { InboundClaimUpsertResult } from "@/lib/server/claims/types";
import type { NaverClaimMappingResult } from "@/lib/server/workers/naver-orders/claim-mapper";

import type {
  IntegrationResult,
} from "@/lib/server/integrations/core";
import type {
  NaverChangedProductOrder,
  NaverChangedProductOrdersPage,
  NaverChangedProductOrdersQuery,
  NaverCommerceCredentials,
  NaverProductOrderDetail,
  NaverProductOrderDetails,
} from "@/lib/server/integrations/naver";

export type NaverSyncStream = "ORDERS" | "ACCOUNT_VERIFY";
export type CompletedSyncStatus = "SUCCEEDED" | "PARTIAL";
export type FailedSyncStatus = "RETRY" | "FAILED";
export type AccountFailureStatus = "ERROR" | "REAUTH_REQUIRED";

export interface LeasedNaverSyncRun {
  id: string;
  tenantId: string;
  marketAccountId: string;
  stream: NaverSyncStream;
  attemptCount: number;
  maxAttempts: number;
  windowStart: string | null;
  windowEnd: string;
}

export interface NaverStoredCursor {
  cursorValue: Record<string, unknown>;
  watermarkAt: string | null;
  overlapSeconds: number;
}

export interface NaverSyncContext {
  encryptedCredentials: string;
  credentialSecretType: "MARKET_API_CREDENTIALS";
  accountSettings: Record<string, unknown>;
  cursor: NaverStoredCursor | null;
}

export interface NaverOrderSyncClient {
  getChangedProductOrders(
    query: NaverChangedProductOrdersQuery,
  ): Promise<IntegrationResult<NaverChangedProductOrdersPage>>;
  getProductOrderDetails(
    productOrderIds: readonly string[],
    options?: { quantityClaimCompatibility?: boolean },
  ): Promise<IntegrationResult<NaverProductOrderDetails>>;
}

export type NaverClientFactory = (
  credentials: NaverCommerceCredentials,
  accountSettings: Record<string, unknown>,
) => NaverOrderSyncClient;

export interface MappedNaverOrder {
  externalOrderId: string;
  externalOrderNumber: string | null;
  normalizedStatus:
    | "NEW"
    | "PREPARING"
    | "READY_TO_SHIP"
    | "SHIPPING"
    | "DELIVERED"
    | "CANCELED"
    | "ON_HOLD";
  marketStatusRaw: string;
  grossAmount: number;
  paidAmount: number;
  buyerNameMasked: string | null;
  orderedAt: string;
  paidAt: string | null;
  sourceCreatedAt: string | null;
  sourceUpdatedAt: string;
  marketStatusUpdatedAt: string;
  attributes: Record<string, unknown>;
}

export interface MappedNaverOrderItem {
  externalOrderItemId: string;
  sourceLineKey: string;
  marketProductId: string | null;
  marketOptionId: string | null;
  sellerSku: string | null;
  productName: string;
  optionName: string | null;
  productUrl: string | null;
  thumbnailUrl: string | null;
  quantity: number;
  unitPrice: number;
  itemTotal: number;
  paymentShippingFee: number;
  internalWorkStatus: MappedNaverOrder["normalizedStatus"];
  marketStatusRaw: string;
  marketFulfillmentStatus: string | null;
  marketDeliveryMethod: "DELIVERY" | "DIRECT_DELIVERY" | "OVERSEAS_OTHER_DELIVERY" | null;
  domesticCarrierCode: string | null;
  domesticTrackingNumber: string | null;
  sourceUpdatedAt: string;
  attributes: Record<string, unknown>;
}

export interface MappedNaverRecipient {
  name: string;
  nameMasked: string;
  phone: string | null;
  postalCode: string | null;
  addressLine1: string;
  addressLine2: string | null;
  personalCustomsCode: string | null;
  deliveryMessage: string | null;
}

export interface MappedNaverRecord {
  order: MappedNaverOrder;
  item: MappedNaverOrderItem;
  recipient: MappedNaverRecipient | null;
}

export type NaverMappingResult =
  | { ok: true; value: MappedNaverRecord }
  | {
      ok: false;
      code:
        | "MISSING_DETAIL"
        | "MISSING_PRODUCT_ORDER_ID"
        | "MISSING_ORDER_ID"
        | "INVALID_CHANGED_AT";
    };

export interface PreparedNaverRecord {
  change: NaverChangedProductOrder;
  detail: NaverProductOrderDetail | null;
  rawPayload: string;
  payloadSha256: string;
  externalResourceId: string;
  sourceEventAt: string | null;
  dedupeKey: string;
  mapping: NaverMappingResult;
  claimMapping: NaverClaimMappingResult;
}

export interface CursorCheckpoint {
  cursorValue: Record<string, unknown>;
  watermarkAt: string | null;
}

export interface PersistNaverPageInput {
  run: LeasedNaverSyncRun;
  leaseOwner: string;
  leaseDurationMs: number;
  now: Date;
  queryStartedAt: string;
  cursorBefore: Record<string, unknown>;
  cursorAfter: CursorCheckpoint;
  advanceCursor: boolean;
  records: readonly PreparedNaverRecord[];
  additionalSeen: number;
  additionalSkipped: number;
  additionalErrors: number;
  overlapSeconds: number;
  rawRetentionDays: number;
}

export interface PagePersistenceResult {
  inserted: number;
  updated: number;
  skipped: number;
  errors: number;
}

export interface SafeWorkerFailure {
  code: string;
  message: string;
  retryable: boolean;
  retryAfterMs?: number;
  accountStatus?: AccountFailureStatus;
}

export interface FinishRunInput {
  run: LeasedNaverSyncRun;
  leaseOwner: string;
  now: Date;
  status: CompletedSyncStatus;
  errorCode?: string;
  errorMessage?: string;
}

export interface FailRunInput {
  run: LeasedNaverSyncRun;
  leaseOwner: string;
  now: Date;
  status: FailedSyncStatus;
  nextAttemptAt: Date;
  failure: SafeWorkerFailure;
}

export interface CompleteAccountVerificationInput extends FinishRunInput {
  capabilities: Record<string, unknown>;
}

export interface NaverSyncStore {
  leaseNext(input: {
    leaseOwner: string;
    now: Date;
    leaseDurationMs: number;
    retryBaseMs: number;
    retryCapMs: number;
  }): Promise<LeasedNaverSyncRun | null>;
  renewLease(
    run: LeasedNaverSyncRun,
    leaseOwner: string,
    now: Date,
    leaseDurationMs: number,
  ): Promise<void>;
  loadContext(
    run: LeasedNaverSyncRun,
    leaseOwner: string,
    now: Date,
  ): Promise<NaverSyncContext>;
  persistPage(input: PersistNaverPageInput): Promise<PagePersistenceResult>;
  finishRun(input: FinishRunInput): Promise<void>;
  failRun(input: FailRunInput): Promise<void>;
  completeAccountVerification(
    input: CompleteAccountVerificationInput,
  ): Promise<void>;
}

export interface NaverWorkerClock {
  now(): Date;
}

export type NaverWorkerSleep = (
  milliseconds: number,
  signal: AbortSignal,
) => Promise<void>;

export interface NaverWorkerConfig {
  leaseOwner: string;
  leaseDurationMs: number;
  pollIntervalMs: number;
  changedOrdersPageSize: number;
  detailBatchSize: number;
  initialLookbackMs: number;
  defaultOverlapSeconds: number;
  rawRetentionDays: number;
  retryBaseMs: number;
  retryCapMs: number;
  accountVerificationWindowMs: number;
}

export interface NaverWorkerDependencies {
  store: NaverSyncStore;
  clientFactory: NaverClientFactory;
  decryptCredentials: (
    envelope: string,
    context: {
      tenantId: string;
      marketAccountId: string;
      secretType: "MARKET_API_CREDENTIALS";
    },
  ) => string;
  clock: NaverWorkerClock;
  sleep: NaverWorkerSleep;
  config: NaverWorkerConfig;
}

export interface PostgresNaverSyncStoreOptions {
  pool?: Pool;
  encryptPayload?: (
    plaintext: string,
    context: {
      tenantId: string;
      marketAccountId: string;
      secretType: "RAW_SNAPSHOT";
    },
  ) => string;
  encryptRecipientField?: (
    plaintext: string,
    context: {
      tenantId: string;
      marketAccountId: string;
      secretType: string;
    },
  ) => string;
  recipientBlindIndex?: (
    value: string,
    purpose: "PHONE" | "CUSTOMS" | "FINGERPRINT",
  ) => string;
  upsertInboundClaim?: (
    client: TransactionClient,
    context: InboundClaimContext,
    input: InboundClaimSnapshotPayloadInput,
  ) => Promise<InboundClaimUpsertResult>;
}
