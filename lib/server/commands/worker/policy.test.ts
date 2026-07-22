import { describe, expect, it } from "vitest";
import { failureResult, successResult } from "@/lib/server/integrations/core";
import type { NaverProductOrderDetail } from "@/lib/server/integrations/naver";
import {
    buildNaverAttemptIdentity,
    classifyNaverIntegrationFailure,
    deriveNaverSuccessPatch,
    inspectNaverProviderTarget,
    parseNaverCommandPayload,
    resolveNaverBatchResult,
    validateNaverCommandPreconditions,
} from "@/lib/server/commands/worker/policy";
import type { NaverCommandOrderItem } from "@/lib/server/commands/worker/types";

const PRODUCT_ORDER_ID = "naver-product-order-1";
const NOW = "2026-07-10T03:00:00.000Z";

function detail(overrides: Record<string, unknown> = {}): NaverProductOrderDetail {
    return {
        order: { orderId: "order-1" },
        productOrder: {
            productOrderId: PRODUCT_ORDER_ID,
            productOrderStatus: "PAYED",
            placeOrderStatus: "OK",
            quantity: 2,
            ...overrides,
        },
    };
}

function item(overrides: Partial<NaverCommandOrderItem> = {}): NaverCommandOrderItem {
    return {
        id: "00000000-0000-4000-8000-000000000001",
        salesOrderId: "00000000-0000-4000-8000-000000000002",
        version: 3,
            externalOrderItemId: PRODUCT_ORDER_ID,
            quantity: 2,
        internalWorkStatus: "PREPARING",
        marketStatusRaw: "PAYED",
        marketFulfillmentStatus: "ACKNOWLEDGED",
        sourcingStatus: "MATCHED",
        marketDeliveryMethod: null,
        domesticCarrierCode: null,
        domesticTrackingNumber: null,
        confirmedAt: NOW,
        marketInvoiceSubmittedAt: null,
        attributes: {},
        ...overrides,
    };
}

const raw = {
    requestUrl: "https://api.commerce.naver.com/test",
    requestMethod: "POST" as const,
    status: 200,
    statusText: "OK",
    headers: {},
    body: {},
    bodyText: "{}",
    receivedAtMs: Date.parse(NOW),
};

describe("Naver outbound request safety", () => {
    it("hashes the full intent deterministically while masking tracking in summaries", () => {
        const input = {
            commandId: "command-1",
            type: "INVOICE_SUBMIT",
            productOrderId: PRODUCT_ORDER_ID,
            payload: {
                carrierCode: "CJ",
                trackingNumber: "1234567890",
                dispatchAt: NOW,
            },
        };

        const first = buildNaverAttemptIdentity(input);
        const second = buildNaverAttemptIdentity({
            ...input,
            payload: {
                dispatchAt: NOW,
                trackingNumber: "1234567890",
                carrierCode: "CJ",
            },
        });

        expect(first.requestSha256).toBe(second.requestSha256);
        expect(first.requestSha256).toMatch(/^[0-9a-f]{64}$/);
        expect(JSON.stringify(first.requestSummary)).not.toContain("1234567890");
        expect(first.requestSummary).toMatchObject({
            payload: { trackingNumberMasked: "******7890" },
        });
    });

    it("rejects unsupported or over-posted persisted payloads", () => {
        expect(parseNaverCommandPayload("RETURN_APPROVE", {})).toBeNull();
        expect(parseNaverCommandPayload("ORDER_CONFIRM", { secret: "x" })).toBeNull();
    });
});

