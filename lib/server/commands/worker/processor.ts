import { z } from "zod";
import { failureResult, type IntegrationFailure } from "@/lib/server/integrations/core";
import {
    NaverCommerceClient,
    type NaverCommerceCredentials,
    type NaverProductOrderDetail,
} from "@/lib/server/integrations/naver";
import { decryptCredential } from "@/lib/server/security";
import {
    classifyNaverIntegrationFailure,
    inspectNaverProviderTarget,
    parseNaverCommandPayload,
    resolveNaverBatchResult,
    validateNaverCommandPreconditions,
    type ParsedNaverCommandPayload,
} from "@/lib/server/commands/worker/policy";
import { PostgresNaverOutboundCommandStore } from "@/lib/server/commands/worker/postgres-store";
import type {
    NaverCommandExecutionContext,
    NaverCommandFinalization,
    NaverOutboundClient,
    NaverOutboundClientFactory,
    NaverOutboundCommandWorkerConfig,
    NaverOutboundCommandWorkerDependencies,
} from "@/lib/server/commands/worker/types";

const credentialSchema = z.object({
    clientId: z.string().trim().min(1),
    clientSecret: z.string().min(1),
    type: z.enum(["SELF", "SELLER"]).default("SELF"),
    accountId: z.string().trim().min(1).optional(),
}).strict().superRefine((value, context) => {
    if (value.type === "SELLER" && !value.accountId) {
        context.addIssue({
            code: "custom",
            path: ["accountId"],
            message: "SELLER credentials require accountId.",
        });
    }
});

// Marketplace read models can lag a successful write. UNKNOWN observations
// therefore use a wider floor than ordinary retryable failures.
const MIN_RECONCILIATION_DELAY_MS = 30_000;

function parseCredentials(plaintext: string): NaverCommerceCredentials {
    let value: unknown;
    try {
        value = JSON.parse(plaintext) as unknown;
    } catch {
        throw new Error("INVALID_MARKET_CREDENTIALS");
    }
    const parsed = credentialSchema.safeParse(value);
    if (!parsed.success) throw new Error("INVALID_MARKET_CREDENTIALS");
    return parsed.data;
}

function permanentResolution(
    code: string,
    productOrderId: string | null,
): NaverCommandFinalization {
    return {
        status: "FAILED",
        attemptOutcome: "PERMANENT",
        code,
        message: code,
        responseSummary: {
            provider: "NAVER",
            productOrderId,
            applied: false,
            reason: code,
        },
    };
}

function unreconcilableResolution(
    context: NaverCommandExecutionContext,
    code: string,
    productOrderId: string | null,
): NaverCommandFinalization {
    if (context.lease.purpose === "EXECUTE") {
        return permanentResolution(code, productOrderId);
    }

    return {
        status: "FAILED",
        attemptOutcome: "PERMANENT",
        code,
        message: `${code}: provider application state could not be verified; administrator review is required.`,
        reconciled: true,
        responseSummary: {
            provider: "NAVER",
            productOrderId,
            applied: "UNKNOWN",
            reason: code,
            requiresManualResolution: true,
        },
    };
}

function unknownResolution(
    code: string,
    productOrderId: string,
    providerStatus?: string,
): NaverCommandFinalization {
    return {
        status: "UNKNOWN",
        attemptOutcome: "UNKNOWN",
        code,
        message: code,
        responseSummary: {
            provider: "NAVER",
            productOrderId,
            applied: "UNKNOWN",
            reason: code,
            ...(providerStatus === undefined ? {} : { providerStatus }),
        },
    };
}

function exhaustedReconciliationResolution(input: {
    context: NaverCommandExecutionContext;
    productOrderId: string;
    observationCode: string;
    providerStatus?: string;
    applied?: false | "UNKNOWN";
}): NaverCommandFinalization {
    return {
        status: "FAILED",
        attemptOutcome: "PERMANENT",
        code: "RECONCILIATION_ATTEMPTS_EXHAUSTED",
        message: "Automatic provider-state reconciliation exhausted its bounded attempt budget; an administrator must recheck or abandon the command.",
        reconciled: true,
        responseSummary: {
            provider: "NAVER",
            productOrderId: input.productOrderId,
            applied: input.applied ?? "UNKNOWN",
            reason: "RECONCILIATION_ATTEMPTS_EXHAUSTED",
            lastObservationCode: input.observationCode,
            attemptCount: input.context.lease.attemptCount,
            maxAttempts: input.context.lease.maxAttempts,
            requiresManualResolution: true,
            ...(input.providerStatus === undefined
                ? {}
                : { providerStatus: input.providerStatus }),
        },
    };
}

