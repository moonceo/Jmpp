import type {
    ClaimActionAvailabilityMap,
    ClaimDetail,
    ClaimProviderAction,
    ClaimRequester,
    ClaimSource,
    PurchaseCompensationStatus,
    ClaimStatus,
    ClaimType,
} from "@/lib/server/claims/types";
import type { Order } from "@/types/order";

export const DEMO_SELLER_CANCEL_STORAGE_KEY = "commerce-life.demo-seller-cancel-claims";

export type DemoClaimActionKey =
    | "APPROVE_CANCEL"
    | "STOP_SHIPMENT"
    | "ALREADY_SHIPPED"
    | "RETURN_RECEIVE"
    | "APPROVE_RETURN"
    | "HOLD"
    | "RELEASE_HOLD"
    | "REJECT_RETURN"
    | "EXCHANGE_RECEIVE"
    | "DISPATCH_EXCHANGE"
    | "REJECT_EXCHANGE";

export interface DemoClaimAction {
    key: DemoClaimActionKey;
    label: string;
    description: string;
    nextStatus: ClaimStatus | null;
    tone: "primary" | "secondary";
    requiresTracking?: boolean;
}

export interface DemoClaimWorkflow {
    stage: string;
    nextWork: string;
    risk: string | null;
    pickup: string | null;
    replacementShipment: string | null;
}

export interface DemoClaimDetail extends ClaimDetail {
    workflow: DemoClaimWorkflow;
}

const ACTIONS: readonly ClaimProviderAction[] = [
    "CANCEL_APPROVE",
    "CANCEL_REJECT",
    "CLAIM_WITHDRAW",
    "RETURN_APPROVE",
    "RETURN_REJECT",
    "RETURN_HOLD",
    "RETURN_RELEASE",
    "RETURN_RECEIVE",
    "EXCHANGE_APPROVE",
    "EXCHANGE_REJECT",
    "EXCHANGE_HOLD",
    "EXCHANGE_RELEASE",
    "EXCHANGE_RECEIVE",
    "EXCHANGE_DISPATCH",
];

function unavailableActions(): ClaimActionAvailabilityMap {
    return Object.fromEntries(ACTIONS.map((action) => [action, {
        available: false,
        execution: "UNAVAILABLE",
        reason: "CLAIM_PROVIDER_WRITES_NOT_IMPLEMENTED",
    }])) as ClaimActionAvailabilityMap;
}

interface DemoSeed {
    index: number;
    marketCode: "NAVER" | "COUPANG";
    storeName: string;
    claimType: ClaimType;
    status: ClaimStatus;
    rawStatus: string;
    reasonCode: string;
    reason: string;
    productName: string;
    optionName: string;
    quantity?: number;
    requestedAt: string;
    deadlineAt: string | null;
    overdue?: boolean;
    orderStatus: string;
    fulfillmentStatus: string;
    sourcingStatus?: string;
    purchaseCompensationStatus?: PurchaseCompensationStatus;
    purchaseCompensationReference?: string;
    workflow: DemoClaimWorkflow;
    source?: ClaimSource;
    requesterType?: ClaimRequester;
    eventType?: string;
}

