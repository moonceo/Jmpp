import { describe, expect, it } from "vitest";
import { resolveOrdersView } from "@/app/orders/page";
import {
    collectionTabs,
    createSellerCanceledOrder,
    createPaymentWaitingOrder,
    getSourcingProgressStage,
    getOrderListStatuses,
    getOrderStatusFilterOptions,
    getOrderViewCount,
    mapApiMarketOrderStatus,
    mapApiOrderStatus,
    mapApiProgress,
    mapApiSourcingStatus,
    summarizeOrderSyncRuns,
} from "@/components/orders/orders-page-client";
import { createColumns, getProcessActionAvailability, getProcessActionVisibility, getProcessResultLabel } from "@/components/orders/shared/columns";
import { ORDER_STATUSES, ORDER_STATUS_LABELS } from "@/lib/constants/orders";
import { mockOrders } from "@/lib/mock-data/orders";
import { getSourcingProgressViewMeta, hasCompletedSourcingPurchase } from "@/lib/sourcing-progress";

describe("order table columns", () => {
    it("places progress status immediately before process actions", () => {
        const noop = () => undefined;
        const columns = createColumns({
            onOpenSourcing: noop,
            onLiveSourcingMappingSaved: noop,
            onSaveSourcingMatch: noop,
            onCreateSourcingPaymentWait: noop,
            onCompleteSourcingPayment: noop,
            onCompleteManualPurchase: noop,
            onSourcingAndAcceptOrder: noop,
            onAcceptOrder: noop,
            onCancelOrder: () => true,
            onApproveCancelClaim: noop,
            onRejectCancelClaim: noop,
            onDispatchDirectDelivery: noop,
            onSendInvoice: noop,
            onSaveInvoice: noop,
            onSaveRecipientInfo: noop,
        });

        expect(columns.map((column) => (
            column.id ?? ("accessorKey" in column ? String(column.accessorKey) : undefined)
        ))).toEqual([
            "select",
            "sourcingLifeInfo",
            "process",
            "orderDate",
            "productInfo",
            "invoice",
            "deliveryInfo",
            "marketAccount",
        ]);
    });
});

describe("live order hold projection", () => {
    it("preserves the internal and market cancellation states", () => {
        expect(mapApiOrderStatus("ON_HOLD")).toBe("ON_HOLD");
        expect(mapApiMarketOrderStatus("CANCEL_REQUESTED")).toBe("CANCEL_REQUESTED");
    });

    it("keeps ON_HOLD orders visible in the all-orders view", () => {
        expect(ORDER_STATUSES.ALL).toContain("ON_HOLD");
        expect(ORDER_STATUSES.PREPARING).not.toContain("ON_HOLD");
        expect(ORDER_STATUS_LABELS.ON_HOLD).toBe("처리보류");
    });

    it("makes the all-orders query reachable through the route and tab", () => {
        expect(resolveOrdersView("all")).toBe("all");
        expect(resolveOrdersView(undefined)).toBe("new");
        expect(collectionTabs[0]).toEqual({ view: "all", href: "/orders?view=all" });
        expect(getOrderViewCount([{ status: "ON_HOLD" }], "all")).toBe(1);
    });

    it("offers a direct ON_HOLD filter on the all-orders tab", () => {
        expect(getOrderStatusFilterOptions("all")).toContainEqual({
            value: "ON_HOLD",
            label: "처리보류",
        });
        expect(getOrderListStatuses({
            status: "ON_HOLD",
            sourcingLifeSyncStatus: "HOLD",
        })).toContain("ON_HOLD");
    });

    it("uses sourcing and payment terminology for sourcing progress filters", () => {
        expect(getOrderStatusFilterOptions("new")).toEqual([
            { value: "MATCH_REQUIRED", label: "소싱필요" },
            { value: "MATCH_PENDING_REVIEW", label: "소싱 검증대기" },
        ]);
        expect(getOrderStatusFilterOptions("preparing")).toContainEqual({
            value: "MATCHED",
            label: "소싱완료",
        });
        expect(getOrderStatusFilterOptions("waiting")).toContainEqual({
            value: "SOURCED",
            label: "결제완료",
        });
        expect(getOrderStatusFilterOptions("waiting")).not.toContainEqual(expect.objectContaining({
            value: "EXTERNAL_PURCHASE",
        }));
    });

    it("exposes no operational action for an ON_HOLD row", () => {
        expect(getProcessActionAvailability({
            status: "ON_HOLD",
            marketType: "naver",
            marketDeliveryMethod: "DIRECT_DELIVERY",
            marketOrderStatus: "CANCEL_REQUESTED",
        })).toMatchObject({
            canAccept: false,
            canSource: false,
            canCompleteManualPurchase: false,
            canCancel: false,
            canSendInvoice: false,
            canDispatchDirectDelivery: false,
        });
    });
});

