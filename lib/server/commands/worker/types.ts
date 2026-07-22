import type { Pool } from "pg";
import type { IntegrationResult } from "@/lib/server/integrations/core";
import type {
    NaverBatchOperationResult,
    NaverCommerceCredentials,
    NaverDispatchProductOrder,
    NaverProductOrderDetails,
    NaverProductOrderDetailOptions,
    NaverSellerCancelRequest,
} from "@/lib/server/integrations/naver";

export const NAVER_OUTBOUND_COMMAND_TYPES = [
    "ORDER_CONFIRM",
    "INVOICE_SUBMIT",
    "DIRECT_DELIVERY",
    "SELLER_CANCEL",
] as const;

export type NaverOutboundCommandType =
    (typeof NAVER_OUTBOUND_COMMAND_TYPES)[number];

export type NaverCommandTerminalStatus =
    | "SUCCEEDED"
    | "RETRY"
    | "UNKNOWN"
    | "FAILED"
    | "DEAD";

export type NaverAttemptOutcome =
    | "SUCCESS"
    | "RETRYABLE"
    | "PERMANENT"
    | "UNKNOWN";

export type NaverCommandLeasePurpose = "EXECUTE" | "RECONCILE";

export interface LeasedNaverOutboundCommand {
    id: string;
    tenantId: string;
    marketAccountId: string;
    orderItemId: string;
    type: string;
    attemptCount: number;
    maxAttempts: number;
    expectedVersion: number | null;
    purpose: NaverCommandLeasePurpose;
    leaseOwner: string;
    leaseUntil: string;
}

export interface NaverCommandOrderItem {
    id: string;
    salesOrderId: string;
    version: number;
    externalOrderItemId: string | null;
    quantity: number;
    internalWorkStatus:
        | "NEW"
        | "PREPARING"
        | "READY_TO_SHIP"
        | "SHIPPING"
        | "DELIVERED"
        | "CANCELED"
        | "ON_HOLD";
    marketStatusRaw: string;
    marketFulfillmentStatus: string | null;
    sourcingStatus: string;
    marketDeliveryMethod: "DELIVERY" | "DIRECT_DELIVERY" | null;
    domesticCarrierCode: string | null;
    domesticTrackingNumber: string | null;
    confirmedAt: string | null;
    marketInvoiceSubmittedAt: string | null;
    attributes: Record<string, unknown>;
}

export interface NaverCommandExecutionContext {
    lease: LeasedNaverOutboundCommand;
    attemptId: string;
    payload: Record<string, unknown>;
    previousResult: Record<string, unknown> | null;
    correlationId: string;
    accountActive: boolean;
    accountAuthStatus: string;
    accountCapabilities: Record<string, unknown>;
    accountSettings: Record<string, unknown>;
    encryptedCredentials: string | null;
    credentialSecretType: "MARKET_API_CREDENTIALS";
    item: NaverCommandOrderItem | null;
}

export interface NaverCommandFinalization {
    status: NaverCommandTerminalStatus;
    attemptOutcome: NaverAttemptOutcome;
    code: string | null;
    message: string | null;
    responseSummary: Record<string, unknown>;
    httpStatus?: number;
    retryAfterMs?: number;
    nextAttemptAt?: Date;
    reconciled?: boolean;
}

export interface NaverCommandFinalizeResult {
    status: NaverCommandTerminalStatus;
}

export interface NaverOutboundCommandStore {
    leaseNext(input: {
        leaseOwner: string;
        now: Date;
        leaseDurationMs: number;
    }): Promise<LeasedNaverOutboundCommand | null>;
    beginAttempt(input: {
        lease: LeasedNaverOutboundCommand;
        leaseOwner: string;
        now: Date;
    }): Promise<NaverCommandExecutionContext>;
    finalize(input: {
        context: NaverCommandExecutionContext;
        leaseOwner: string;
        now: Date;
        resolution: NaverCommandFinalization;
    }): Promise<NaverCommandFinalizeResult>;
}

export interface NaverOutboundClient {
    getProductOrderDetails(
        productOrderIds: readonly string[],
        options?: NaverProductOrderDetailOptions,
    ): Promise<IntegrationResult<NaverProductOrderDetails>>;
    confirmProductOrders(
        productOrderIds: readonly string[],
    ): Promise<IntegrationResult<NaverBatchOperationResult>>;
    dispatchProductOrders(
        dispatchProductOrders: readonly NaverDispatchProductOrder[],
    ): Promise<IntegrationResult<NaverBatchOperationResult>>;
    requestCancelProductOrder(
        productOrderId: string,
        request: NaverSellerCancelRequest,
    ): Promise<IntegrationResult<NaverBatchOperationResult>>;
}

export type NaverOutboundClientFactory = (
    credentials: NaverCommerceCredentials,
    accountSettings: Record<string, unknown>,
) => NaverOutboundClient;

export interface NaverOutboundCommandWorkerConfig {
    leaseOwner: string;
    leaseDurationMs: number;
    retryBaseMs: number;
    retryCapMs: number;
}

export interface NaverOutboundCommandWorkerDependencies {
    store: NaverOutboundCommandStore;
    clientFactory: NaverOutboundClientFactory;
    decryptCredentials: (
        envelope: string,
        context: {
            tenantId: string;
            marketAccountId: string;
            secretType: "MARKET_API_CREDENTIALS";
        },
    ) => string;
    now: () => Date;
    config: NaverOutboundCommandWorkerConfig;
}

export interface PostgresNaverOutboundCommandStoreOptions {
    pool?: Pool;
}
