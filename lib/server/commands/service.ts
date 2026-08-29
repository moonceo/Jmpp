import { randomUUID } from "node:crypto";
import { z } from "zod";
import { createPendingOutboundCommand } from "@/lib/server/application/outbound-command-lifecycle";
import type { TransactionClient } from "@/lib/server/db";
import {
    decideCapabilityExecution,
    MARKET_CAPABILITY_MODES,
    type MarketCapability,
    type MarketCapabilityAction,
} from "@/lib/server/domain/market-capability";
import { ApiError } from "@/lib/server/http/api-error";
import {
    findOutboundCommandByIdempotencyKey,
    insertPendingOutboundCommand,
    lockOrderItemCommandContext,
    type LockedOrderItemCommandContext,
    type StoredOutboundCommand,
} from "@/lib/server/commands/repository";
import type {
    OrderItemCommandRequest,
} from "@/lib/server/commands/schemas";

const storedCapabilitySchema = z.object({
    action: z.string().optional(),
    mode: z.enum(MARKET_CAPABILITY_MODES),
    officialDocumentReviewedAt: z.string().nullable().optional(),
    uatStatus: z.enum(["NOT_RUN", "PASSED", "FAILED"]).optional(),
    note: z.string().nullable().optional(),
}).passthrough();

export interface AcceptOrderItemCommandInput {
    tenantId: string;
    membershipId: string;
    orderItemId: string;
    correlationId: string;
    request: OrderItemCommandRequest;
    commandId?: string;
    createdAt?: string;
}

export interface AcceptedOrderItemCommand {
    command: StoredOutboundCommand;
    replayed: boolean;
}

