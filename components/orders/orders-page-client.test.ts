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
    mapApiManagedOrderStatus,
    mapApiOrderStatus,
    mapApiProgress,
    mapApiSourcingStatus,
    summarizeOrderSyncRuns,
} from "@/components/orders/orders-page-client";
import { createColumns, getProcessActionAvailability, getProcessActionVisibility, getProcessResultLabel, getSourcingActionLabel } from "@/components/orders/shared/columns";
import { hasCompletedMarketShipping, isDirectDeliveryEligible, supportsDirectDelivery, supportsOverseasOtherDelivery } from "@/components/orders/shipping-process-dialog";
import { getSourcingRefundActionLabel } from "@/components/orders/sourcing-workflow-dialog";
import { MARKET_ABBREVIATIONS, ORDER_STATUSES, ORDER_STATUS_LABELS } from "@/lib/constants/orders";
import { mockOrders } from "@/lib/mock-data/orders";
import { calculateOrderMargin } from "@/lib/order-margin";
import { getOrderShippingInformation } from "@/lib/order-shipping-information";
import { getSourcingProgressViewMeta, hasCompletedSourcingPurchase } from "@/lib/sourcing-progress";

describe("order table columns", () => {
    it("places selection, process actions, order date, and progress status first", () => {
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
            onProcessShipping: noop,
            onSaveInvoice: noop,
            onSaveRecipientInfo: noop,
            onRestartSourcingAfterRefund: noop,
        });

        expect(columns.map((column) => (
            column.id ?? ("accessorKey" in column ? String(column.accessorKey) : undefined)
        ))).toEqual([
            "select",
            "process",
            "orderDate",
            "sourcingLifeInfo",
            "productInfo",
            "marginInfo",
            "invoice",
            "deliveryInfo",
        ]);
    });

    it("uses a compact market icon beside the store name in the order-date cell", () => {
        expect(MARKET_ABBREVIATIONS).toEqual({
            naver: "N",
            coupang: "C",
            "11st": "11",
            gmarket: "G",
            auction: "A",
        });
    });
});