function createClaim(seed: DemoSeed): DemoClaimDetail {
    const suffix = String(seed.index).padStart(2, "0");
    const id = `10000000-0000-4000-8000-0000000000${suffix}`;
    const lineId = `20000000-0000-4000-8000-0000000000${suffix}`;
    const eventId = `30000000-0000-4000-8000-0000000000${suffix}`;
    const quantity = seed.quantity ?? 1;
    const orderNumber = `${seed.marketCode === "NAVER" ? "20260715" : "CP-260715"}-${1000 + seed.index}`;

    return {
        id,
        marketAccountId: `40000000-0000-4000-8000-0000000000${suffix}`,
        marketCode: seed.marketCode,
        storeName: seed.storeName,
        salesOrderId: `50000000-0000-4000-8000-0000000000${suffix}`,
        externalOrderId: orderNumber,
        externalOrderNumber: orderNumber,
        externalClaimId: `${seed.marketCode}-${seed.claimType}-${10000 + seed.index}`,
        claimType: seed.claimType,
        source: seed.source ?? "MARKET",
        requesterType: seed.requesterType ?? "CUSTOMER",
        faultType: seed.reasonCode.includes("DEFECT") || seed.reasonCode.includes("WRONG") ? "SELLER" : "CUSTOMER",
        normalizedStatus: seed.status,
        marketStatusRaw: seed.rawStatus,
        marketReasonCode: seed.reasonCode,
        marketReasonMasked: seed.reason,
        deadlineAt: seed.deadlineAt,
        deadlineType: seed.deadlineAt ? "MARKET_ACTION_DUE" : null,
        deadlineOverdue: seed.overdue ?? false,
        resolutionType: seed.claimType === "EXCHANGE" ? "REPLACEMENT" : "REFUND",
        resolutionStatus: "PENDING",
        purchaseCompensationStatus: seed.purchaseCompensationStatus ?? "NOT_REQUIRED",
        purchaseCompensationReference: seed.purchaseCompensationReference ?? null,
        purchaseCompensationNextActionAt: null,
        requestedAt: seed.requestedAt,
        sourceUpdatedAt: seed.requestedAt,
        buyerNameMasked: "김**",
        recipientNameMasked: "김**",
        affectedLineCount: 1,
        totalClaimQuantity: quantity,
        version: "1",
        actionAvailability: unavailableActions(),
        providerProcessingId: null,
        providerErrorCode: null,
        rawSnapshotAvailable: true,
        orderStatusAtRequest: seed.orderStatus,
        itemStatusAtRequest: seed.orderStatus,
        sourcingStatusAtRequest: seed.sourcingStatus ?? "NOT_PURCHASED",
        fulfillmentStatusAtRequest: seed.fulfillmentStatus,
        reviewedAt: null,
        approvedAt: null,
        rejectedAt: null,
        collectionStartedAt: ["IN_TRANSIT", "RECEIVED", "REPLACEMENT_PENDING"].includes(seed.status) ? seed.requestedAt : null,
        receivedAt: ["RECEIVED", "REPLACEMENT_PENDING"].includes(seed.status) ? seed.requestedAt : null,
        resolvedAt: null,
        completedAt: null,
        purchaseCompensationCompletedAt: null,
        lines: [{
            id: lineId,
            orderItemId: `60000000-0000-4000-8000-0000000000${suffix}`,
            externalOrderItemId: `${orderNumber}-01`,
            externalClaimLineId: `${seed.marketCode}-LINE-${10000 + seed.index}`,
            productName: seed.productName,
            optionName: seed.optionName,
            orderedQuantity: quantity,
            requestedQuantity: quantity,
            itemStatusAtRequest: seed.orderStatus,
            sourcingStatusAtRequest: seed.sourcingStatus ?? "NOT_PURCHASED",
            fulfillmentStatusAtRequest: seed.fulfillmentStatus,
            normalizedStatus: seed.status,
            marketStatusRaw: seed.rawStatus,
            marketReasonCode: seed.reasonCode,
            marketReasonMasked: seed.reason,
            resolutionType: seed.claimType === "EXCHANGE" ? "REPLACEMENT" : "REFUND",
            resolutionStatus: "PENDING",
            refundAmount: seed.claimType === "EXCHANGE" ? null : "32900",
            refundCurrency: seed.claimType === "EXCHANGE" ? null : "KRW",
            version: "1",
        }],
        events: [{
            id: eventId,
            externalEventId: `${seed.marketCode}-EVENT-${10000 + seed.index}`,
            eventType: seed.eventType ?? "BUYER_CLAIM_REQUESTED",
            eventSource: seed.source ?? "MARKET",
            fromStatus: null,
            toStatus: seed.status,
            marketStatusRaw: seed.rawStatus,
            marketReasonCode: seed.reasonCode,
            sourceOccurredAt: seed.requestedAt,
            receivedAt: seed.requestedAt,
        }],
        eventsTruncated: false,
        workflow: seed.workflow,
    };
}