describe("Naver provider target reconciliation", () => {
    it("recognizes a confirmed order without issuing another write", () => {
        const command = parseNaverCommandPayload("ORDER_CONFIRM", {})!;
        expect(inspectNaverProviderTarget(command, detail())).toMatchObject({
            state: "APPLIED",
        });
    });

    it("does not treat explicit NONE claim fields as an active claim", () => {
        const command = parseNaverCommandPayload("ORDER_CONFIRM", {})!;
        expect(inspectNaverProviderTarget(command, detail({
            claimType: "NONE",
            claimStatus: "NONE",
        }))).toMatchObject({ state: "APPLIED" });
    });

    it("recognizes a matching submitted invoice", () => {
        const command = parseNaverCommandPayload("INVOICE_SUBMIT", {
            carrierCode: "CJ",
            trackingNumber: "1234567890",
            dispatchAt: NOW,
        })!;
        expect(inspectNaverProviderTarget(command, detail({
            productOrderStatus: "DELIVERING",
            deliveryMethod: "DELIVERY",
            deliveryCompanyCode: "CJ",
            trackingNumber: "1234567890",
        }))).toMatchObject({ state: "APPLIED" });
    });

    it("does not treat a different invoice as the requested effect", () => {
        const command = parseNaverCommandPayload("INVOICE_SUBMIT", {
            carrierCode: "CJ",
            trackingNumber: "1234567890",
            dispatchAt: NOW,
        })!;
        expect(inspectNaverProviderTarget(command, detail({
            productOrderStatus: "DELIVERING",
            deliveryMethod: "DELIVERY",
            deliveryCompanyCode: "CJ",
            trackingNumber: "DIFFERENT",
        }))).toMatchObject({
            state: "CONFLICT",
            code: "PROVIDER_INVOICE_CONFLICT",
        });
    });

    it("keeps an already-dispatched order unknown when direct-delivery evidence is absent", () => {
        const command = parseNaverCommandPayload("DIRECT_DELIVERY", {
            dispatchAt: NOW,
        })!;
        expect(inspectNaverProviderTarget(command, detail({
            productOrderStatus: "DELIVERING",
            deliveryMethod: undefined,
        }))).toMatchObject({ state: "INDETERMINATE" });
    });

    it("keeps a mismatched buyer cancellation indeterminate without treating it as applied", () => {
        const command = parseNaverCommandPayload("SELLER_CANCEL", {
            reasonCode: "SOLD_OUT",
            quantity: 2,
        })!;
        const providerDetail = {
            ...detail({ remainQuantity: 2 }),
            currentClaim: {
                cancel: {
                    claimId: "buyer-cancel-1",
                    claimStatus: "CANCEL_REQUEST",
                    requestQuantity: 1,
                    cancelReason: "INTENT_CHANGED",
                    requestChannel: "PURCHASER",
                },
            },
        };
        expect(inspectNaverProviderTarget(command, providerDetail)).toMatchObject({
            state: "INDETERMINATE",
            code: "PROVIDER_CANCEL_CAUSALITY_UNPROVEN",
        });
    });

    it("keeps currentClaim cancellation state indeterminate when causality is unavailable", () => {
        const command = parseNaverCommandPayload("SELLER_CANCEL", {
            reasonCode: "SOLD_OUT",
        })!;
        const providerDetail = detail() as NaverProductOrderDetail & {
            currentClaim: Record<string, unknown>;
        };
        providerDetail.currentClaim = {
            cancel: { claimStatus: "CANCELING" },
        };
        expect(inspectNaverProviderTarget(command, providerDetail)).toMatchObject({
            state: "INDETERMINATE",
            code: "PROVIDER_CANCEL_CAUSALITY_UNPROVEN",
        });
    });

    it("uses the deprecated cancel node only as fail-closed evidence", () => {
        const command = parseNaverCommandPayload("SELLER_CANCEL", {
            reasonCode: "SOLD_OUT",
        })!;
        const providerDetail = {
            ...detail(),
            cancel: { claimId: "legacy-cancel-1", claimStatus: "CANCEL_REJECT" },
        };

        expect(inspectNaverProviderTarget(command, providerDetail)).toMatchObject({
            state: "INDETERMINATE",
            code: "PROVIDER_CANCEL_CAUSALITY_UNPROVEN",
        });
    });

    it("never treats a completed partial cancellation as not applied", () => {
        const command = parseNaverCommandPayload("SELLER_CANCEL", {
            reasonCode: "SOLD_OUT",
            quantity: 1,
        })!;
        const providerDetail = {
            ...detail({ remainQuantity: 1 }),
            completedClaims: [{
                claimType: "CANCEL",
                claimId: "completed-cancel-1",
                claimStatus: "CANCEL_DONE",
                claimRequestDate: NOW,
                requestChannel: "SELLER",
                claimRequestReason: "SOLD_OUT",
                requestQuantity: 1,
            }],
        };

        expect(inspectNaverProviderTarget(command, providerDetail)).toMatchObject({
            state: "INDETERMINATE",
            code: "PROVIDER_CANCEL_CAUSALITY_UNPROVEN",
        });
    });

    it("finds completed admin-cancel evidence under productOrder", () => {
        const command = parseNaverCommandPayload("SELLER_CANCEL", {
            reasonCode: "SOLD_OUT",
        })!;

        expect(inspectNaverProviderTarget(command, detail({
            remainQuantity: 1,
            completedClaims: [{
                claimType: "ADMIN_CANCEL",
                claimId: "admin-cancel-1",
                claimStatus: "ADMIN_CANCEL_DONE",
                requestQuantity: 1,
            }],
        }))).toMatchObject({
            state: "INDETERMINATE",
            code: "PROVIDER_CANCEL_CAUSALITY_UNPROVEN",
        });
    });

    it("keeps unrelated current return and exchange claims as conflicts", () => {
        const command = parseNaverCommandPayload("SELLER_CANCEL", {
            reasonCode: "SOLD_OUT",
        })!;

        expect(inspectNaverProviderTarget(command, {
            ...detail(),
            currentClaim: { return: { claimStatus: "RETURN_REQUEST" } },
        })).toMatchObject({ state: "CONFLICT", code: "PROVIDER_CLAIM_CONFLICT" });
        expect(inspectNaverProviderTarget(command, {
            ...detail(),
            currentClaim: { exchange: { claimStatus: "EXCHANGE_REQUEST" } },
        })).toMatchObject({ state: "CONFLICT", code: "PROVIDER_CLAIM_CONFLICT" });
    });

    it("recognizes only the terminal canceled product order as applied", () => {
        const command = parseNaverCommandPayload("SELLER_CANCEL", {
            reasonCode: "SOLD_OUT",
        })!;

        expect(inspectNaverProviderTarget(command, detail({
            productOrderStatus: "CANCELED",
            remainQuantity: 0,
        }))).toMatchObject({ state: "APPLIED" });
    });

    it("recognizes a paid claim-free order as not yet seller-canceled", () => {
        const command = parseNaverCommandPayload("SELLER_CANCEL", {
            reasonCode: "SOLD_OUT",
        })!;
        expect(inspectNaverProviderTarget(command, detail())).toMatchObject({
            state: "NOT_APPLIED",
        });
    });
});

