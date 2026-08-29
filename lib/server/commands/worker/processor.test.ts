import { describe, expect, it, vi } from "vitest";
import {
    failureResult,
    partialResult,
    successResult,
} from "@/lib/server/integrations/core";
import type {
    NaverBatchOperationResult,
    NaverProductOrderDetail,
} from "@/lib/server/integrations/naver";
import {
    processOneNaverOutboundCommand,
    runNaverOutboundCommandLoop,
} from "@/lib/server/commands/worker/processor";
import type {
    LeasedNaverOutboundCommand,
    NaverCommandExecutionContext,
    NaverCommandFinalization,
    NaverOutboundClient,
    NaverOutboundCommandStore,
    NaverOutboundCommandWorkerDependencies,
} from "@/lib/server/commands/worker/types";

const NOW = new Date("2026-07-10T03:00:00.000Z");
const PRODUCT_ORDER_ID = "naver-product-order-1";

const raw = {
    requestUrl: "https://api.commerce.naver.com/test",
    requestMethod: "POST" as const,
    status: 200,
    statusText: "OK",
    headers: {},
    body: {},
    bodyText: "{}",
    receivedAtMs: NOW.getTime(),
};

function detail(overrides: Record<string, unknown> = {}): NaverProductOrderDetail {
    return {
        order: { orderId: "order-1" },
        productOrder: {
            productOrderId: PRODUCT_ORDER_ID,
            productOrderStatus: "PAYED",
            placeOrderStatus: "NOT_YET",
            quantity: 2,
            ...overrides,
        },
    };
}

function lease(
    type = "ORDER_CONFIRM",
    purpose: LeasedNaverOutboundCommand["purpose"] = "EXECUTE",
): LeasedNaverOutboundCommand {
    return {
        id: "00000000-0000-4000-8000-000000000001",
        tenantId: "00000000-0000-4000-8000-000000000002",
        marketAccountId: "00000000-0000-4000-8000-000000000003",
        orderItemId: "00000000-0000-4000-8000-000000000004",
        type,
        attemptCount: 1,
        maxAttempts: 3,
        expectedVersion: 3,
        purpose,
        leaseOwner: "worker-1",
        leaseUntil: new Date(NOW.getTime() + 60_000).toISOString(),
    };
}

function context(options: {
    type?: string;
    payload?: Record<string, unknown>;
    encryptedCredentials?: string | null;
    version?: number;
    sourcingStatus?: string;
    carrierCode?: string | null;
    trackingNumber?: string | null;
    purpose?: LeasedNaverOutboundCommand["purpose"];
    attemptCount?: number;
    maxAttempts?: number;
    previousResult?: Record<string, unknown> | null;
    quantity?: number;
    capability?: Record<string, unknown>;
    attributes?: Record<string, unknown>;
} = {}): NaverCommandExecutionContext {
    const commandLease = {
        ...lease(options.type, options.purpose),
        attemptCount: options.attemptCount ?? 1,
        maxAttempts: options.maxAttempts ?? 3,
    };
    const action = commandLease.type;
    return {
        lease: commandLease,
        attemptId: "00000000-0000-4000-8000-000000000005",
        payload: options.payload ?? {},
        previousResult: options.previousResult ?? null,
        correlationId: "00000000-0000-4000-8000-000000000006",
        accountActive: true,
        accountAuthStatus: "CONNECTED",
        accountCapabilities: {
            [action]: options.capability ?? {
                mode: "API",
                ...(action === "SELLER_CANCEL" ? { uatStatus: "PASSED" } : {}),
            },
        },
        accountSettings: {},
        encryptedCredentials: options.encryptedCredentials === undefined
            ? "encrypted"
            : options.encryptedCredentials,
        credentialSecretType: "MARKET_API_CREDENTIALS",
        item: {
            id: commandLease.orderItemId,
            salesOrderId: "00000000-0000-4000-8000-000000000007",
            version: options.version ?? 3,
            externalOrderItemId: PRODUCT_ORDER_ID,
            quantity: options.quantity ?? 2,
            internalWorkStatus: "PREPARING",
            marketStatusRaw: "PAYED",
            marketFulfillmentStatus: "PAID",
            sourcingStatus: options.sourcingStatus ?? "MATCHED",
            marketDeliveryMethod: null,
            domesticCarrierCode: options.carrierCode ?? null,
            domesticTrackingNumber: options.trackingNumber ?? null,
            confirmedAt: action === "ORDER_CONFIRM" ? null : NOW.toISOString(),
            marketInvoiceSubmittedAt: null,
            attributes: options.attributes ?? {},
        },
    };
}