export const DEMO_BUYER_CLAIMS: DemoClaimDetail[] = [
    createClaim({
        index: 1,
        marketCode: "NAVER",
        storeName: "스마트 리빙",
        claimType: "CANCEL",
        status: "APPROVAL_PENDING",
        rawStatus: "CANCEL_REQUEST",
        reasonCode: "PRODUCT_UNNECESSARY",
        reason: "구매 의사 취소",
        productName: "접이식 노트북 거치대",
        optionName: "실버",
        requestedAt: "2026-07-15T00:20:00.000Z",
        deadlineAt: "2026-07-16T06:00:00.000Z",
        orderStatus: "PAYED",
        fulfillmentStatus: "NOT_DISPATCHED",
        sourcingStatus: "PURCHASE_COMPLETED",
        purchaseCompensationStatus: "NEEDS_ATTENTION",
        purchaseCompensationReference: "SL-REFUND-DEMO-0001",
        workflow: {
            stage: "출고 전 취소 승인 대기",
            nextWork: "발송 여부를 다시 확인한 뒤 취소 승인",
            risk: null,
            pickup: null,
            replacementShipment: null,
        },
    }),
    createClaim({
        index: 2,
        marketCode: "COUPANG",
        storeName: "데일리 픽",
        claimType: "CANCEL",
        status: "UNDER_REVIEW",
        rawStatus: "RELEASE_STOP_UNCHECKED",
        reasonCode: "SIMPLE_CHANGE_MIND",
        reason: "단순 변심",
        productName: "여행용 압축 파우치 6종",
        optionName: "베이지",
        requestedAt: "2026-07-15T01:10:00.000Z",
        deadlineAt: "2026-07-15T09:00:00.000Z",
        orderStatus: "INSTRUCT",
        fulfillmentStatus: "출고 작업 중",
        workflow: {
            stage: "출고중지 가능 여부 확인",
            nextWork: "미출고면 출고중지, 이미 인계했으면 배송완료 후 반품 전환",
            risk: "창고 인계 여부를 확인하지 않고 승인하면 오배송될 수 있습니다.",
            pickup: null,
            replacementShipment: null,
        },
    }),
    createClaim({
        index: 3,
        marketCode: "NAVER",
        storeName: "스마트 리빙",
        claimType: "RETURN",
        status: "IN_TRANSIT",
        rawStatus: "RETURNING",
        reasonCode: "CHANGE_MIND",
        reason: "사이즈가 맞지 않음",
        productName: "논슬립 주방 매트",
        optionName: "120cm / 그레이",
        requestedAt: "2026-07-14T02:00:00.000Z",
        deadlineAt: "2026-07-17T06:00:00.000Z",
        orderStatus: "DELIVERED",
        fulfillmentStatus: "한진택배 5312-****-8891",
        sourcingStatus: "PURCHASE_COMPLETED",
        purchaseCompensationStatus: "IN_PROGRESS",
        purchaseCompensationReference: "SL-REFUND-DEMO-0003",
        workflow: {
            stage: "반품 회수 중",
            nextWork: "회수 도착 후 수량·훼손을 검수하고 입고 완료",
            risk: null,
            pickup: "한진택배 / 5210-****-1102 / 회수 중",
            replacementShipment: null,
        },
    }),
    createClaim({
        index: 4,
        marketCode: "COUPANG",
        storeName: "데일리 픽",
        claimType: "RETURN",
        status: "RECEIVED",
        rawStatus: "VENDOR_WAREHOUSE_CONFIRM",
        reasonCode: "DEFECTIVE_PRODUCT",
        reason: "봉제 불량",
        productName: "캠핑 릴렉스 체어",
        optionName: "카키",
        requestedAt: "2026-07-13T05:30:00.000Z",
        deadlineAt: "2026-07-15T07:00:00.000Z",
        overdue: true,
        orderStatus: "DELIVERED",
        fulfillmentStatus: "CJ대한통운 6890-****-7710",
        sourcingStatus: "PURCHASE_COMPLETED",
        purchaseCompensationStatus: "SUCCEEDED",
        purchaseCompensationReference: "SL-REFUND-DEMO-0004",
        workflow: {
            stage: "판매자 창고 입고 확인",
            nextWork: "불량을 확인하고 반품 승인하여 환불 단계 진행",
            risk: "처리기한이 지났습니다. 실물 확인 후 즉시 처리하세요.",
            pickup: "CJ대한통운 / 6890-****-9921 / 입고 완료",
            replacementShipment: null,
        },
    }),
    createClaim({
        index: 5,
        marketCode: "NAVER",
        storeName: "스마트 리빙",
        claimType: "RETURN",
        status: "ON_HOLD",
        rawStatus: "RETURN_HOLDBACK",
        reasonCode: "COMPONENT_MISSING",
        reason: "구성품 일부 누락",
        productName: "무선 미니 가습기",
        optionName: "화이트 / 2개",
        quantity: 2,
        requestedAt: "2026-07-12T04:10:00.000Z",
        deadlineAt: "2026-07-15T05:00:00.000Z",
        overdue: true,
        orderStatus: "DELIVERED",
        fulfillmentStatus: "롯데택배 2391-****-4110",
        workflow: {
            stage: "구성품 누락으로 반품 보류",
            nextWork: "구매자에게 누락 구성품 확인 후 보류 해제 또는 반품 거부",
            risk: "보류 사유와 구매자 안내 기록이 필요합니다.",
            pickup: "롯데택배 / 2391-****-7742 / 입고 완료",
            replacementShipment: null,
        },
    }),
    createClaim({
        index: 6,
        marketCode: "NAVER",
        storeName: "스마트 리빙",
        claimType: "EXCHANGE",
        status: "RECEIVED",
        rawStatus: "EXCHANGE_REDELIVERING",
        reasonCode: "WRONG_PRODUCT",
        reason: "다른 색상 배송",
        productName: "모듈형 수납 바스켓",
        optionName: "아이보리 → 차콜",
        requestedAt: "2026-07-13T00:40:00.000Z",
        deadlineAt: "2026-07-16T03:00:00.000Z",
        orderStatus: "DELIVERED",
        fulfillmentStatus: "로젠택배 9981-****-2040",
        workflow: {
            stage: "교환품 재배송 대기",
            nextWork: "교환 상품을 확보하고 새 송장을 등록해 재배송",
            risk: null,
            pickup: "로젠택배 / 9981-****-3088 / 입고 완료",
            replacementShipment: "송장 미등록",
        },
    }),
    createClaim({
        index: 7,
        marketCode: "COUPANG",
        storeName: "데일리 픽",
        claimType: "EXCHANGE",
        status: "REPLACEMENT_PENDING",
        rawStatus: "REDELIVERY",
        reasonCode: "DEFECTIVE_PRODUCT",
        reason: "전원 불량",
        productName: "USB 충전식 무드등",
        optionName: "웜화이트",
        requestedAt: "2026-07-12T07:25:00.000Z",
        deadlineAt: "2026-07-15T08:00:00.000Z",
        orderStatus: "DELIVERED",
        fulfillmentStatus: "쿠팡 회수 완료",
        workflow: {
            stage: "교환상품 송장 등록 대기",
            nextWork: "새 shipmentBoxId의 택배사·송장을 등록",
            risk: "기한 내 재배송 송장을 입력해야 합니다.",
            pickup: "쿠팡 지정택배 / 회수 완료",
            replacementShipment: "shipmentBoxId 발급 / 송장 미등록",
        },
    }),
    createClaim({
        index: 8,
        marketCode: "COUPANG",
        storeName: "데일리 픽",
        claimType: "EXCHANGE",
        status: "ON_HOLD",
        rawStatus: "EXCHANGE_REJECT_REQUESTED",
        reasonCode: "SOLDOUT",
        reason: "교환상품 품절",
        productName: "린넨 암막 커튼",
        optionName: "오프화이트 / 150x230",
        requestedAt: "2026-07-14T03:15:00.000Z",
        deadlineAt: "2026-07-16T09:00:00.000Z",
        orderStatus: "DELIVERED",
        fulfillmentStatus: "쿠팡 회수 완료",
        workflow: {
            stage: "교환품 품절 예외",
            nextWork: "구매자 안내 후 품절 사유로 교환 거부 또는 대체재 확보",
            risk: "쿠팡 교환 거부는 허용 사유와 현재 상태를 WING에서 재확인해야 합니다.",
            pickup: "쿠팡 지정택배 / 회수 완료",
            replacementShipment: "품절",
        },
    }),
];