describe("Naver local preconditions", () => {
    const direct = parseNaverCommandPayload("DIRECT_DELIVERY", { dispatchAt: NOW })!;

    function validate(overrides: Parameters<typeof validateNaverCommandPreconditions>[0]) {
        return validateNaverCommandPreconditions(overrides);
    }

    it("rejects a stale item version", () => {
        expect(validate({
            command: direct,
            expectedVersion: 2,
            accountActive: true,
            accountAuthStatus: "CONNECTED",
            accountCapabilities: { DIRECT_DELIVERY: { mode: "API" } },
            item: item(),
            detail: detail(),
        })).toMatchObject({ ok: false, code: "STALE_ORDER_ITEM_VERSION" });
    });

    it("fails closed when the write capability is not API", () => {
        expect(validate({
            command: direct,
            expectedVersion: 3,
            accountActive: true,
            accountAuthStatus: "CONNECTED",
            accountCapabilities: { DIRECT_DELIVERY: { mode: "MANUAL_FALLBACK" } },
            item: item(),
            detail: detail(),
        })).toMatchObject({ ok: false, code: "MARKET_CAPABILITY_NOT_API" });
    });

    it("requires completed purchase and stored domestic invoice for parcel dispatch", () => {
        const invoice = parseNaverCommandPayload("INVOICE_SUBMIT", {
            carrierCode: "CJ",
            trackingNumber: "1234567890",
            dispatchAt: NOW,
        })!;
        expect(validate({
            command: invoice,
            expectedVersion: 3,
            accountActive: true,
            accountAuthStatus: "CONNECTED",
            accountCapabilities: { INVOICE_SUBMIT: { mode: "API" } },
            item: item(),
            detail: detail(),
        })).toMatchObject({ ok: false, code: "PURCHASE_AND_INVOICE_REQUIRED" });
    });

    it("allows direct delivery to remain preparing before purchase", () => {
        expect(validate({
            command: direct,
            expectedVersion: 3,
            accountActive: true,
            accountAuthStatus: "CONNECTED",
            accountCapabilities: { DIRECT_DELIVERY: { mode: "API" } },
            item: item(),
            detail: detail(),
        })).toEqual({ ok: true });
    });

    it("requires passed account UAT for seller cancellation", () => {
        const cancel = parseNaverCommandPayload("SELLER_CANCEL", {
            reasonCode: "SOLD_OUT",
            quantity: 1,
        })!;
        expect(validate({
            command: cancel,
            expectedVersion: 3,
            accountActive: true,
            accountAuthStatus: "CONNECTED",
            accountCapabilities: {
                SELLER_CANCEL: { mode: "API", uatStatus: "NOT_RUN" },
            },
            item: item(),
            detail: detail(),
        })).toMatchObject({ ok: false, code: "MARKET_CAPABILITY_NOT_API" });
    });

    it("rejects seller-cancel quantity above the provider remaining quantity", () => {
        const cancel = parseNaverCommandPayload("SELLER_CANCEL", {
            reasonCode: "SOLD_OUT",
            quantity: 2,
        })!;
        expect(validate({
            command: cancel,
            expectedVersion: 3,
            accountActive: true,
            accountAuthStatus: "CONNECTED",
            accountCapabilities: {
                SELLER_CANCEL: { mode: "API", uatStatus: "PASSED" },
            },
            item: item({ quantity: 3 }),
            detail: detail({ initialQuantity: 3, quantity: 3, remainQuantity: 1 }),
        })).toMatchObject({
            ok: false,
            code: "CANCEL_QUANTITY_EXCEEDS_REMAINING",
        });
    });

    it("accepts omitted quantity as all remaining when the provider snapshot is complete", () => {
        const cancel = parseNaverCommandPayload("SELLER_CANCEL", {
            reasonCode: "SOLD_OUT",
        })!;
        expect(validate({
            command: cancel,
            expectedVersion: 3,
            accountActive: true,
            accountAuthStatus: "CONNECTED",
            accountCapabilities: {
                SELLER_CANCEL: { mode: "API", uatStatus: "PASSED" },
            },
            item: item({ quantity: 3 }),
            detail: detail({ initialQuantity: 3, quantity: 3, remainQuantity: 1 }),
        })).toEqual({ ok: true });
    });

    it("does not infer remaining quantity from initial quantity after completed claim evidence", () => {
        const cancel = parseNaverCommandPayload("SELLER_CANCEL", {
            reasonCode: "SOLD_OUT",
        })!;
        expect(validate({
            command: cancel,
            expectedVersion: 3,
            accountActive: true,
            accountAuthStatus: "CONNECTED",
            accountCapabilities: {
                SELLER_CANCEL: { mode: "API", uatStatus: "PASSED" },
            },
            item: item(),
            detail: {
                ...detail(),
                completedClaims: [{
                    claimType: "CANCEL",
                    claimId: "completed-cancel-1",
                    claimStatus: "CANCEL_DONE",
                    requestQuantity: 1,
                }],
            },
        })).toMatchObject({
            ok: false,
            code: "PROVIDER_REMAINING_QUANTITY_MISSING",
        });
    });
});