describe("order shipping information", () => {
    it("provides domestic tracking, direct-delivery status, and China tracking separately", () => {
        const directOrder = mockOrders.find((order) => (
            order.marketDeliveryMethod === "DIRECT_DELIVERY"
            && order.chinaInvoice?.trackingNumber
        ));
        expect(directOrder).toBeDefined();

        expect(getOrderShippingInformation(directOrder!)).toMatchObject({
            domesticTrackingNumber: directOrder!.domesticInvoice?.trackingNumber,
            isDirectDelivery: true,
            directDeliveryLabel: "직접전달",
            chinaTrackingNumber: directOrder!.chinaInvoice?.trackingNumber,
        });

        const orderWithoutChinaTracking = mockOrders.find((order) => order.sourcingProgressStage === "PAYMENT_WAITING");
        const regularShippingInformation = getOrderShippingInformation(orderWithoutChinaTracking!);
        expect(regularShippingInformation).toMatchObject({
            isDirectDelivery: false,
            chinaTrackingNumber: undefined,
        });
        expect(regularShippingInformation).not.toHaveProperty("directDeliveryLabel");
    });

    it("shows only the overseas-other processing label without exposing its arbitrary tracking reference", () => {
        const overseasOrder = mockOrders.find((order) => order.marketDeliveryMethod === "OVERSEAS_OTHER_DELIVERY");
        expect(overseasOrder).toBeDefined();
        expect(overseasOrder?.marketType).toBe("naver");
        const shippingInformation = getOrderShippingInformation(overseasOrder!);
        expect(shippingInformation).toMatchObject({
            marketProcessingLabel: "해외기타배송",
            domesticTrackingNumber: "512606180053",
        });
        expect(shippingInformation).not.toHaveProperty("marketCarrier");
        expect(shippingInformation).not.toHaveProperty("marketTrackingNumber");
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

    it("keeps operational hold states out of the sourcing progress filter", () => {
        expect(getOrderStatusFilterOptions("all")).not.toContainEqual(expect.objectContaining({
            value: "ON_HOLD",
        }));
        expect(getOrderListStatuses({
            status: "ON_HOLD",
            sourcingLifeSyncStatus: "HOLD",
        })).toContain("MATCH_REQUIRED");
    });

    it("uses sourcing and payment terminology for sourcing progress filters", () => {
        expect(getOrderStatusFilterOptions("new")).toEqual([
            { value: "MATCH_REQUIRED", label: "소싱필요" },
        ]);
        expect(getOrderListStatuses({
            status: "PREPARING",
            sourcingLifeSyncStatus: "MATCHING",
            sourcingProgressStage: "MATCH_PENDING_REVIEW",
        })).toEqual(["MATCH_REQUIRED"]);
        expect(getOrderStatusFilterOptions("preparing")).toContainEqual({
            value: "MATCHED",
            label: "매칭완료",
        });
        expect(getOrderStatusFilterOptions("waiting")).toContainEqual({
            value: "SOURCED",
            label: "결제완료",
        });
        expect(getOrderStatusFilterOptions("waiting")).not.toContainEqual(expect.objectContaining({
            value: "EXTERNAL_PURCHASE",
        }));
    });

    it("keeps every tab-specific status option available even when no order currently uses it", () => {
        expect(getOrderStatusFilterOptions("preparing")).toEqual([
            { value: "MATCH_REQUIRED", label: "소싱필요" },
            { value: "MATCHED", label: "매칭완료" },
            { value: "PAYMENT_WAITING", label: "결제대기" },
        ]);
        expect(getOrderStatusFilterOptions("waiting")).toEqual([
            { value: "SOURCED", label: "결제완료" },
            { value: "CHINA_SHIPPING", label: "중국배송중" },
            { value: "CUSTOMS_CLEARANCE", label: "통관 중" },
            { value: "DOMESTIC_SHIPPING", label: "국내 배송중" },
        ]);
        expect(getOrderStatusFilterOptions("shipping")).toEqual([
            { value: "SOURCED", label: "결제완료" },
            { value: "CHINA_SHIPPING", label: "중국배송중" },
            { value: "CUSTOMS_CLEARANCE", label: "통관 중" },
            { value: "DOMESTIC_SHIPPING", label: "국내 배송중" },
        ]);
        expect(getOrderStatusFilterOptions("delivered")).toEqual([
            { value: "DELIVERED", label: "배송완료" },
            { value: "PURCHASE_CONFIRMED", label: "구매확정" },
        ]);
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
    it("demonstrates every margin source and an exceptional negative margin in the order list", () => {
        const margins = mockOrders.map((order) => calculateOrderMargin(order));

        expect(margins.some((margin) => margin?.costBasis === "ACTUAL_PAYMENT")).toBe(true);
        expect(margins.some((margin) => margin?.costBasis === "MATCHED_PRICE")).toBe(true);
        expect(margins.some((margin) => margin?.costBasis === "DIRECT_PURCHASE")).toBe(true);
        expect(margins.some((margin) => margin === undefined)).toBe(true);
        expect(margins.some((margin) => margin !== undefined && margin.marginAmount < 0)).toBe(true);
    });

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

    it("keeps direct-delivery prepayment work undispatched in product preparation", () => {
        const directDeliveryPrepayment = mockOrders.find((order) => (
            order.status === "PREPARING"
            && order.marketDeliveryMethod === "DIRECT_DELIVERY"
            && !hasCompletedMarketShipping(order)
            && !hasCompletedSourcingPurchase(order)
        ));

        expect(directDeliveryPrepayment).toBeDefined();
        expect(hasValidCustomsCode(directDeliveryPrepayment?.recipient.personalCustomsCode)).toBe(true);
    });

    it("never dispatches a demo marketplace order before sourcing or direct purchase completes", () => {
        expect(mockOrders.filter((order) => (
            hasCompletedMarketShipping(order) && !hasCompletedSourcingPurchase(order)
        ))).toEqual([]);
    });

    it("includes all three marketplace methods only after market dispatch", () => {
        const submittedMethods = new Set(mockOrders
            .filter((order) => order.status === "SHIPPING" && order.marketOrderStatus === "DELIVERING")
            .map((order) => order.marketDeliveryMethod));

        expect(submittedMethods).toEqual(new Set(["DELIVERY", "DIRECT_DELIVERY", "OVERSEAS_OTHER_DELIVERY"]));
    });

    it("keeps every mock product inside its marketplace shipping-method policy", () => {
        const methodsByMarket = new Map(["naver", "11st", "coupang", "gmarket", "auction"].map((market) => [
            market,
            new Set(mockOrders.filter((order) => order.marketType === market).map((order) => order.marketDeliveryMethod)),
        ]));

        expect(methodsByMarket.get("naver")).toEqual(new Set(["DELIVERY", "DIRECT_DELIVERY", "OVERSEAS_OTHER_DELIVERY"]));
        expect(methodsByMarket.get("11st")).toEqual(new Set(["DELIVERY", "DIRECT_DELIVERY"]));
        expect(methodsByMarket.get("coupang")).toEqual(new Set(["DELIVERY"]));
        expect(methodsByMarket.get("gmarket")).toEqual(new Set(["DELIVERY"]));
        expect(methodsByMarket.get("auction")).toEqual(new Set(["DELIVERY"]));

        mockOrders.filter((order) => order.marketDeliveryMethod === "DIRECT_DELIVERY").forEach((order) => {
            expect(supportsDirectDelivery(order)).toBe(true);
        });
        mockOrders.filter((order) => order.marketDeliveryMethod === "OVERSEAS_OTHER_DELIVERY").forEach((order) => {
            expect(supportsOverseasOtherDelivery(order)).toBe(true);
            expect(order.marketShippingReference?.trackingNumber).toBeTruthy();
            expect(order.domesticInvoice?.trackingNumber).toBeTruthy();
        });
    });

    it("keeps the shipping-wait tab populated with every invoice-only marketplace scenario", () => {
        const readyToShipOrders = mockOrders.filter((order) => order.status === "READY_TO_SHIP");

        expect(readyToShipOrders.length).toBeGreaterThanOrEqual(10);
        expect(new Set(readyToShipOrders.map((order) => order.marketType))).toEqual(
            new Set(["naver", "11st", "coupang", "gmarket", "auction"]),
        );
        ["ORD-20260618-0059", "ORD-20260618-0060", "ORD-20260618-0061", "ORD-20260618-0062"].forEach((id) => {
            expect(readyToShipOrders.find((order) => order.id === id)).toMatchObject({
                marketDeliveryMethod: "DELIVERY",
                marketOrderStatus: "PAYED",
                domesticInvoice: expect.objectContaining({ trackingNumber: expect.any(String) }),
            });
        });
    });

    it("never marks an internal domestic invoice as submitted before domestic shipping starts", () => {
        const prematurelySubmitted = mockOrders.filter((order) => (
            order.domesticInvoice?.uploadedToMarketAt
            && !["DOMESTIC_SHIPPING", "DELIVERED"].includes(order.sourcingProgressStage ?? "")
        ));

        expect(prematurelySubmitted).toEqual([]);
    });

    it.each([
        ["ORD-20260618-0045", "DIRECT_DELIVERY", "EXTERNAL_PURCHASE", false, undefined],
        ["ORD-20260618-0056", "OVERSEAS_OTHER_DELIVERY", "CUSTOMS_CLEARANCE", false, undefined],
        ["ORD-20260618-0057", "DIRECT_DELIVERY", "DOMESTIC_SHIPPING", true, undefined],
        ["ORD-20260618-0058", "DELIVERY", "DOMESTIC_SHIPPING", false, "crawler"],
    ] as const)(
        "keeps invoice-correction demo %s coherent",
        (id, marketDeliveryMethod, sourcingProgressStage, canEditInvoice, uploadMode) => {
            const order = mockOrders.find((item) => item.id === id);

            expect(order).toMatchObject({
                status: "SHIPPING",
                marketOrderStatus: "DELIVERING",
                marketDeliveryMethod,
                sourcingProgressStage,
                domesticInvoice: expect.objectContaining({ trackingNumber: expect.any(String) }),
            });
            expect(getProcessActionVisibility(order!, "detail").showInvoiceEdit).toBe(canEditInvoice);
            expect(order?.domesticInvoice?.uploadMode).toBe(uploadMode);
        },
    );
});

describe("sourcing status projection", () => {
    it("preserves the internal status instead of inferring shipping from sourcing payment", () => {
        expect(mapApiManagedOrderStatus("READY_TO_SHIP", "PAID")).toBe("READY_TO_SHIP");
        expect(mapApiManagedOrderStatus("PREPARING", "INVOICE_RECEIVED")).toBe("PREPARING");
        expect(mapApiManagedOrderStatus("DELIVERED", "PAID")).toBe("DELIVERED");
        expect(mapApiManagedOrderStatus("READY_TO_SHIP", "EXTERNAL_PURCHASE")).toBe("READY_TO_SHIP");
    });

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
    it("allows direct delivery only for SmartStore and 11st", () => {
        expect(supportsDirectDelivery({ marketType: "gmarket" })).toBe(false);
        expect(supportsDirectDelivery({ marketType: "auction" })).toBe(false);
        expect(supportsDirectDelivery({ marketType: "11st" })).toBe(true);
        expect(supportsDirectDelivery({ marketType: "naver", dataSource: "api" })).toBe(true);
        expect(supportsDirectDelivery({ marketType: "coupang", dataSource: "api" })).toBe(false);
        expect(supportsDirectDelivery({ marketType: "gmarket", dataSource: "api" })).toBe(false);
    });

    it("allows direct delivery by marketplace regardless of the order's previous delivery method", () => {
        expect(isDirectDeliveryEligible({ marketType: "naver", marketDeliveryMethod: "DIRECT_DELIVERY" })).toBe(true);
        expect(isDirectDeliveryEligible({ marketType: "11st", marketDeliveryMethod: "DIRECT_DELIVERY" })).toBe(true);
        expect(isDirectDeliveryEligible({ marketType: "naver", marketDeliveryMethod: "DELIVERY" })).toBe(true);
        expect(isDirectDeliveryEligible({ marketType: "coupang", marketDeliveryMethod: "DIRECT_DELIVERY" })).toBe(false);
    });

    it("allows cancellation before provisional direct dispatch and locks it after dispatch", () => {
        expect(getProcessActionAvailability({
            status: "PREPARING",
            marketType: "naver",
            marketDeliveryMethod: "DIRECT_DELIVERY",
            marketOrderStatus: "PAYED",
        }).canCancel).toBe(true);
        expect(getProcessActionAvailability({
            status: "READY_TO_SHIP",
            marketType: "naver",
            marketDeliveryMethod: "DIRECT_DELIVERY",
            marketOrderStatus: "DELIVERING",
        }).canCancel).toBe(false);
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
            showShippingProcess: false,
            showCancel: true,
        });
        const detailVisibility = getProcessActionVisibility(preparingOrder, "detail");
        expect(detailVisibility).toMatchObject({
            showManualPurchase: true,
            showShippingProcess: false,
            showCancel: true,
        });
        expect(detailVisibility).not.toHaveProperty("showRecipientEdit");
    });

    it("limits list processing actions to the essential action set for each order tab", () => {
        expect(getProcessActionVisibility({
            status: "NEW",
            marketType: "naver",
            marketDeliveryMethod: "DELIVERY",
            marketOrderStatus: "PAYED",
        }, "list")).toMatchObject({
            showAccept: true,
            showSource: true,
            showCancel: true,
            showManualPurchase: false,
            showShippingProcess: false,
            showInvoiceEdit: false,
            showProgressView: false,
            showDeliveryStatus: false,
        });

        expect(getProcessActionVisibility({
            status: "PREPARING",
            marketType: "naver",
            marketDeliveryMethod: "DELIVERY",
            marketOrderStatus: "PAYED",
            sourcingProgressStage: "MATCHED",
        }, "list")).toMatchObject({
            showAccept: false,
            showSource: true,
            showCancel: true,
            showManualPurchase: false,
            showShippingProcess: false,
            showInvoiceEdit: false,
            showProgressView: false,
            showDeliveryStatus: false,
        });

        const readyToShipOrder = {
            status: "READY_TO_SHIP" as const,
            marketType: "naver" as const,
            marketDeliveryMethod: "DELIVERY" as const,
            marketOrderStatus: "PAYED" as const,
            sourcingLifeSyncStatus: "INVOICE_RECEIVED" as const,
            sourcingProgressStage: "SOURCED" as const,
            domesticInvoice: {
                carrier: "CJ대한통운",
                trackingNumber: "1234567890",
                receivedAt: "2026-08-20 10:00",
            },
        };
        expect(getProcessActionVisibility(readyToShipOrder, "list")).toMatchObject({
            showAccept: false,
            showSource: false,
            showCancel: false,
            showManualPurchase: false,
            showShippingProcess: true,
            showInvoiceEdit: false,
            showProgressView: false,
            showDeliveryStatus: false,
        });

        for (const status of ["SHIPPING", "DELIVERED"] as const) {
            expect(getProcessActionVisibility({
                ...readyToShipOrder,
                status,
            }, "list")).toMatchObject({
                showAccept: false,
                showSource: false,
                showCancel: false,
                showManualPurchase: false,
                showShippingProcess: false,
                showInvoiceEdit: false,
                showProgressView: false,
                showDeliveryStatus: false,
            });
        }
    });

    it("provides the full detail action set for each pre-shipping progress state", () => {
        const newOrder = {
            status: "NEW",
            marketType: "naver",
            sourcingLifeSyncStatus: "NOT_LINKED",
        } as const;
        expect(getSourcingActionLabel(newOrder)).toBe("매칭하기");
        expect(getProcessActionVisibility(newOrder, "detail")).toMatchObject({
            showAccept: true,
            showSource: true,
            showCancel: true,
        });

        const paymentWaitingOrder = {
            status: "PREPARING",
            marketType: "naver",
            sourcingLifeSyncStatus: "PAYMENT_READY",
            sourcingProgressStage: "PAYMENT_WAITING",
            recipient: { name: "홍길동", phone: "010-0000-0000", address: "서울", personalCustomsCode: "P123456789012" },
        } as const;
        expect(getSourcingActionLabel(paymentWaitingOrder)).toBe("결제하기");
        expect(getSourcingActionLabel(paymentWaitingOrder, "list")).toBe("소싱하기");
        expect(getProcessActionVisibility(paymentWaitingOrder, "detail")).toMatchObject({
            showSource: true,
            showManualPurchase: false,
            showShippingProcess: false,
            showCancel: true,
        });

        expect(getProcessActionVisibility({
            ...paymentWaitingOrder,
            recipient: { ...paymentWaitingOrder.recipient, personalCustomsCode: "INVALID" },
        }, "detail")).toMatchObject({
            showSource: false,
            showCancel: true,
        });
    });

    it("keeps shipping-stage lookup and tracking actions in details only", () => {
        const readyOrder = {
            status: "SHIPPING" as const,
            marketType: "naver" as const,
            marketDeliveryMethod: "DELIVERY" as const,
            marketOrderStatus: "PAYED" as const,
            sourcingLifeSyncStatus: "PAID" as const,
            sourcingProgressStage: "SOURCED" as const,
            domesticInvoice: {
                carrier: "CJ대한통운",
                trackingNumber: "1234567890",
                receivedAt: "2026-08-20 10:00",
            },
        };

        expect(getProcessActionVisibility(readyOrder, "list")).toMatchObject({
            showShippingProcess: false,
            showProgressView: false,
            sourcingProgressActionLabel: "소싱상품관리",
            showDeliveryStatus: false,
            showCancel: false,
        });
        expect(getProcessActionVisibility(readyOrder, "detail")).toMatchObject({
            showShippingProcess: true,
            showInvoiceEdit: false,
            showProgressView: true,
            sourcingProgressActionLabel: "소싱상품관리",
            showDeliveryStatus: true,
            showCancel: false,
        });

        expect(getProcessActionVisibility({
            ...readyOrder,
            domesticInvoice: undefined,
        }, "detail")).toMatchObject({
            showShippingProcess: true,
            showInvoiceEdit: false,
        });
    });

    it("allows a completed manual purchase to edit its invoice and finish shipping later", () => {
        const manualPurchaseWaiting = {
            status: "READY_TO_SHIP" as const,
            marketType: "naver" as const,
            marketDeliveryMethod: "DELIVERY" as const,
            marketOrderStatus: "PAYED" as const,
            sourcingLifeSyncStatus: "NOT_LINKED" as const,
            sourcingProgressStage: "EXTERNAL_PURCHASE" as const,
            dataSource: "mock" as const,
        };

        expect(getProcessActionVisibility(manualPurchaseWaiting, "detail")).toMatchObject({
            showInvoiceEdit: true,
            showShippingProcess: true,
        });
        expect(getProcessActionVisibility(manualPurchaseWaiting, "list")).toMatchObject({
            showInvoiceEdit: false,
            showShippingProcess: true,
        });
        expect(getProcessActionVisibility({
            ...manualPurchaseWaiting,
            domesticInvoice: {
                carrier: "CJ대한통운",
                trackingNumber: "512606180040",
                receivedAt: "2026-06-18 13:40",
            },
        }, "detail")).toMatchObject({
            showInvoiceEdit: true,
            showShippingProcess: true,
        });
    });

    it.each(["DIRECT_DELIVERY", "DELIVERY"] as const)(
        "finishes an already submitted %s ready-to-ship order without another market choice",
        (marketDeliveryMethod) => {
            const dispatchedOrder = {
                status: "READY_TO_SHIP" as const,
                marketType: "naver" as const,
                marketDeliveryMethod,
                marketOrderStatus: "DELIVERING" as const,
                sourcingLifeSyncStatus: "INVOICE_RECEIVED" as const,
                sourcingProgressStage: "SOURCED" as const,
                domesticInvoice: {
                    carrier: "CJ대한통운",
                    trackingNumber: "1234567890",
                    receivedAt: "2026-08-20 10:00",
                    ...(marketDeliveryMethod === "DELIVERY" ? { uploadedToMarketAt: "2026-08-20 10:10" } : {}),
                },
            };

            expect(getProcessActionVisibility(dispatchedOrder, "detail")).toMatchObject({
                showShippingProcess: true,
                showInvoiceEdit: false,
                showCancel: false,
            });
            expect(getProcessActionVisibility(dispatchedOrder, "list")).toMatchObject({
                showShippingProcess: true,
                showProgressView: false,
                showDeliveryStatus: false,
                showCancel: false,
            });
        },
    );

    it.each(["DELIVERED", "PURCHASE_DECIDED"] as const)(
        "does not offer another market dispatch after the marketplace reaches %s",
        (marketOrderStatus) => {
            expect(getProcessActionVisibility({
                status: "READY_TO_SHIP",
                marketType: "naver",
                marketDeliveryMethod: "DIRECT_DELIVERY",
                marketOrderStatus,
                sourcingLifeSyncStatus: "INVOICE_RECEIVED",
                sourcingProgressStage: "SOURCED",
                domesticInvoice: {
                    carrier: "CJ대한통운",
                    trackingNumber: "1234567890",
                    receivedAt: "2026-08-20 10:00",
                },
            }, "detail")).toMatchObject({
                showShippingProcess: true,
                showCancel: false,
            });
        },
    );

    it("locks API invoice editing after dispatch without exposing a market correction action", () => {
        const shippingOrder = {
            status: "SHIPPING" as const,
            marketType: "naver" as const,
            marketDeliveryMethod: "DELIVERY" as const,
            marketOrderStatus: "DELIVERING" as const,
            sourcingLifeSyncStatus: "PAID" as const,
            sourcingProgressStage: "SOURCED" as const,
        };

        expect(getProcessActionVisibility(shippingOrder, "list")).toMatchObject({
            showProgressView: false,
            showDeliveryStatus: false,
            showShippingProcess: false,
        });
        const detailVisibility = getProcessActionVisibility(shippingOrder, "detail");
        expect(detailVisibility).toMatchObject({
            showProgressView: true,
            showInvoiceEdit: false,
            sourcingProgressActionLabel: "소싱상품관리",
        });
        expect(detailVisibility).not.toHaveProperty("showMarketAdminCorrection");
    });

    it.each(["DIRECT_DELIVERY", "OVERSEAS_OTHER_DELIVERY"] as const)(
        "allows the actual invoice to replace provisional %s processing",
        (marketDeliveryMethod) => {
            expect(getProcessActionVisibility({
                status: "SHIPPING",
                marketType: "naver",
                marketDeliveryMethod,
                marketOrderStatus: "DELIVERING",
                sourcingLifeSyncStatus: "PAID",
                sourcingProgressStage: "DOMESTIC_SHIPPING",
                shippingProcessStarted: true,
                domesticInvoice: {
                    carrier: "CJ대한통운",
                    trackingNumber: "1234567890",
                    receivedAt: "2026-08-20 10:00",
                },
            }, "detail")).toMatchObject({
                showShippingProcess: false,
                showInvoiceEdit: true,
            });
        },
    );

    it("provides demo orders for both provisional processing and actual-invoice replacement", () => {
        const beforeDomesticShipping = mockOrders.find((order) => order.id === "ORD-20260618-0045");
        expect(beforeDomesticShipping).toMatchObject({
            status: "SHIPPING",
            marketOrderStatus: "DELIVERING",
            marketDeliveryMethod: "DIRECT_DELIVERY",
            sourcingProgressStage: "EXTERNAL_PURCHASE",
            domesticInvoice: {
                trackingNumber: "512606180045",
            },
        });
        expect(getProcessActionVisibility(beforeDomesticShipping!, "detail").showInvoiceEdit).toBe(false);

        const domesticShipping = mockOrders.find((order) => order.id === "ORD-20260618-0054");
        expect(domesticShipping).toMatchObject({
            status: "SHIPPING",
            marketOrderStatus: "DELIVERING",
            marketDeliveryMethod: "OVERSEAS_OTHER_DELIVERY",
            sourcingProgressStage: "DOMESTIC_SHIPPING",
            domesticInvoice: {
                trackingNumber: "512606180054",
            },
        });
        expect(getProcessActionVisibility(domesticShipping!, "detail").showInvoiceEdit).toBe(true);

        const corrected = mockOrders.find((order) => order.id === "ORD-20260618-0055");
        expect(corrected).toMatchObject({
            status: "SHIPPING",
            marketOrderStatus: "DELIVERING",
            marketDeliveryMethod: "DELIVERY",
            sourcingProgressStage: "DOMESTIC_SHIPPING",
            domesticInvoice: {
                carrier: "CJ대한통운",
                trackingNumber: "512606180055",
                uploadMode: "crawler",
            },
        });
        expect(getProcessActionVisibility(corrected!, "detail").showInvoiceEdit).toBe(false);
    });

    it("locks invoice editing as soon as shipping processing starts", () => {
        expect(getProcessActionVisibility({
            status: "SHIPPING",
            marketType: "naver",
            marketDeliveryMethod: "DELIVERY",
            marketOrderStatus: "PAYED",
            sourcingLifeSyncStatus: "PAID",
            sourcingProgressStage: "SOURCED",
            shippingProcessStarted: true,
            domesticInvoice: {
                carrier: "CJ대한통운",
                trackingNumber: "1234567890",
                receivedAt: "2026-08-21 16:00",
            },
        }, "detail")).toMatchObject({
            showInvoiceEdit: false,
        });
    });

    it("hides unavailable edit and manual-purchase actions for live orders", () => {
        expect(getProcessActionVisibility({
            status: "PREPARING",
            marketType: "naver",
            dataSource: "api",
            sourcingProgressStage: "MATCHED",
        }, "detail")).toMatchObject({
            showManualPurchase: false,
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

    it("shows payment products and delivery tracking in detail only", () => {
        const chinaShippingOrder = {
            status: "SHIPPING",
            marketType: "naver",
            sourcingLifeSyncStatus: "INVOICE_RECEIVED",
            sourcingProgressStage: "CHINA_SHIPPING",
        } as const;

        expect(getProcessActionAvailability(chinaShippingOrder)).toMatchObject({
            canViewSourcingProgress: true,
            sourcingProgressView: {
                actionLabel: "소싱상품관리",
            },
            canViewDeliveryProgress: true,
            deliveryProgressView: {
                label: "중국배송중",
                currentStepIndex: 1,
            },
        });
        expect(getProcessActionVisibility(chinaShippingOrder, "list")).toMatchObject({
            showDeliveryStatus: false,
            showProgressView: false,
        });
        expect(getProcessActionVisibility(chinaShippingOrder, "detail")).toMatchObject({
            showDeliveryStatus: true,
        });
        expect(getProcessActionAvailability({
            ...chinaShippingOrder,
            sourcingProgressStage: "CUSTOMS_CLEARANCE",
        }).deliveryProgressView).toMatchObject({ label: "통관 중", currentStepIndex: 2 });
        expect(getProcessActionAvailability({
            ...chinaShippingOrder,
            sourcingProgressStage: "DOMESTIC_SHIPPING",
        }).deliveryProgressView).toMatchObject({ label: "국내 배송중", currentStepIndex: 3 });
        expect(getSourcingProgressViewMeta({ sourcingProgressStage: "PAYMENT_WAITING" })).toMatchObject({
            label: "결제대기",
            description: expect.stringContaining("중국 판매자"),
        });
        expect(getSourcingProgressViewMeta({ sourcingProgressStage: "SOURCED" })).toMatchObject({
            label: "결제완료",
            actionLabel: "소싱상품관리",
            description: expect.stringContaining("판매자 채팅"),
        });
        expect(getSourcingProgressViewMeta({ sourcingProgressStage: "DELIVERED" })).toMatchObject({
            label: "배송완료",
            actionLabel: "소싱상품관리",
            description: expect.stringContaining("중국 판매자 채팅"),
        });
    });

    it.each([
        "SOURCED",
        "CHINA_SHIPPING",
        "CUSTOMS_CLEARANCE",
        "DOMESTIC_SHIPPING",
        "DELIVERED",
    ] as const)("keeps sourcing product management in details throughout the paid stage %s", (sourcingProgressStage) => {
        const paidOrder = {
            status: sourcingProgressStage === "DELIVERED" ? "DELIVERED" as const : "SHIPPING" as const,
            marketType: "naver" as const,
            sourcingLifeSyncStatus: "PAID" as const,
            sourcingProgressStage,
        };

        expect(getProcessActionVisibility(paidOrder, "list")).toMatchObject({
            showProgressView: false,
        });
        expect(getProcessActionVisibility(paidOrder, "detail")).toMatchObject({
            showProgressView: true,
            sourcingProgressActionLabel: "소싱상품관리",
        });
    });

    it("keeps cumulative delivery history in details after delivery and return completion", () => {
        const deliveredOrder = {
            status: "DELIVERED",
            marketType: "naver",
            marketOrderStatus: "DELIVERED",
            sourcingLifeSyncStatus: "INVOICE_RECEIVED",
            sourcingProgressStage: "DELIVERED",
            sourcingLifeOrderId: "SL-DELIVERED-1",
        } as const;
        expect(getProcessActionVisibility(deliveredOrder, "list")).toMatchObject({
            showDeliveryStatus: false,
            showProgressView: false,
        });
        expect(getProcessActionVisibility(deliveredOrder, "detail")).toMatchObject({
            showDeliveryStatus: true,
        });

        const completedReturn = mockOrders.find((order) => order.claimType === "RETURN" && order.claimStatus === "반품완료");
        expect(completedReturn?.deliveryHistory?.some((event) => event.flow === "RETURN")).toBe(true);
        expect(getProcessActionVisibility(completedReturn!, "detail")).toMatchObject({
            showDeliveryStatus: true,
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

    it("keeps sourcing refund management out of process actions and labels it in the payment product view", () => {
        const refundOrder = {
            status: "SHIPPING",
            marketType: "naver",
            marketOrderStatus: "PAYED",
            sourcingLifeSyncStatus: "PAID",
            sourcingProgressStage: "SOURCED",
            sourcingLifeOrderId: "SL-ORDER-1",
            sourcingRefund: {
                id: "refund-1",
                providerRefundId: "110000312001",
                providerPurchaseOrderId: "2608284132117736001",
                providerStatusCode: 10,
                purchaseOrderLineId: "200002671001",
                type: "REFUND_ONLY",
                goodsStatus: "NOT_SHIPPED",
                status: "REQUESTED",
                reasonId: "403769",
                reasonLabel: "더 이상 원하지 않음",
                refundFeeCny: 43.86,
                currency: "CNY",
                requestedAt: "2026-08-12T10:00:00.000Z",
                updatedAt: "2026-08-12T10:00:00.000Z",
            },
        } as const;

        expect(getProcessActionAvailability(refundOrder)).toMatchObject({
            canSendInvoice: false,
            sourcingRefundActive: true,
        });
        expect(getProcessActionVisibility(refundOrder, "list")).not.toHaveProperty("showSourcingRefund");
        expect(getProcessActionVisibility(refundOrder, "detail")).toMatchObject({
            showRestartSourcingAfterRefund: false,
        });
        expect(getProcessActionVisibility(refundOrder, "detail")).not.toHaveProperty("showSourcingRefund");
        expect(getSourcingRefundActionLabel(refundOrder)).toBe("환불 진행");

        const refundedOrder = {
            ...refundOrder,
            domesticInvoice: {
                carrier: "CJ대한통운",
                trackingNumber: "1234567890",
                receivedAt: "2026-08-12 12:00",
            },
            sourcingRefund: {
                ...refundOrder.sourcingRefund,
                status: "REFUNDED" as const,
                providerStatusCode: 100,
            },
        };
        expect(getProcessActionAvailability(refundedOrder)).toMatchObject({
            canSendInvoice: false,
            sourcingRefundActive: false,
            sourcingRefundBlocksShipping: true,
        });
        expect(getProcessActionVisibility(refundedOrder, "list")).toMatchObject({
            showRestartSourcingAfterRefund: false,
        });
        expect(getProcessActionVisibility(refundedOrder, "detail")).toMatchObject({
            showRestartSourcingAfterRefund: true,
        });
        expect(getProcessActionVisibility(refundedOrder, "list")).not.toHaveProperty("showSourcingRefund");
        expect(getProcessActionVisibility(refundedOrder, "detail")).not.toHaveProperty("showSourcingRefund");
        expect(getSourcingRefundActionLabel(refundedOrder)).toBe("환불 내역");

        const requestableOrder = {
            status: "SHIPPING" as const,
            marketType: "naver" as const,
            marketOrderStatus: "PAYED" as const,
            sourcingLifeSyncStatus: "PAID" as const,
            sourcingProgressStage: "SOURCED" as const,
            sourcingLifeOrderId: "SL-ORDER-2",
            sourcingRefund: undefined,
            taoWorldPurchase: {
                distributorId: "2100000927014",
                purchaseOrderId: "2608284132117736002",
                purchaseOrderLineId: "200002671002",
                currency: "CNY" as const,
                paidAmountCny: 66.23,
                paidAt: "2026-08-12T10:00:00.000Z",
            },
        };

        expect(getProcessActionAvailability(requestableOrder).sourcingRefundAvailability.canOpen).toBe(true);
        expect(getProcessActionVisibility(requestableOrder, "list")).not.toHaveProperty("showSourcingRefund");
        expect(getProcessActionVisibility(requestableOrder, "detail")).not.toHaveProperty("showSourcingRefund");
        expect(getSourcingRefundActionLabel(requestableOrder)).toBe("반품·환불 신청");

        expect(getProcessActionVisibility({
            status: "READY_TO_SHIP",
            marketType: "gmarket",
            sourcingLifeSyncStatus: "NOT_LINKED",
            sourcingProgressStage: "EXTERNAL_PURCHASE",
        }, "detail")).not.toHaveProperty("showSourcingRefund");
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