function unresolvedReconciliationResolution(input: {
    context: NaverCommandExecutionContext;
    productOrderId: string;
    observationCode: string;
    providerStatus?: string;
}): NaverCommandFinalization {
    if (input.context.lease.attemptCount >= input.context.lease.maxAttempts) {
        return exhaustedReconciliationResolution({
            ...input,
            applied: "UNKNOWN",
        });
    }

    return {
        ...unknownResolution(
            input.observationCode,
            input.productOrderId,
            input.providerStatus,
        ),
        reconciled: true,
    };
}

function hasMatchingPriorAbsenceObservation(
    context: NaverCommandExecutionContext,
    providerStatus: string,
): boolean {
    const previous = context.previousResult;
    return previous?.provider === "NAVER"
        && previous.reconciliationObservation === "NOT_APPLIED"
        && previous.providerStatus === providerStatus;
}

function unconfirmedAbsenceResolution(input: {
    context: NaverCommandExecutionContext;
    productOrderId: string;
    providerStatus: string;
}): NaverCommandFinalization {
    if (input.context.lease.attemptCount >= input.context.lease.maxAttempts) {
        return exhaustedReconciliationResolution({
            context: input.context,
            productOrderId: input.productOrderId,
            observationCode: "PROVIDER_EFFECT_ABSENCE_UNCONFIRMED",
            providerStatus: input.providerStatus,
            applied: "UNKNOWN",
        });
    }

    return {
        status: "UNKNOWN",
        attemptOutcome: "UNKNOWN",
        code: "PROVIDER_EFFECT_ABSENCE_UNCONFIRMED",
        message: "A second consistent provider-state observation is required before the write can be retried.",
        reconciled: true,
        responseSummary: {
            provider: "NAVER",
            productOrderId: input.productOrderId,
            providerStatus: input.providerStatus,
            applied: "UNKNOWN",
            reconciliationObservation: "NOT_APPLIED",
            requiresSecondObservation: true,
        },
    };
}

function retryDelayMs(input: {
    attemptNumber: number;
    baseMs: number;
    capMs: number;
    retryAfterMs?: number;
}): number {
    const exponent = Math.min(Math.max(input.attemptNumber - 1, 0), 20);
    const exponential = Math.min(input.capMs, input.baseMs * 2 ** exponent);
    return Math.min(input.capMs, Math.max(exponential, input.retryAfterMs ?? 0));
}

function withRetrySchedule(
    resolution: NaverCommandFinalization,
    context: NaverCommandExecutionContext,
    now: Date,
    config: NaverOutboundCommandWorkerConfig,
): NaverCommandFinalization {
    if (resolution.status !== "RETRY" && resolution.status !== "UNKNOWN") {
        return resolution;
    }
    const delay = retryDelayMs({
        attemptNumber: context.lease.attemptCount,
        baseMs: config.retryBaseMs,
        capMs: config.retryCapMs,
        retryAfterMs: resolution.retryAfterMs,
    });
    const scheduledDelay = resolution.status === "UNKNOWN"
        ? Math.min(config.retryCapMs, Math.max(delay, MIN_RECONCILIATION_DELAY_MS))
        : delay;
    return {
        ...resolution,
        nextAttemptAt: new Date(now.getTime() + scheduledDelay),
    };
}

async function finalize(
    dependencies: NaverOutboundCommandWorkerDependencies,
    context: NaverCommandExecutionContext,
    resolution: NaverCommandFinalization,
): Promise<void> {
    const now = dependencies.now();
    await dependencies.store.finalize({
        context,
        leaseOwner: dependencies.config.leaseOwner,
        now,
        resolution: withRetrySchedule(resolution, context, now, dependencies.config),
    });
}

function integrationFailureFromThrown(
    error: unknown,
    phase: "READ" | "WRITE",
): IntegrationFailure {
    return failureResult({
        kind: "network",
        code: phase === "READ" ? "NAVER_READ_THROWN" : "NAVER_WRITE_THROWN",
        message: "The marketplace client threw before returning a classified result.",
        retryable: true,
        cause: error,
    });
}