describe("demo sourcing payment wait", () => {
    it("stops after forwarder selection without creating payment or an invoice", () => {
        const order = mockOrders.find((item) => item.id === "ORD-20260610-0002");
        expect(order).toBeDefined();

        const waiting = createPaymentWaitingOrder(
            order!,
            {
                candidateId: "candidate-1",
                optionId: "option-1",
                productName: "테스트 소싱상품",
                optionName: "화이트",
                quantity: 1,
                estimatedCost: 15000,
            },
            {
                code: "sl-weihai-a",
                name: "소싱라이프 위해 A센터",
                receiverName: "SL-A센터",
                phone: "18663144075",
                address: "중국 산동성 웨이하이시 테스트 주소",
            },
            "2026-07-16 10:00",
        );

        expect(waiting).toMatchObject({
            status: "PREPARING",
            sourcingLifeSyncStatus: "PAYMENT_READY",
            sourcingProgressStage: "PAYMENT_WAITING",
            sourcingPaymentRequestedAt: "2026-07-16 10:00",
        });
        expect(waiting.sourcingLifeActualPayment).toBeUndefined();
        expect(waiting.domesticInvoice).toBeUndefined();
        expect(getProcessActionAvailability(waiting)).toMatchObject({
            paymentWaiting: true,
            canSource: true,
            canCompleteManualPurchase: false,
            canDispatchDirectDelivery: false,
        });
    });

    it("ships a visible payment-wait demo order", () => {
        const waitingOrder = mockOrders.find((item) => item.sourcingProgressStage === "PAYMENT_WAITING");
        expect(waitingOrder).toMatchObject({
            status: "PREPARING",
            sourcingLifeSyncStatus: "PAYMENT_READY",
            sourcingForwarder: { code: "sl-weihai-a" },
        });
    });
});

describe("mock order data quality", () => {
    const hasValidCustomsCode = (value?: string) => /^P\d{12}$/.test(value?.trim().toUpperCase() ?? "");

    it("keeps order IDs unique", () => {
        expect(new Set(mockOrders.map((order) => order.id)).size).toBe(mockOrders.length);
    });

    it("keeps every payment-waiting order ready for a valid payment attempt", () => {
        const waitingOrders = mockOrders.filter((order) => order.sourcingProgressStage === "PAYMENT_WAITING");

        expect(waitingOrders.length).toBeGreaterThanOrEqual(3);
        waitingOrders.forEach((order) => {
            expect(order.status).toBe("PREPARING");
            expect(hasValidCustomsCode(order.recipient.personalCustomsCode)).toBe(true);
            expect(order.sourcingLifeMatch).toBeDefined();
            expect(order.sourcingForwarder).toBeDefined();
            expect(order.sourcingPaymentRequestedAt).toBeTruthy();
            expect(order.sourcingLifeActualPayment).toBeUndefined();
            expect(order.sourcingLifeOrderId).toBeUndefined();
            expect(order.domesticInvoice).toBeUndefined();
        });
    });

    it("keeps every paid SourcingLife demo complete enough for the payment-complete view", () => {
        const paidOrders = mockOrders.filter((order) => (
            order.sourcingProgressStage !== "EXTERNAL_PURCHASE"
            && hasCompletedSourcingPurchase(order)
        ));

        expect(paidOrders.length).toBeGreaterThan(0);
        paidOrders.forEach((order) => {
            expect(hasValidCustomsCode(order.recipient.personalCustomsCode)).toBe(true);
            expect(order.sourcingLifeMatch).toBeDefined();
            expect(order.sourcingForwarder).toBeDefined();
            expect(order.sourcingLifeActualPayment).toBeDefined();
            expect(order.sourcingLifeOrderId).toBeTruthy();
            expect(order.domesticInvoice?.trackingNumber).toBeTruthy();
        });
    });

    it("keeps customs-code mismatch demos before payment and delivery stages", () => {
        const mismatchOrders = mockOrders.filter((order) => !hasValidCustomsCode(order.recipient.personalCustomsCode));

        expect(mismatchOrders.map((order) => order.id)).toEqual([
            "ORD-20260617-0027",
            "ORD-20260618-0041",
        ]);
        mismatchOrders.forEach((order) => {
            expect(["NEW", "PREPARING"]).toContain(order.status);
            expect(order.sourcingLifeSyncStatus).not.toBe("PAYMENT_READY");
            expect(hasCompletedSourcingPurchase(order)).toBe(false);
        });
    });

    it("keeps direct-delivery prepayment work in product preparation", () => {
        const directDeliveryPrepayment = mockOrders.find((order) => (
            order.status === "PREPARING"
            && order.marketDeliveryMethod === "DIRECT_DELIVERY"
            && order.marketOrderStatus === "DELIVERING"
            && !hasCompletedSourcingPurchase(order)
        ));

        expect(directDeliveryPrepayment).toBeDefined();
        expect(hasValidCustomsCode(directDeliveryPrepayment?.recipient.personalCustomsCode)).toBe(true);
    });
});