const MARKET_CODE_BY_TYPE: Record<Order["marketType"], DemoClaimDetail["marketCode"]> = {
    naver: "NAVER",
    coupang: "COUPANG",
    "11st": "ELEVEN_STREET",
    gmarket: "GMARKET",
    auction: "AUCTION",
};

export function createDemoSellerCancelClaim(
    order: Order,
    canceledAt: string,
    reason = "판매자 주문취소",
): DemoClaimDetail {
    const sourceOccurredAt = new Date(canceledAt.replace(" ", "T")).toISOString();
    const purchased = ["PAID", "INVOICE_RECEIVED"].includes(order.sourcingLifeSyncStatus);

    return {
        id: `demo-seller-cancel-${order.id}`,
        marketAccountId: order.marketAccountId ?? `demo-${order.marketType}`,
        marketCode: MARKET_CODE_BY_TYPE[order.marketType],
        storeName: order.storeName,
        salesOrderId: order.id,
        externalOrderId: order.marketOrderId,
        externalOrderNumber: order.marketOrderId,
        externalClaimId: `SELLER-CANCEL-${order.id}`,
        claimType: "CANCEL",
        source: "SELLER",
        requesterType: "SELLER",
        faultType: "SELLER",
        normalizedStatus: "COMPLETED",
        marketStatusRaw: "SELLER_CANCEL_COMPLETED",
        marketReasonCode: "SELLER_CANCEL",
        marketReasonMasked: reason,
        deadlineAt: null,
        deadlineType: null,
        deadlineOverdue: false,
        resolutionType: "REFUND",
        resolutionStatus: "SUCCEEDED",
        purchaseCompensationStatus: purchased ? "NEEDS_ATTENTION" : "NOT_REQUIRED",
        purchaseCompensationReference: purchased ? `SL-REFUND-${order.id}` : null,
        purchaseCompensationNextActionAt: purchased ? sourceOccurredAt : null,
        requestedAt: sourceOccurredAt,
        sourceUpdatedAt: sourceOccurredAt,
        buyerNameMasked: order.buyerName,
        recipientNameMasked: order.recipient.name,
        affectedLineCount: 1,
        totalClaimQuantity: order.product.quantity,
        version: "1",
        actionAvailability: unavailableActions(),
        providerProcessingId: null,
        providerErrorCode: null,
        rawSnapshotAvailable: true,
        orderStatusAtRequest: order.status,
        itemStatusAtRequest: order.status,
        sourcingStatusAtRequest: order.sourcingLifeSyncStatus,
        fulfillmentStatusAtRequest: order.domesticInvoice
            ? `${order.domesticInvoice.carrier} ${order.domesticInvoice.trackingNumber}`
            : "미출고",
        reviewedAt: sourceOccurredAt,
        approvedAt: sourceOccurredAt,
        rejectedAt: null,
        collectionStartedAt: null,
        receivedAt: null,
        resolvedAt: sourceOccurredAt,
        completedAt: sourceOccurredAt,
        purchaseCompensationCompletedAt: null,
        lines: [{
            id: `demo-seller-cancel-line-${order.id}`,
            orderItemId: order.id,
            externalOrderItemId: order.product.productOrderId ?? order.product.id,
            externalClaimLineId: `SELLER-CANCEL-LINE-${order.id}`,
            productName: order.product.name,
            optionName: order.product.optionName,
            orderedQuantity: order.product.quantity,
            requestedQuantity: order.product.quantity,
            itemStatusAtRequest: order.status,
            sourcingStatusAtRequest: order.sourcingLifeSyncStatus,
            fulfillmentStatusAtRequest: order.domesticInvoice ? "국내송장 있음" : "미출고",
            normalizedStatus: "COMPLETED",
            marketStatusRaw: "SELLER_CANCEL_COMPLETED",
            marketReasonCode: "SELLER_CANCEL",
            marketReasonMasked: reason,
            resolutionType: "REFUND",
            resolutionStatus: "SUCCEEDED",
            refundAmount: String(order.paymentPrice),
            refundCurrency: "KRW",
            version: "1",
        }],
        events: [{
            id: `demo-seller-cancel-event-${order.id}`,
            externalEventId: null,
            eventType: "SELLER_CANCEL_COMPLETED",
            eventSource: "SELLER",
            fromStatus: null,
            toStatus: "COMPLETED",
            marketStatusRaw: "SELLER_CANCEL_COMPLETED",
            marketReasonCode: "SELLER_CANCEL",
            sourceOccurredAt,
            receivedAt: sourceOccurredAt,
        }],
        eventsTruncated: false,
        workflow: {
            stage: "판매자 직접취소 완료",
            nextWork: purchased ? "소싱 구매가 있었다면 환불 후속조치를 확인" : "완료 목록에서 이력을 확인",
            risk: null,
            pickup: null,
            replacementShipment: null,
        },
    };
}