function readFailureResolution(input: {
    failure: IntegrationFailure;
    context: NaverCommandExecutionContext;
    productOrderId: string;
}): NaverCommandFinalization {
    const classified = classifyNaverIntegrationFailure({
        failure: input.failure,
        phase: "READ",
        attemptNumber: input.context.lease.attemptCount,
        maxAttempts: input.context.lease.maxAttempts,
    });

    if (input.context.lease.purpose === "RECONCILE") {
        if (classified.status === "FAILED") {
            return {
                ...classified,
                reconciled: true,
                responseSummary: {
                    provider: "NAVER",
                    productOrderId: input.productOrderId,
                    phase: "RECONCILIATION_READ",
                    applied: "UNKNOWN",
                    reason: classified.code,
                    requiresManualResolution: true,
                },
            };
        }

        return unresolvedReconciliationResolution({
            context: input.context,
            productOrderId: input.productOrderId,
            observationCode: classified.code ?? "RECONCILIATION_READ_FAILED",
        });
    }

    return {
        ...classified,
        responseSummary: {
            provider: "NAVER",
            productOrderId: input.productOrderId,
            phase: "PRE_READ",
            applied: "NOT_CHECKED",
            reason: classified.code,
        },
    };
}

function findDetail(
    details: readonly NaverProductOrderDetail[],
    productOrderId: string,
): NaverProductOrderDetail | null {
    return details.find(
        (detail) => detail.productOrder.productOrderId === productOrderId,
    ) ?? null;
}

async function executeWrite(input: {
    client: NaverOutboundClient;
    command: ParsedNaverCommandPayload;
    productOrderId: string;
    context: NaverCommandExecutionContext;
}): Promise<NaverCommandFinalization> {
    let result;
    try {
        if (input.command.type === "ORDER_CONFIRM") {
            result = await input.client.confirmProductOrders([input.productOrderId]);
        } else if (input.command.type === "INVOICE_SUBMIT") {
            result = await input.client.dispatchProductOrders([{
                productOrderId: input.productOrderId,
                dispatchDate: input.command.payload.dispatchAt,
                deliveryMethod: "DELIVERY",
                deliveryCompanyCode: input.command.payload.carrierCode,
                trackingNumber: input.command.payload.trackingNumber,
            }]);
        } else if (input.command.type === "DIRECT_DELIVERY") {
            result = await input.client.dispatchProductOrders([{
                productOrderId: input.productOrderId,
                dispatchDate: input.command.payload.dispatchAt,
                deliveryMethod: "DIRECT_DELIVERY",
            }]);
        } else {
            result = await input.client.requestCancelProductOrder(
                input.productOrderId,
                {
                    cancelReason: input.command.payload.reasonCode,
                    ...(input.command.payload.reasonDetail === undefined
                        ? {}
                        : { cancelDetailedReason: input.command.payload.reasonDetail }),
                    ...(input.command.payload.quantity === undefined
                        ? {}
                        : { cancelQuantity: input.command.payload.quantity }),
                },
            );
        }
    } catch (error) {
        result = integrationFailureFromThrown(error, "WRITE");
    }

    const resolved = resolveNaverBatchResult({
        result,
        productOrderId: input.productOrderId,
        attemptNumber: input.context.lease.attemptCount,
        maxAttempts: input.context.lease.maxAttempts,
    });
    if (!resolved.succeeded) return resolved.resolution;

    return {
        status: "SUCCEEDED",
        attemptOutcome: "SUCCESS",
        code: null,
        message: null,
        responseSummary: resolved.responseSummary,
        ...(resolved.httpStatus === undefined ? {} : { httpStatus: resolved.httpStatus }),
    };
}

/**
 * Processes at most one command. A false return means the queue had no due
 * Naver command; true means a lease was obtained, including permanent rejects.
 */