describe("Naver result classification", () => {
    it("moves an ambiguous write timeout to UNKNOWN", () => {
        const resolution = classifyNaverIntegrationFailure({
            failure: failureResult({
                kind: "timeout",
                code: "REQUEST_TIMEOUT",
                message: "timeout",
                retryable: true,
            }),
            phase: "WRITE",
            attemptNumber: 1,
            maxAttempts: 3,
        });
        expect(resolution).toMatchObject({ status: "UNKNOWN", attemptOutcome: "UNKNOWN" });
    });

    it("retries a failed pre-read because no write effect is ambiguous", () => {
        const resolution = classifyNaverIntegrationFailure({
            failure: failureResult({
                kind: "network",
                code: "NETWORK_ERROR",
                message: "offline",
                retryable: true,
            }),
            phase: "READ",
            attemptNumber: 1,
            maxAttempts: 3,
        });
        expect(resolution).toMatchObject({ status: "RETRY", attemptOutcome: "RETRYABLE" });
    });

    it("treats a missing per-item write outcome as UNKNOWN", () => {
        const result = failureResult({
            kind: "remote_rejection",
            code: "NAVER_BATCH_REJECTED",
            message: "batch failed",
            retryable: true,
            details: {
                succeededProductOrderIds: [],
                failedProductOrders: [{
                    productOrderId: PRODUCT_ORDER_ID,
                    code: "MISSING_ITEM_RESULT",
                    retryable: true,
                }],
            },
        });
        expect(resolveNaverBatchResult({
            result,
            productOrderId: PRODUCT_ORDER_ID,
            attemptNumber: 1,
            maxAttempts: 3,
        })).toMatchObject({
            succeeded: false,
            resolution: { status: "UNKNOWN" },
        });
    });

    it("honors explicit per-item retryability", () => {
        const result = successResult({
            succeededProductOrderIds: [],
            failedProductOrders: [{
                productOrderId: PRODUCT_ORDER_ID,
                code: "TEMPORARY",
                retryable: true,
            }],
        }, raw);
        expect(resolveNaverBatchResult({
            result,
            productOrderId: PRODUCT_ORDER_ID,
            attemptNumber: 1,
            maxAttempts: 3,
        })).toMatchObject({
            succeeded: false,
            resolution: { status: "RETRY", attemptOutcome: "RETRYABLE" },
        });
    });

    it("keeps contradictory per-item success and failure evidence UNKNOWN", () => {
        const result = successResult({
            succeededProductOrderIds: [PRODUCT_ORDER_ID],
            failedProductOrders: [{
                productOrderId: PRODUCT_ORDER_ID,
                code: "CONFLICT",
                retryable: false,
            }],
        }, raw);
        expect(resolveNaverBatchResult({
            result,
            productOrderId: PRODUCT_ORDER_ID,
            attemptNumber: 1,
            maxAttempts: 3,
        })).toMatchObject({
            succeeded: false,
            resolution: { status: "UNKNOWN", code: "CONFLICTING_ITEM_RESULT" },
        });
    });
});