export const DEMO_SELLER_CANCEL_CLAIMS: DemoClaimDetail[] = [
    createDemoSellerCancelClaim({
        id: "ORD-DEMO-SELLER-CANCEL-01",
        marketOrderId: "NAVER-20260820-9101",
        marketType: "naver",
        storeName: "리빙온마켓",
        orderDate: "2026-08-20 09:20",
        status: "CANCELED",
        buyerName: "한지민",
        buyerPhone: "010-0000-0000",
        recipient: { name: "한지민", phone: "010-0000-0000", address: "서울특별시" },
        product: {
            id: "PROD-DEMO-SELLER-CANCEL-01",
            productOrderId: "NAVER-PROD-SELLER-CANCEL-01",
            name: "원목 접이식 사이드 테이블",
            thumbnail: "/images/product-placeholder.svg",
            optionName: "내추럴",
            quantity: 1,
            unitPrice: 38900,
        },
        paymentPrice: 38900,
        platformFee: 1400,
        expectedSettlement: 37500,
        sourcingLifeSyncStatus: "NOT_LINKED",
        sellerCancelReason: "상품 품절",
        sellerCanceledAt: "2026-08-20T09:45:00+09:00",
        dataSource: "demo",
    }, "2026-08-20T09:45:00+09:00", "상품 품절"),
];