export interface PublicOutboundCommand {
    id: string;
    marketAccountId: string;
    orderItemId: string | null;
    aggregateType: StoredOutboundCommand["aggregateType"];
    aggregateId: string;
    type: StoredOutboundCommand["type"];
    status: StoredOutboundCommand["status"];
    expectedVersion: number | null;
    payloadSummary: Record<string, unknown>;
    attemptCount: number;
    maxAttempts: number;
    nextAttemptAt: string | null;
    lastErrorCode: string | null;
    resultAvailable: boolean;
    succeededAt: string | null;
    failedAt: string | null;
    correlationId: string;
    version: number;
    createdAt: string;
    updatedAt: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

function canonicalJson(value: unknown): string {
    if (value === null || typeof value !== "object") return JSON.stringify(value);
    if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;

    return `{${Object.entries(value)
        .filter(([, entry]) => entry !== undefined)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, entry]) => `${JSON.stringify(key)}:${canonicalJson(entry)}`)
        .join(",")}}`;
}

function configuredCapability(
    capabilities: unknown,
    action: MarketCapabilityAction,
): MarketCapability | undefined {
    if (!isRecord(capabilities)) return undefined;

    const parsed = storedCapabilitySchema.safeParse(capabilities[action]);
    if (!parsed.success || (parsed.data.action && parsed.data.action !== action)) return undefined;

    return {
        action,
        mode: parsed.data.mode,
        officialDocumentReviewedAt: parsed.data.officialDocumentReviewedAt ?? null,
        uatStatus: parsed.data.uatStatus ?? "NOT_RUN",
        note: parsed.data.note ?? null,
    };
}

export function requireConfiguredApiCapability(
    capabilities: unknown,
    action: MarketCapabilityAction,
): void {
    const capability = configuredCapability(capabilities, action);
    const decision = decideCapabilityExecution(capability);
    const sellerCancelUatMissing = action === "SELLER_CANCEL"
        && capability?.uatStatus !== "PASSED";

    if (decision.execution !== "API" || sellerCancelUatMissing) {
        throw new ApiError(
            422,
            "MARKET_CAPABILITY_NOT_API",
            "The market account is not configured for this API command.",
            {
                action,
                reason: sellerCancelUatMissing
                    ? "ACCOUNT_UAT_REQUIRED"
                    : decision.reason,
            },
        );
    }
}

function capabilityActionForRequest(request: OrderItemCommandRequest): MarketCapabilityAction {
    if (request.type === "SHIPPING_PROCESS") {
        return request.payload.requestedMethod === "DIRECT_DELIVERY"
            ? "DIRECT_DELIVERY"
            : "INVOICE_SUBMIT";
    }
    return request.type;
}

export function applyConfiguredShippingProcessPreference(
    request: OrderItemCommandRequest,
    context: Pick<LockedOrderItemCommandContext, "marketCode" | "settings">,
): OrderItemCommandRequest {
    void context;
    return request;
}

export function isExactCommandReplay(
    existing: StoredOutboundCommand,
    context: LockedOrderItemCommandContext,
    request: OrderItemCommandRequest,
): boolean {
    return existing.marketAccountId === context.marketAccountId
        && existing.orderItemId === context.id
        && existing.aggregateType === "ORDER_ITEM"
        && existing.aggregateId === context.id
        && existing.type === request.type
        && existing.expectedVersion === request.expectedVersion
        && canonicalJson(existing.payload) === canonicalJson(request.payload);
}

function requireUsableMarketAccount(context: LockedOrderItemCommandContext): void {
    if (!context.accountIsActive || context.accountAuthStatus !== "CONNECTED") {
        throw new ApiError(
            409,
            "MARKET_ACCOUNT_NOT_CONNECTED",
            "The market account must be active and connected before accepting commands.",
            {
                marketCode: context.marketCode,
                authStatus: context.accountAuthStatus,
                active: context.accountIsActive,
            },
        );
    }
}

function idempotencyConflict(): ApiError {
    return new ApiError(
        409,
        "IDEMPOTENCY_KEY_CONFLICT",
        "The effect key was already used for a different command request.",
    );
}

export async function acceptOrderItemCommand(
    client: TransactionClient,
    input: AcceptOrderItemCommandInput,
): Promise<AcceptedOrderItemCommand> {
    const context = await lockOrderItemCommandContext(
        client,
        input.tenantId,
        input.orderItemId,
    );

    if (!context) {
        throw new ApiError(404, "ORDER_ITEM_NOT_FOUND", "The order item was not found.");
    }

    const request = applyConfiguredShippingProcessPreference(input.request, context);

    const pending = createPendingOutboundCommand({
        id: input.commandId ?? randomUUID(),
        tenantId: input.tenantId,
        aggregate: {
            type: "ORDER_ITEM",
            id: context.id,
            expectedVersion: request.expectedVersion,
        },
        type: request.type,
        effectKey: request.effectKey,
        payload: request.payload,
        requestedBy: input.membershipId,
        correlationId: input.correlationId,
        createdAt: input.createdAt ?? new Date().toISOString(),
    });

    const existing = await findOutboundCommandByIdempotencyKey(
        client,
        input.tenantId,
        pending.idempotencyKey,
    );

    if (existing) {
        if (!isExactCommandReplay(existing, context, request)) {
            throw idempotencyConflict();
        }

        return { command: existing, replayed: true };
    }

    if (context.version !== request.expectedVersion) {
        throw new ApiError(
            409,
            "ORDER_ITEM_VERSION_CONFLICT",
            "The order item changed after it was loaded. Refresh and retry.",
            {
                expectedVersion: request.expectedVersion,
                currentVersion: context.version,
            },
        );
    }

    requireUsableMarketAccount(context);
    requireConfiguredApiCapability(context.capabilities, capabilityActionForRequest(request));

    const inserted = await insertPendingOutboundCommand(
        client,
        context.marketAccountId,
        context.id,
        input.membershipId,
        pending,
    );

    if (inserted) return { command: inserted, replayed: false };

    // The row lock makes this rare, but the unique constraint remains the final
    // concurrency guard. Re-read and apply the same exact-replay rule.
    const raced = await findOutboundCommandByIdempotencyKey(
        client,
        input.tenantId,
        pending.idempotencyKey,
    );

    if (!raced || !isExactCommandReplay(raced, context, request)) {
        throw idempotencyConflict();
    }

    return { command: raced, replayed: true };
}

function maskedTrackingNumber(value: unknown): string | undefined {
    if (typeof value !== "string") return undefined;
    const visible = value.slice(-4);
    return `${"*".repeat(Math.max(4, value.length - visible.length))}${visible}`;
}

function payloadSummary(command: StoredOutboundCommand): Record<string, unknown> {
    const payload = command.payload;

    switch (command.type) {
        case "INVOICE_SUBMIT":
            return {
                carrierCode: payload.carrierCode,
                trackingNumberMasked: maskedTrackingNumber(payload.trackingNumber),
                dispatchAt: payload.dispatchAt,
            };
        case "DIRECT_DELIVERY":
            return { dispatchAt: payload.dispatchAt };
        case "SHIPPING_PROCESS":
            return {
                requestedMethod: payload.requestedMethod,
                ...(payload.requestedMethod === "OVERSEAS_OTHER_DELIVERY" ? {
                    carrierCode: payload.carrierCode,
                    trackingNumberMasked: maskedTrackingNumber(payload.trackingNumber),
                } : {}),
                dispatchAt: payload.dispatchAt,
            };
        case "SELLER_CANCEL":
            return {
                reasonCode: payload.reasonCode,
                quantity: payload.quantity,
            };
        case "ORDER_CONFIRM":
        default:
            return {};
    }
}

/** Public projection deliberately omits raw result/error text and requester IDs. */
export function toPublicOutboundCommand(
    command: StoredOutboundCommand,
): PublicOutboundCommand {
    return {
        id: command.id,
        marketAccountId: command.marketAccountId,
        orderItemId: command.orderItemId,
        aggregateType: command.aggregateType,
        aggregateId: command.aggregateId,
        type: command.type,
        status: command.status,
        expectedVersion: command.expectedVersion,
        payloadSummary: payloadSummary(command),
        attemptCount: command.attemptCount,
        maxAttempts: command.maxAttempts,
        nextAttemptAt: command.nextAttemptAt,
        lastErrorCode: command.lastErrorCode,
        resultAvailable: command.result !== null,
        succeededAt: command.succeededAt,
        failedAt: command.failedAt,
        correlationId: command.correlationId,
        version: command.version,
        createdAt: command.createdAt,
        updatedAt: command.updatedAt,
    };
}
