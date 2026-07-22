import { describe, expect, it } from "vitest";

import type {
  NaverChangedProductOrder,
  NaverProductOrderDetail,
} from "@/lib/server/integrations/naver";
import {
  buildInitialNaverQuery,
  canonicalJson,
  mapNaverProductOrder,
  prepareNaverRecord,
} from "@/lib/server/workers/naver-orders/mapper";

const change: NaverChangedProductOrder = {
  productOrderStatus: "PRODUCT_PREPARE",
  productOrderId: "po-1",
  orderId: "order-1",
  lastChangedDate: "2026-07-10T01:02:03.000Z",
  lastChangedType: "PAYED",
};

const detail: NaverProductOrderDetail = {
  order: {
    orderId: "order-1",
    orderDate: "2026-07-09T23:00:00.000Z",
    paymentDate: "2026-07-09T23:01:00.000Z",
    ordererName: "홍길동",
    ordererTel: "010-1111-2222",
    receiverAddress: "서울시 비공개",
    campaignCode: "summer",
  },
  productOrder: {
    productOrderId: "po-1",
    orderId: "order-1",
    productId: "product-1",
    productName: "테스트 상품",
    productOption: "검정 / L",
    quantity: 2,
    unitPrice: 12_500,
    totalPaymentAmount: 25_000,
    productOrderStatus: "PRODUCT_PREPARE",
    receiverName: "홍길동",
    customMarketplaceField: "preserved",
  },
};

describe("mapNaverProductOrder", () => {
  it("maps conservative order fields and redacts PII from raw attributes", () => {
    const result = mapNaverProductOrder(change, detail);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.order).toMatchObject({
      externalOrderId: "order-1",
      normalizedStatus: "PREPARING",
      grossAmount: 25_000,
      paidAmount: 25_000,
      buyerNameMasked: "홍**",
      sourceUpdatedAt: "2026-07-10T01:02:03.000Z",
    });
    expect(result.value.item).toMatchObject({
      externalOrderItemId: "po-1",
      productName: "테스트 상품",
      quantity: 2,
      unitPrice: 12_500,
      itemTotal: 25_000,
    });

    const orderRawEnvelope = result.value.order.attributes.raw as Record<
      string,
      unknown
    >;
    const orderRaw = (orderRawEnvelope.detail as Record<string, unknown>)
      .order as Record<string, unknown>;
    const itemRawEnvelope = result.value.item.attributes.raw as Record<
      string,
      unknown
    >;
    const itemRaw = itemRawEnvelope.productOrder as Record<string, unknown>;
    expect(orderRaw.ordererName).toBe("[REDACTED]");
    expect(orderRaw.ordererTel).toBe("[REDACTED]");
    expect(orderRaw.receiverAddress).toBe("[REDACTED]");
    expect(orderRaw.campaignCode).toBe("summer");
    expect(itemRaw.receiverName).toBe("[REDACTED]");
    expect(itemRaw.productName).toBe("테스트 상품");
    expect(itemRaw.customMarketplaceField).toBe("preserved");
  });

  it("refuses an invalid source timestamp so stale ordering cannot be guessed", () => {
    expect(
      mapNaverProductOrder(
        { ...change, lastChangedDate: "not-a-date" },
        detail,
      ),
    ).toEqual({ ok: false, code: "INVALID_CHANGED_AT" });
  });

  it("extracts recipient PII defensively while keeping attributes redacted", () => {
    const recipientDetail: NaverProductOrderDetail = {
      order: detail.order,
      productOrder: {
        ...detail.productOrder,
        shippingAddress: {
          name: "김수취",
          tel1: "010-9876-5432",
          zipCode: "01234",
          baseAddress: "서울시 비공개로 1",
          detailedAddress: "101호",
        },
        individualCustomUniqueCode: "p123456789012",
        shippingMemo: "공동현관 앞",
      },
    };

    const result = mapNaverProductOrder(change, recipientDetail);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.recipient).toEqual({
      name: "김수취",
      nameMasked: "김**",
      phone: "01098765432",
      postalCode: "01234",
      addressLine1: "서울시 비공개로 1",
      addressLine2: "101호",
      personalCustomsCode: "P123456789012",
      deliveryMessage: "공동현관 앞",
    });

    const attributes = JSON.stringify({
      order: result.value.order.attributes,
      item: result.value.item.attributes,
    });
    expect(attributes).not.toContain("김수취");
    expect(attributes).not.toContain("010-9876-5432");
    expect(attributes).not.toContain("서울시 비공개로 1");
    expect(attributes).not.toContain("P123456789012");
    expect(attributes).not.toContain("공동현관 앞");
  });
});

describe("raw payload and cursor helpers", () => {
  it("canonicalizes object key order for stable snapshot hashes", () => {
    expect(canonicalJson({ z: 1, a: { y: 2, b: 3 } })).toBe(
      '{"a":{"b":3,"y":2},"z":1}',
    );
    expect(prepareNaverRecord(change, detail).payloadSha256).toMatch(
      /^[0-9a-f]{64}$/,
    );
  });

  it("subtracts the configured overlap from a completed watermark", () => {
    const result = buildInitialNaverQuery({
      cursor: {
        cursorValue: { lastChangedFrom: "2026-07-10T01:00:00.000Z" },
        watermarkAt: "2026-07-10T01:00:00.000Z",
        overlapSeconds: 300,
      },
      windowStart: null,
      windowEnd: "2026-07-10T02:00:00.000Z",
      initialLookbackMs: 86_400_000,
      defaultOverlapSeconds: 60,
    });

    expect(result.query.lastChangedFrom).toBe("2026-07-10T00:55:00.000Z");
    expect(result.query.lastChangedTo).toBe("2026-07-10T02:00:00.000Z");
    expect(result.query.cursor).toBeUndefined();
  });

  it("resumes an unfinished marketplace page without applying overlap again", () => {
    const result = buildInitialNaverQuery({
      cursor: {
        cursorValue: {
          lastChangedFrom: "2026-07-10T00:55:00.000Z",
          moreSequence: "next-page",
        },
        watermarkAt: "2026-07-10T01:00:00.000Z",
        overlapSeconds: 300,
      },
      windowStart: null,
      windowEnd: "2026-07-10T02:00:00.000Z",
      initialLookbackMs: 86_400_000,
      defaultOverlapSeconds: 60,
    });

    expect(result.query).toMatchObject({
      lastChangedFrom: "2026-07-10T00:55:00.000Z",
      cursor: {
        lastChangedFrom: "2026-07-10T00:55:00.000Z",
        moreSequence: "next-page",
      },
    });
  });
});