function clientWith(input: {
    detail?: NaverProductOrderDetail;
    writeResult?: ReturnType<typeof successResult<NaverBatchOperationResult>>
        | ReturnType<typeof failureResult>
        | ReturnType<typeof partialResult<NaverBatchOperationResult>>;
}) {
    const confirmProductOrders = vi.fn(async () => input.writeResult ?? successResult({
        succeededProductOrderIds: [PRODUCT_ORDER_ID],
        failedProductOrders: [],
    }, raw));
    const dispatchProductOrders = vi.fn(confirmProductOrders);
    const requestCancelProductOrder = vi.fn(confirmProductOrders);
    const client: NaverOutboundClient = {
        getProductOrderDetails: vi.fn(async () => successResult({
            items: [input.detail ?? detail()],
        }, raw)),
        confirmProductOrders,
        dispatchProductOrders,
        requestCancelProductOrder,
    };
    return {
        client,
        confirmProductOrders,
        dispatchProductOrders,
        requestCancelProductOrder,
    };
}

function dependencies(input: {
    executionContext?: NaverCommandExecutionContext;
    leased?: LeasedNaverOutboundCommand | null;
    client?: NaverOutboundClient;
}) {
    const executionContext = input.executionContext ?? context();
    const finalize = vi.fn(async (_input: { resolution: NaverCommandFinalization }) => ({
        status: _input.resolution.status,
    }));
    const store: NaverOutboundCommandStore = {
        leaseNext: vi.fn(async () => input.leased === undefined
            ? executionContext.lease
            : input.leased),
        beginAttempt: vi.fn(async () => executionContext),
        finalize,
    };
    const clientFactory = vi.fn(() => input.client ?? clientWith({}).client);
    const result: NaverOutboundCommandWorkerDependencies = {
        store,
        clientFactory,
        decryptCredentials: vi.fn(() => JSON.stringify({
            clientId: "client-id",
            clientSecret: "client-secret",
            type: "SELF",
        })),
        now: () => new Date(NOW),
        config: {
            leaseOwner: "worker-1",
            leaseDurationMs: 60_000,
            retryBaseMs: 5_000,
            retryCapMs: 60_000,
        },
    };
    return { result, store, finalize, clientFactory };
}