describe("Naver success projection", () => {
    it("puts a successfully requested seller cancellation on hold", () => {
        expect(deriveNaverSuccessPatch({
            type: "SELLER_CANCEL",
            item: item(),
            commandId: "command-1",
            now: NOW,
        })).toMatchObject({
            ok: true,
            internalWorkStatus: "ON_HOLD",
            marketFulfillmentStatus: "CANCEL_REQUESTED",
        });
    });

    it("keeps direct delivery in PREPARING until purchase and invoice exist", () => {
        expect(deriveNaverSuccessPatch({
            type: "DIRECT_DELIVERY",
            item: item(),
            commandId: "command-1",
            now: NOW,
        })).toMatchObject({
            ok: true,
            internalWorkStatus: "PREPARING",
            marketDeliveryMethod: "DIRECT_DELIVERY",
        });
    });

    it("advances parcel dispatch only when purchase and invoice are both present", () => {
        expect(deriveNaverSuccessPatch({
            type: "INVOICE_SUBMIT",
            item: item({
                sourcingStatus: "INVOICE_RECEIVED",
                domesticCarrierCode: "CJ",
                domesticTrackingNumber: "1234567890",
            }),
            commandId: "command-1",
            now: NOW,
        })).toMatchObject({
            ok: true,
            internalWorkStatus: "SHIPPING",
            marketDeliveryMethod: "DELIVERY",
        });
    });
});