export async function processOneNaverOutboundCommand(
    dependencies: NaverOutboundCommandWorkerDependencies,
): Promise<boolean> {
    const lease = await dependencies.store.leaseNext({
        leaseOwner: dependencies.config.leaseOwner,
        now: dependencies.now(),
        leaseDurationMs: dependencies.config.leaseDurationMs,
    });
    if (!lease) return false;

    const context = await dependencies.store.beginAttempt({
        lease,
        leaseOwner: dependencies.config.leaseOwner,
        now: dependencies.now(),
    });
    const productOrderId = context.item?.externalOrderItemId ?? null;
    const command = parseNaverCommandPayload(context.lease.type, context.payload);
    if (!command) {
        await finalize(dependencies, context, unreconcilableResolution(
            context,
            "INVALID_OR_UNSUPPORTED_COMMAND_PAYLOAD",
            productOrderId,
        ));
        return true;
    }
    if (!productOrderId) {
        await finalize(dependencies, context, unreconcilableResolution(
            context,
            "EXTERNAL_ORDER_ITEM_ID_MISSING",
            null,
        ));
        return true;
    }
    if (!context.encryptedCredentials) {
        await finalize(dependencies, context, unreconcilableResolution(
            context,
            "MARKET_CREDENTIALS_NOT_FOUND",
            productOrderId,
        ));
        return true;
    }

    let client: NaverOutboundClient;
    try {
        const plaintext = dependencies.decryptCredentials(
            context.encryptedCredentials,
            {
                tenantId: context.lease.tenantId,
                marketAccountId: context.lease.marketAccountId,
                secretType: context.credentialSecretType,
            },
        );
        const credentials = parseCredentials(plaintext);
        client = dependencies.clientFactory(credentials, context.accountSettings);
    } catch {
        await finalize(dependencies, context, unreconcilableResolution(
            context,
            "MARKET_CREDENTIALS_INVALID",
            productOrderId,
        ));
        return true;
    }

    let detailResult;
    try {
        detailResult = await client.getProductOrderDetails(
            [productOrderId],
            command.type === "SELLER_CANCEL"
                ? { quantityClaimCompatibility: true }
                : undefined,
        );
    } catch (error) {
        detailResult = integrationFailureFromThrown(error, "READ");
    }
    if (detailResult.outcome === "failure") {
        await finalize(dependencies, context, readFailureResolution({
            failure: detailResult,
            context,
            productOrderId,
        }));
        return true;
    }

    const detail = findDetail(detailResult.data.items, productOrderId);
    if (!detail) {
        const failure = failureResult({
            kind: "unexpected_response",
            code: "NAVER_PRODUCT_ORDER_DETAIL_MISSING",
            message: "The requested product order detail was absent.",
            retryable: true,
        });
        await finalize(dependencies, context, readFailureResolution({
            failure,
            context,
            productOrderId,
        }));
        return true;
    }

    const target = inspectNaverProviderTarget(command, detail);
    if (target.state === "APPLIED") {
        await finalize(dependencies, context, {
            status: "SUCCEEDED",
            attemptOutcome: "SUCCESS",
            code: null,
            message: null,
            reconciled: true,
            responseSummary: {
                provider: "NAVER",
                productOrderId,
                providerStatus: target.providerStatus,
                applied: true,
                source: "PRE_READ_RECONCILIATION",
            },
        });
        return true;
    }
    if (target.state === "INDETERMINATE") {
        await finalize(
            dependencies,
            context,
            context.lease.purpose === "RECONCILE"
                ? unresolvedReconciliationResolution({
                    context,
                    productOrderId,
                    observationCode: target.code,
                    providerStatus: target.providerStatus,
                })
                : unknownResolution(
                    target.code,
                    productOrderId,
                    target.providerStatus,
                ),
        );
        return true;
    }
    if (target.state === "CONFLICT") {
        await finalize(
            dependencies,
            context,
            context.lease.purpose === "RECONCILE"
                ? unreconcilableResolution(context, target.code, productOrderId)
                : permanentResolution(target.code, productOrderId),
        );
        return true;
    }

    if (
        context.lease.purpose === "RECONCILE"
        && command.type === "SELLER_CANCEL"
    ) {
        // Naver does not accept an idempotency key for this write. Until the
        // worker persists a causal pre-write claim baseline, a claim-free read
        // cannot prove that an ambiguous cancellation was not applied. Keep the
        // command on read-only/manual reconciliation and never reissue it.
        await finalize(dependencies, context, unresolvedReconciliationResolution({
            context,
            productOrderId,
            observationCode: "SELLER_CANCEL_MANUAL_RECONCILIATION_REQUIRED",
            providerStatus: target.providerStatus,
        }));
        return true;
    }

    if (
        context.lease.purpose === "RECONCILE"
        && !hasMatchingPriorAbsenceObservation(context, target.providerStatus)
    ) {
        await finalize(dependencies, context, unconfirmedAbsenceResolution({
            context,
            productOrderId,
            providerStatus: target.providerStatus,
        }));
        return true;
    }

    const preconditions = validateNaverCommandPreconditions({
        command,
        expectedVersion: context.lease.expectedVersion,
        accountActive: context.accountActive,
        accountAuthStatus: context.accountAuthStatus,
        accountCapabilities: context.accountCapabilities,
        item: context.item,
        detail,
    });
    if (!preconditions.ok) {
        await finalize(dependencies, context, permanentResolution(
            preconditions.code,
            productOrderId,
        ));
        return true;
    }


    if (context.lease.purpose === "RECONCILE") {
        const resolution = context.lease.attemptCount >= context.lease.maxAttempts
            ? exhaustedReconciliationResolution({
                context,
                productOrderId,
                observationCode: "PROVIDER_EFFECT_NOT_APPLIED",
                providerStatus: target.providerStatus,
                applied: false,
            })
            : {
                status: "RETRY" as const,
                attemptOutcome: "RETRYABLE" as const,
                code: "PROVIDER_EFFECT_NOT_APPLIED",
                message: "Provider state proves that the command effect was not applied; a guarded execution retry is safe.",
                reconciled: true,
                responseSummary: {
                    provider: "NAVER",
                    productOrderId,
                    providerStatus: target.providerStatus,
                    applied: false,
                    source: "PROVIDER_STATE_RECONCILIATION",
                },
            };
        await finalize(dependencies, context, resolution);
        return true;
    }

    await finalize(dependencies, context, await executeWrite({
        client,
        command,
        productOrderId,
        context,
    }));
    return true;
}