describe("processOneNaverOutboundCommand", () => {
    it("returns false when no command is due", async () => {
        const setup = dependencies({ leased: null });
        await expect(processOneNaverOutboundCommand(setup.result)).resolves.toBe(false);
        expect(setup.store.beginAttempt).not.toHaveBeenCalled();
    });

    it("rejects an unsupported Naver cancellation reason before creating a client", async () => {
        const setup = dependencies({ executionContext: context({
            type: "SELLER_CANCEL",
            payload: { reasonCode: "OUT_OF_STOCK" },
        }) });
        await expect(processOneNaverOutboundCommand(setup.result)).resolves.toBe(true);
        expect(setup.clientFactory).not.toHaveBeenCalled();
        expect(setup.finalize).toHaveBeenCalledWith(expect.objectContaining({
            resolution: expect.objectContaining({
                status: "FAILED",
                code: "INVALID_OR_UNSUPPORTED_COMMAND_PAYLOAD",
            }),
        }));
    });

    it("pre-reads quantity and omits cancelQuantity for a whole-order seller cancellation", async () => {
        const executionContext = context({
            type: "SELLER_CANCEL",
            payload: {
                reasonCode: "SOLD_OUT",
                reasonDetail: "Supplier stock is unavailable.",
            },
        });
        const naver = clientWith({ detail: detail() });
        const setup = dependencies({ executionContext, client: naver.client });

        await processOneNaverOutboundCommand(setup.result);

        expect(naver.client.getProductOrderDetails).toHaveBeenCalledWith(
            [PRODUCT_ORDER_ID],
            { quantityClaimCompatibility: true },
        );
        expect(naver.requestCancelProductOrder).toHaveBeenCalledWith(
            PRODUCT_ORDER_ID,
            {
                cancelReason: "SOLD_OUT",
                cancelDetailedReason: "Supplier stock is unavailable.",
            },
        );
        expect(setup.finalize).toHaveBeenCalledWith(expect.objectContaining({
            resolution: expect.objectContaining({ status: "SUCCEEDED" }),
        }));
    });

    it("never writes seller cancellation when account UAT has not passed", async () => {
        const executionContext = context({
            type: "SELLER_CANCEL",
            payload: { reasonCode: "SOLD_OUT", quantity: 1 },
            capability: { mode: "API", uatStatus: "NOT_RUN" },
        });
        const naver = clientWith({ detail: detail() });
        const setup = dependencies({ executionContext, client: naver.client });

        await processOneNaverOutboundCommand(setup.result);

        expect(naver.requestCancelProductOrder).not.toHaveBeenCalled();
        expect(setup.finalize).toHaveBeenCalledWith(expect.objectContaining({
            resolution: expect.objectContaining({
                status: "FAILED",
                code: "MARKET_CAPABILITY_NOT_API",
            }),
        }));
    });

    it("keeps an existing Naver cancellation request on manual reconciliation", async () => {
        const executionContext = context({
            type: "SELLER_CANCEL",
            purpose: "RECONCILE",
            payload: { reasonCode: "SOLD_OUT", quantity: 1 },
        });
        const naver = clientWith({
            detail: detail({ claimType: "CANCEL", claimStatus: "CANCEL_REQUEST" }),
        });
        const setup = dependencies({ executionContext, client: naver.client });

        await processOneNaverOutboundCommand(setup.result);

        expect(naver.requestCancelProductOrder).not.toHaveBeenCalled();
        expect(setup.finalize).toHaveBeenCalledWith(expect.objectContaining({
            resolution: expect.objectContaining({
                status: "UNKNOWN",
                code: "PROVIDER_CANCEL_CAUSALITY_UNPROVEN",
                reconciled: true,
            }),
        }));
    });

    it("moves an ambiguous seller-cancel write timeout to UNKNOWN", async () => {
        const executionContext = context({
            type: "SELLER_CANCEL",
            payload: { reasonCode: "SOLD_OUT", quantity: 1 },
        });
        const naver = clientWith({
            detail: detail(),
            writeResult: failureResult({
                kind: "timeout",
                code: "REQUEST_TIMEOUT",
                message: "timeout",
                retryable: true,
            }),
        });
        const setup = dependencies({ executionContext, client: naver.client });

        await processOneNaverOutboundCommand(setup.result);

        expect(naver.requestCancelProductOrder).toHaveBeenCalledWith(
            PRODUCT_ORDER_ID,
            { cancelReason: "SOLD_OUT", cancelQuantity: 1 },
        );
        expect(setup.finalize).toHaveBeenCalledWith(expect.objectContaining({
            resolution: expect.objectContaining({
                status: "UNKNOWN",
                attemptOutcome: "UNKNOWN",
            }),
        }));
    });

    it("never retries seller cancellation after matching not-applied observations without a causal baseline", async () => {
        const executionContext = context({
            type: "SELLER_CANCEL",
            purpose: "RECONCILE",
            payload: { reasonCode: "SOLD_OUT", quantity: 1 },
            previousResult: {
                provider: "NAVER",
                providerStatus: "PAYED",
                reconciliationObservation: "NOT_APPLIED",
            },
        });
        const naver = clientWith({ detail: detail() });
        const setup = dependencies({ executionContext, client: naver.client });

        await processOneNaverOutboundCommand(setup.result);

        expect(naver.requestCancelProductOrder).not.toHaveBeenCalled();
        expect(setup.finalize).toHaveBeenCalledWith(expect.objectContaining({
            resolution: expect.objectContaining({
                status: "UNKNOWN",
                code: "SELLER_CANCEL_MANUAL_RECONCILIATION_REQUIRED",
                reconciled: true,
            }),
        }));
    });

    it("does not retry or rewrite when a completed partial cancellation appears during reconciliation", async () => {
        const executionContext = context({
            type: "SELLER_CANCEL",
            purpose: "RECONCILE",
            payload: { reasonCode: "SOLD_OUT", quantity: 1 },
            previousResult: {
                provider: "NAVER",
                providerStatus: "PAYED",
                reconciliationObservation: "NOT_APPLIED",
            },
        });
        const naver = clientWith({
            detail: {
                ...detail({ remainQuantity: 1 }),
                completedClaims: [{
                    claimType: "CANCEL",
                    claimId: "completed-cancel-1",
                    claimStatus: "CANCEL_DONE",
                    claimRequestDate: NOW.toISOString(),
                    requestChannel: "SELLER",
                    claimRequestReason: "SOLD_OUT",
                    requestQuantity: 1,
                }],
            },
        });
        const setup = dependencies({ executionContext, client: naver.client });

        await processOneNaverOutboundCommand(setup.result);

        expect(naver.requestCancelProductOrder).not.toHaveBeenCalled();
        expect(setup.finalize).toHaveBeenCalledWith(expect.objectContaining({
            resolution: expect.objectContaining({
                status: "UNKNOWN",
                code: "PROVIDER_CANCEL_CAUSALITY_UNPROVEN",
                reconciled: true,
            }),
        }));
    });

    it("reconciles an already-confirmed provider state without another write", async () => {
        const naver = clientWith({ detail: detail({ placeOrderStatus: "OK" }) });
        const setup = dependencies({ client: naver.client });
        await processOneNaverOutboundCommand(setup.result);
        expect(naver.confirmProductOrders).not.toHaveBeenCalled();
        expect(setup.finalize).toHaveBeenCalledWith(expect.objectContaining({
            resolution: expect.objectContaining({
                status: "SUCCEEDED",
                reconciled: true,
            }),
        }));
    });

    it("rejects a stale item before issuing the write", async () => {
        const executionContext = context({ version: 4 });
        const naver = clientWith({});
        const setup = dependencies({ executionContext, client: naver.client });
        await processOneNaverOutboundCommand(setup.result);
        expect(naver.confirmProductOrders).not.toHaveBeenCalled();
        expect(setup.finalize).toHaveBeenCalledWith(expect.objectContaining({
            resolution: expect.objectContaining({ code: "STALE_ORDER_ITEM_VERSION" }),
        }));
    });

    it("dispatches one validated invoice and records success", async () => {
        const executionContext = context({
            type: "INVOICE_SUBMIT",
            payload: {
                carrierCode: "CJ",
                trackingNumber: "1234567890",
                dispatchAt: NOW.toISOString(),
            },
            sourcingStatus: "INVOICE_RECEIVED",
            carrierCode: "CJ",
            trackingNumber: "1234567890",
            attributes: { sourcingProgressStage: "DOMESTIC_SHIPPING" },
        });
        const naver = clientWith({ detail: detail({ placeOrderStatus: "OK" }) });
        const setup = dependencies({ executionContext, client: naver.client });
        await processOneNaverOutboundCommand(setup.result);
        expect(naver.dispatchProductOrders).toHaveBeenCalledWith([{
            productOrderId: PRODUCT_ORDER_ID,
            dispatchDate: NOW.toISOString(),
            deliveryMethod: "DELIVERY",
            deliveryCompanyCode: "CJ",
            trackingNumber: "1234567890",
        }]);
        expect(setup.finalize).toHaveBeenCalledWith(expect.objectContaining({
            resolution: expect.objectContaining({ status: "SUCCEEDED" }),
        }));
    });

    it("does not resend unified shipping when the provider is already dispatched", async () => {
        const executionContext = context({
            type: "SHIPPING_PROCESS",
            payload: {
                requestedMethod: "DIRECT_DELIVERY",
                dispatchAt: NOW.toISOString(),
            },
            sourcingStatus: "INVOICE_RECEIVED",
            carrierCode: "CJ",
            trackingNumber: "1234567890",
        });
        executionContext.accountCapabilities = {
            DIRECT_DELIVERY: { mode: "API" },
        };
        const naver = clientWith({
            detail: detail({
                placeOrderStatus: "OK",
                productOrderStatus: "DELIVERING",
                deliveryMethod: "DELIVERY",
                deliveryCompanyCode: "CJ",
                trackingNumber: "1234567890",
            }),
        });
        const setup = dependencies({ executionContext, client: naver.client });

        await processOneNaverOutboundCommand(setup.result);

        expect(naver.dispatchProductOrders).not.toHaveBeenCalled();
        expect(setup.finalize).toHaveBeenCalledWith(expect.objectContaining({
            resolution: expect.objectContaining({
                status: "SUCCEEDED",
                reconciled: true,
                responseSummary: expect.objectContaining({
                    source: "PRE_READ_RECONCILIATION",
                    deliveryMethod: "DELIVERY",
                }),
            }),
        }));
    });

    it("moves an ambiguous write timeout to scheduled UNKNOWN reconciliation", async () => {
        const naver = clientWith({ writeResult: failureResult({
            kind: "timeout",
            code: "REQUEST_TIMEOUT",
            message: "timeout",
            retryable: true,
        }) });
        const setup = dependencies({ client: naver.client });
        await processOneNaverOutboundCommand(setup.result);
        const finalization = setup.finalize.mock.calls[0][0];
        expect(setup.finalize).toHaveBeenCalledWith(expect.objectContaining({
            resolution: expect.objectContaining({
                status: "UNKNOWN",
            }),
        }));
        expect(finalization.resolution.nextAttemptAt).toEqual(
            new Date(NOW.getTime() + 30_000),
        );
    });

    it("reconciles UNKNOWN as SUCCEEDED when provider state proves it was applied", async () => {
        const executionContext = context({ purpose: "RECONCILE" });
        const naver = clientWith({ detail: detail({ placeOrderStatus: "OK" }) });
        const setup = dependencies({ executionContext, client: naver.client });

        await processOneNaverOutboundCommand(setup.result);

        expect(naver.confirmProductOrders).not.toHaveBeenCalled();
        expect(setup.finalize).toHaveBeenCalledWith(expect.objectContaining({
            resolution: expect.objectContaining({
                status: "SUCCEEDED",
                reconciled: true,
            }),
        }));
    });

    it("moves UNKNOWN to RETRY without writing after two consistent absence observations", async () => {
        const executionContext = context({
            purpose: "RECONCILE",
            previousResult: {
                provider: "NAVER",
                providerStatus: "PAYED",
                reconciliationObservation: "NOT_APPLIED",
            },
        });
        const naver = clientWith({ detail: detail() });
        const setup = dependencies({ executionContext, client: naver.client });

        await processOneNaverOutboundCommand(setup.result);

        expect(naver.confirmProductOrders).not.toHaveBeenCalled();
        expect(setup.finalize).toHaveBeenCalledWith(expect.objectContaining({
            resolution: expect.objectContaining({
                status: "RETRY",
                code: "PROVIDER_EFFECT_NOT_APPLIED",
                reconciled: true,
                nextAttemptAt: new Date(NOW.getTime() + 5_000),
            }),
        }));
    });

    it("keeps the first not-applied observation UNKNOWN to cover provider eventual consistency", async () => {
        const executionContext = context({ purpose: "RECONCILE" });
        const naver = clientWith({ detail: detail() });
        const setup = dependencies({ executionContext, client: naver.client });

        await processOneNaverOutboundCommand(setup.result);

        expect(naver.confirmProductOrders).not.toHaveBeenCalled();
        expect(setup.finalize).toHaveBeenCalledWith(expect.objectContaining({
            resolution: expect.objectContaining({
                status: "UNKNOWN",
                code: "PROVIDER_EFFECT_ABSENCE_UNCONFIRMED",
                responseSummary: expect.objectContaining({
                    reconciliationObservation: "NOT_APPLIED",
                    requiresSecondObservation: true,
                }),
            }),
        }));
    });

    it("keeps an indeterminate reconciliation UNKNOWN until the bounded budget is exhausted", async () => {
        const executionContext = context({
            type: "INVOICE_SUBMIT",
            purpose: "RECONCILE",
            payload: {
                carrierCode: "CJ",
                trackingNumber: "1234567890",
                dispatchAt: NOW.toISOString(),
            },
            sourcingStatus: "INVOICE_RECEIVED",
            carrierCode: "CJ",
            trackingNumber: "1234567890",
        });
        const naver = clientWith({
            detail: detail({
                placeOrderStatus: "OK",
                productOrderStatus: "DELIVERING",
                deliveryCompanyCode: null,
                trackingNumber: null,
            }),
        });
        const setup = dependencies({ executionContext, client: naver.client });

        await processOneNaverOutboundCommand(setup.result);

        expect(naver.dispatchProductOrders).not.toHaveBeenCalled();
        expect(setup.finalize).toHaveBeenCalledWith(expect.objectContaining({
            resolution: expect.objectContaining({
                status: "UNKNOWN",
                code: "PROVIDER_INVOICE_DETAILS_MISSING",
                nextAttemptAt: new Date(NOW.getTime() + 30_000),
            }),
        }));
    });

    it("fails a conflicting provider claim without asserting whether the UNKNOWN write applied", async () => {
        const executionContext = context({ purpose: "RECONCILE" });
        const naver = clientWith({ detail: detail({ claimType: "CANCEL" }) });
        const setup = dependencies({ executionContext, client: naver.client });

        await processOneNaverOutboundCommand(setup.result);

        expect(naver.confirmProductOrders).not.toHaveBeenCalled();
        expect(setup.finalize).toHaveBeenCalledWith(expect.objectContaining({
            resolution: expect.objectContaining({
                status: "FAILED",
                code: "PROVIDER_CLAIM_CONFLICT",
                responseSummary: expect.objectContaining({
                    applied: "UNKNOWN",
                    requiresManualResolution: true,
                }),
            }),
        }));
    });

    it("fails with an actionable reason when reconciliation attempts are exhausted", async () => {
        const executionContext = context({
            purpose: "RECONCILE",
            attemptCount: 3,
            maxAttempts: 3,
            previousResult: {
                provider: "NAVER",
                providerStatus: "PAYED",
                reconciliationObservation: "NOT_APPLIED",
            },
        });
        const naver = clientWith({ detail: detail() });
        const setup = dependencies({ executionContext, client: naver.client });

        await processOneNaverOutboundCommand(setup.result);

        expect(naver.confirmProductOrders).not.toHaveBeenCalled();
        expect(setup.finalize).toHaveBeenCalledWith(expect.objectContaining({
            resolution: expect.objectContaining({
                status: "FAILED",
                code: "RECONCILIATION_ATTEMPTS_EXHAUSTED",
                responseSummary: expect.objectContaining({
                    applied: false,
                    requiresManualResolution: true,
                }),
            }),
        }));
    });

    it("retries a reconciliation read timeout as UNKNOWN without issuing a provider write", async () => {
        const executionContext = context({
            purpose: "RECONCILE",
            attemptCount: 2,
            maxAttempts: 3,
        });
        const naver = clientWith({});
        naver.client.getProductOrderDetails = vi.fn(async () => failureResult({
            kind: "timeout",
            code: "RECONCILIATION_READ_TIMEOUT",
            message: "timeout",
            retryable: true,
        }));
        const setup = dependencies({ executionContext, client: naver.client });

        await processOneNaverOutboundCommand(setup.result);

        expect(naver.confirmProductOrders).not.toHaveBeenCalled();
        expect(setup.finalize).toHaveBeenCalledWith(expect.objectContaining({
            resolution: expect.objectContaining({
                status: "UNKNOWN",
                code: "RECONCILIATION_READ_TIMEOUT",
                reconciled: true,
                nextAttemptAt: new Date(NOW.getTime() + 30_000),
            }),
        }));
    });

    it("accepts a partial batch response when this command item succeeded", async () => {
        const naver = clientWith({ writeResult: partialResult({
            succeededProductOrderIds: [PRODUCT_ORDER_ID],
            failedProductOrders: [],
        }, [{
            kind: "warning",
            message: "unrelated warning",
            retryable: false,
        }], raw) });
        const setup = dependencies({ client: naver.client });
        await processOneNaverOutboundCommand(setup.result);
        expect(setup.finalize).toHaveBeenCalledWith(expect.objectContaining({
            resolution: expect.objectContaining({ status: "SUCCEEDED" }),
        }));
    });

    it("fails safely when credentials are unavailable", async () => {
        const setup = dependencies({ executionContext: context({ encryptedCredentials: null }) });
        await processOneNaverOutboundCommand(setup.result);
        expect(setup.clientFactory).not.toHaveBeenCalled();
        expect(setup.finalize).toHaveBeenCalledWith(expect.objectContaining({
            resolution: expect.objectContaining({ code: "MARKET_CREDENTIALS_NOT_FOUND" }),
        }));
    });

    it("never claims not-applied when UNKNOWN cannot be reconciled without credentials", async () => {
        const setup = dependencies({ executionContext: context({
            purpose: "RECONCILE",
            encryptedCredentials: null,
        }) });

        await processOneNaverOutboundCommand(setup.result);

        expect(setup.clientFactory).not.toHaveBeenCalled();
        expect(setup.finalize).toHaveBeenCalledWith(expect.objectContaining({
            resolution: expect.objectContaining({
                status: "FAILED",
                code: "MARKET_CREDENTIALS_NOT_FOUND",
                reconciled: true,
                responseSummary: expect.objectContaining({
                    applied: "UNKNOWN",
                    requiresManualResolution: true,
                }),
            }),
        }));
    });
});

describe("runNaverOutboundCommandLoop", () => {
    it("sleeps when idle and exits on abort", async () => {
        const setup = dependencies({ leased: null });
        const controller = new AbortController();
        const sleep = vi.fn(async () => controller.abort());

        await runNaverOutboundCommandLoop(setup.result, controller.signal, {
            pollIntervalMs: 250,
            sleep,
        });

        expect(sleep).toHaveBeenCalledWith(250, controller.signal);
        expect(setup.store.leaseNext).toHaveBeenCalledOnce();
    });

    it("rejects an invalid polling interval", async () => {
        const setup = dependencies({ leased: null });
        await expect(runNaverOutboundCommandLoop(
            setup.result,
            new AbortController().signal,
            { pollIntervalMs: 0 },
        )).rejects.toThrow("pollIntervalMs");
    });
});