describe("sourcing status projection", () => {
    it("projects live payment readiness as payment waiting", () => {
        expect(mapApiProgress("PAYMENT_READY")).toBe("PAYMENT_WAITING");
    });

    it("does not infer China shipping from domestic invoice receipt", () => {
        expect(mapApiProgress("INVOICE_RECEIVED")).toBe("SOURCED");
        expect(getSourcingProgressStage({
            status: "READY_TO_SHIP",
            sourcingLifeSyncStatus: "INVOICE_RECEIVED",
        })).toBe("SOURCED");
    });

    it("does not represent an external purchase as a SourcingLife payment", () => {
        expect(mapApiSourcingStatus("EXTERNAL_PURCHASE")).toBe("NOT_LINKED");
        expect(mapApiProgress("EXTERNAL_PURCHASE")).toBe("EXTERNAL_PURCHASE");
        expect(getOrderListStatuses({
            status: "READY_TO_SHIP",
            sourcingProgressStage: "EXTERNAL_PURCHASE",
            sourcingLifeSyncStatus: "NOT_LINKED",
        })).toEqual(["SOURCED"]);
    });

    it("preserves sourcing progress when a demo order is seller-canceled", () => {
        const sourcedOrder = mockOrders.find((order) => order.sourcingLifeSyncStatus === "INVOICE_RECEIVED");
        expect(sourcedOrder).toBeDefined();

        expect(createSellerCanceledOrder(sourcedOrder!, "2026-07-16 16:00")).toMatchObject({
            status: "CANCELED",
            sourcingLifeSyncStatus: "INVOICE_RECEIVED",
            sourcingProgressStage: sourcedOrder!.sourcingProgressStage,
        });
    });
});