export const defaultNaverOutboundClientFactory: NaverOutboundClientFactory = (
    credentials,
    accountSettings,
) => {
    void accountSettings;
    return new NaverCommerceClient({ credentials });
};

export function createDefaultNaverOutboundCommandDependencies(
    config: NaverOutboundCommandWorkerConfig,
): NaverOutboundCommandWorkerDependencies {
    validateNaverOutboundCommandWorkerConfig(config);
    return {
        store: new PostgresNaverOutboundCommandStore(),
        clientFactory: defaultNaverOutboundClientFactory,
        decryptCredentials: decryptCredential,
        now: () => new Date(),
        config,
    };
}

export function validateNaverOutboundCommandWorkerConfig(
    config: NaverOutboundCommandWorkerConfig,
): void {
    if (!config.leaseOwner.trim()) throw new Error("leaseOwner is required.");
    for (const [name, value] of [
        ["leaseDurationMs", config.leaseDurationMs],
        ["retryBaseMs", config.retryBaseMs],
        ["retryCapMs", config.retryCapMs],
    ] as const) {
        if (!Number.isSafeInteger(value) || value <= 0) {
            throw new Error(`${name} must be a positive safe integer.`);
        }
    }
    if (config.retryBaseMs > config.retryCapMs) {
        throw new Error("retryBaseMs must not exceed retryCapMs.");
    }
}

export type NaverOutboundCommandWorkerSleep = (
    milliseconds: number,
    signal: AbortSignal,
) => Promise<void>;

export const defaultNaverOutboundCommandWorkerSleep: NaverOutboundCommandWorkerSleep = (
    milliseconds,
    signal,
) => new Promise((resolve) => {
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

/** Dedicated loop contract for scripts/worker.ts to run beside inbound sync. */
export async function runNaverOutboundCommandLoop(
    dependencies: NaverOutboundCommandWorkerDependencies,
    signal: AbortSignal,
    options: {
        pollIntervalMs: number;
        sleep?: NaverOutboundCommandWorkerSleep;
    },
): Promise<void> {
    if (!Number.isSafeInteger(options.pollIntervalMs) || options.pollIntervalMs <= 0) {
        throw new Error("pollIntervalMs must be a positive safe integer.");
    }
    const sleep = options.sleep ?? defaultNaverOutboundCommandWorkerSleep;

    while (!signal.aborted) {
        let handled = false;
        try {
            handled = await processOneNaverOutboundCommand(dependencies);
        } catch {
            // Do not log provider/DB exceptions because they may embed request data.
            console.error("A Naver outbound command iteration failed before finalization.");
        }
        if (!handled && !signal.aborted) {
            await sleep(options.pollIntervalMs, signal);
        }
    }
}