describe("process-column result labels", () => {
    it("never exposes seller cancellation for a direct-delivery order", () => {
        for (const status of ["NEW", "PREPARING", "READY_TO_SHIP"] as const) {
            expect(getProcessActionAvailability({
                status,
                marketType: "naver",
                marketDeliveryMethod: "DIRECT_DELIVERY",
                marketOrderStatus: "DELIVERING",
            }).canCancel).toBe(false);
        }
    });

    it("keeps low-frequency preparing actions in detail only", () => {
        const preparingOrder = {
            status: "PREPARING" as const,
            marketType: "naver" as const,
            marketDeliveryMethod: "DELIVERY" as const,
            marketOrderStatus: "PAYED" as const,
            sourcingProgressStage: "MATCHED" as const,
        };

        expect(getProcessActionVisibility(preparingOrder, "list")).toMatchObject({
            showSource: true,
            showManualPurchase: false,
            showDirectDelivery: false,
            showCancel: true,
        });
        expect(getProcessActionVisibility(preparingOrder, "detail")).toMatchObject({
            showManualPurchase: true,
            showDirectDelivery: true,
            showCancel: true,
        });
    });

    it("shows only delivery processing in a ready-to-ship list and all valid actions in detail", () => {
        const readyOrder = {
            status: "READY_TO_SHIP" as const,
            marketType: "naver" as const,
            marketDeliveryMethod: "DELIVERY" as const,
            marketOrderStatus: "PAYED" as const,
            sourcingLifeSyncStatus: "PAID" as const,
            sourcingProgressStage: "SOURCED" as const,
        };

        expect(getProcessActionVisibility(readyOrder, "list")).toMatchObject({
            showSendInvoice: true,
            showProgressView: false,
            showCancel: false,
        });
        expect(getProcessActionVisibility(readyOrder, "detail")).toMatchObject({
            showSendInvoice: true,
            showProgressView: true,
            showCancel: true,
        });
    });

    it("keeps delivery progress out of the process column", () => {
        expect(getProcessResultLabel({ status: "SHIPPING", sourcingProgressStage: "CHINA_SHIPPING" })).toBeUndefined();
        expect(getProcessResultLabel({ status: "SHIPPING", sourcingProgressStage: "CUSTOMS_CLEARANCE" })).toBeUndefined();
        expect(getProcessResultLabel({ status: "SHIPPING", sourcingProgressStage: "DOMESTIC_SHIPPING" })).toBeUndefined();
        expect(getProcessResultLabel({ status: "DELIVERED" })).toBeUndefined();
        expect(getProcessResultLabel({ status: "DELIVERED", marketOrderStatus: "PURCHASE_DECIDED" })).toBeUndefined();
    });

    it("keeps operational hold and cancellation results in the process column", () => {
        expect(getProcessResultLabel({ status: "ON_HOLD" })).toBe("처리보류");
        expect(getProcessResultLabel({ status: "CANCELED" })).toBe("주문취소");
    });

    it("keeps payment-complete and delivered views without logistics-stage modals", () => {
        expect(getProcessActionAvailability({
            status: "SHIPPING",
            marketType: "naver",
            sourcingLifeSyncStatus: "INVOICE_RECEIVED",
            sourcingProgressStage: "CHINA_SHIPPING",
        })).toMatchObject({
            canViewSourcingProgress: false,
            sourcingProgressView: undefined,
        });
        expect(getSourcingProgressViewMeta({ sourcingProgressStage: "CHINA_SHIPPING" })).toBeUndefined();
        expect(getSourcingProgressViewMeta({ sourcingProgressStage: "CUSTOMS_CLEARANCE" })).toBeUndefined();
        expect(getSourcingProgressViewMeta({ sourcingProgressStage: "DOMESTIC_SHIPPING" })).toBeUndefined();
        expect(getSourcingProgressViewMeta({ sourcingProgressStage: "SOURCED" })).toMatchObject({
            label: "결제완료",
            actionLabel: "결제완료 보기",
        });
        expect(getSourcingProgressViewMeta({ sourcingProgressStage: "DELIVERED" })).toMatchObject({
            label: "배송완료",
            actionLabel: "배송완료 보기",
        });
    });

    it("never exposes payment or shipment actions for an unpaid delivery-stage order", () => {
        expect(getProcessActionAvailability({
            status: "SHIPPING",
            marketType: "naver",
            sourcingLifeSyncStatus: "PAYMENT_READY",
            sourcingProgressStage: "PAYMENT_WAITING",
        })).toMatchObject({
            canSource: false,
            canViewSourcingProgress: false,
            canSendInvoice: false,
            paymentStateMismatch: true,
            purchaseCompleted: false,
        });
    });

    it("requires a completed purchase before treating a sourcing order as shippable", () => {
        expect(hasCompletedSourcingPurchase({ sourcingProgressStage: "PAYMENT_WAITING" })).toBe(false);
        expect(hasCompletedSourcingPurchase({ sourcingLifeSyncStatus: "PAID" })).toBe(true);
        expect(hasCompletedSourcingPurchase({ sourcingProgressStage: "EXTERNAL_PURCHASE" })).toBe(true);
        expect(hasCompletedSourcingPurchase({ sourcingProgressStage: "CHINA_SHIPPING" })).toBe(true);
    });

    it("keeps every visible ready-to-ship and shipping demo order purchase-complete", () => {
        const deliveryStageOrders = mockOrders.filter((order) => ["READY_TO_SHIP", "SHIPPING", "DELIVERED"].includes(order.status));

        expect(deliveryStageOrders.length).toBeGreaterThan(0);
        expect(deliveryStageOrders.every((order) => hasCompletedSourcingPurchase(order))).toBe(true);
    });
});

describe("manual order collection summary", () => {
    const run = (status: "SUCCEEDED" | "PARTIAL" | "FAILED", inserted: number, updated: number, errors: number) => ({
        id: crypto.randomUUID(),
        marketAccountId: crypto.randomUUID(),
        marketCode: "NAVER",
        storeName: "테스트 스토어",
        status,
        counters: { seen: inserted + updated, inserted, updated, skipped: 0, errors },
        errorMessage: status === "FAILED" ? "수집 실패" : null,
    });

    it("aggregates inserted and updated orders from every account", () => {
        expect(summarizeOrderSyncRuns([
            run("SUCCEEDED", 3, 2, 0),
            run("SUCCEEDED", 1, 4, 0),
        ])).toEqual({ inserted: 4, updated: 6, errors: 0, succeeded: 2, partial: 0, failed: 0 });
    });

    it("keeps partial and failed runs separate from successful runs", () => {
        expect(summarizeOrderSyncRuns([
            run("SUCCEEDED", 2, 0, 0),
            run("PARTIAL", 1, 1, 2),
            run("FAILED", 0, 0, 1),
        ])).toEqual({ inserted: 3, updated: 1, errors: 3, succeeded: 1, partial: 1, failed: 1 });
    });
});
