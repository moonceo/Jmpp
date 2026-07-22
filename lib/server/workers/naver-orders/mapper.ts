import { createHash } from "node:crypto";

import type {
  NaverChangedProductOrder,
  NaverProductOrderDetail,
} from "@/lib/server/integrations/naver";
import type {
  CursorCheckpoint,
  MappedNaverOrder,
  MappedNaverRecipient,
  NaverMappingResult,
  NaverStoredCursor,
  PreparedNaverRecord,
} from "@/lib/server/workers/naver-orders/types";
import { mapNaverClaimSnapshots } from "@/lib/server/workers/naver-orders/claim-mapper";

const SENSITIVE_KEY =
  /(orderer|receiver|recipient|buyer|customer|address|phone|telephone|(^|_)tel($|_)|mobile|email|customs|custom.?clearance|individual.?custom|zip.?code|postal|door.?code|(delivery|shipping).?memo|(delivery|shipping).?message)/i;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function nonEmptyString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function isoDate(value: unknown): string | null {
  const text = nonEmptyString(value);
  if (!text) return null;

  const timestamp = Date.parse(text);
  return Number.isNaN(timestamp) ? null : new Date(timestamp).toISOString();
}

function nonnegativeNumber(value: unknown): number | null {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

function positiveInteger(value: unknown): number | null {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function maskName(value: unknown): string | null {
  const name = nonEmptyString(value);
  if (!name) return null;
  const characters = Array.from(name);
  return characters.length === 1
    ? "*"
    : `${characters[0]}${"*".repeat(Math.min(characters.length - 1, 3))}`;
}

function firstString(...values: unknown[]): string | null {
  for (const value of values) {
    const text = nonEmptyString(value);
    if (text) return text;
  }
  return null;
}

function childRecord(
  parent: Record<string, unknown>,
  key: string,
): Record<string, unknown> {
  const child = parent[key];
  return isRecord(child) ? child : {};
}

function normalizePhone(value: string | null): string | null {
  if (!value) return null;
  const digits = value.replace(/[^0-9]/g, "");
  return digits || null;
}

function mapRecipient(
  detail: NaverProductOrderDetail,
): MappedNaverRecipient | null {
  const detailRecord = detail as Record<string, unknown>;
  const order = detail.order as Record<string, unknown>;
  const productOrder = detail.productOrder as Record<string, unknown>;
  const shippingAddress = isRecord(productOrder.shippingAddress)
    ? productOrder.shippingAddress
    : isRecord(detailRecord.shippingAddress)
      ? detailRecord.shippingAddress
      : childRecord(order, "shippingAddress");
  const directAddress = nonEmptyString(productOrder.shippingAddress);
  const name = firstString(
    shippingAddress.name,
    shippingAddress.receiverName,
    shippingAddress.recipientName,
    productOrder.receiverName,
    detailRecord.receiverName,
  );
  const addressLine1 = firstString(
    shippingAddress.baseAddress,
    shippingAddress.addressLine1,
    shippingAddress.roadAddress,
    shippingAddress.address,
    directAddress,
    productOrder.baseAddress,
    productOrder.addressLine1,
  );
  if (!name || !addressLine1) return null;

  const phone = normalizePhone(
    firstString(
      shippingAddress.tel1,
      shippingAddress.phone,
      shippingAddress.receiverTel1,
      shippingAddress.tel2,
      shippingAddress.receiverTel2,
      productOrder.receiverTel1,
      productOrder.receiverTel2,
      productOrder.phone,
    ),
  );
  const personalCustomsCode = firstString(
    shippingAddress.personalCustomsClearanceCode,
    shippingAddress.personalCustomsCode,
    shippingAddress.individualCustomUniqueCode,
    productOrder.personalCustomsClearanceCode,
    productOrder.personalCustomsCode,
    productOrder.individualCustomUniqueCode,
    detailRecord.personalCustomsClearanceCode,
    detailRecord.individualCustomUniqueCode,
  )?.toUpperCase().replace(/[^A-Z0-9]/g, "") ?? null;

  return {
    name,
    nameMasked: maskName(name) ?? "*",
    phone,
    postalCode: firstString(
      shippingAddress.zipCode,
      shippingAddress.postalCode,
      productOrder.zipCode,
      productOrder.postalCode,
    ),
    addressLine1,
    addressLine2: firstString(
      shippingAddress.detailedAddress,
      shippingAddress.detailAddress,
      shippingAddress.addressLine2,
      productOrder.detailedAddress,
      productOrder.addressLine2,
    ),
    personalCustomsCode,
    deliveryMessage: firstString(
      productOrder.shippingMemo,
      productOrder.deliveryMemo,
      productOrder.deliveryMessage,
      shippingAddress.shippingMemo,
      shippingAddress.deliveryMessage,
      shippingAddress.deliveryMemo,
      detailRecord.shippingMemo,
      detailRecord.deliveryMessage,
    ),
  };
}

export function redactSensitiveRawFields(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(redactSensitiveRawFields);
  }
  if (!isRecord(value)) {
    return value;
  }

  return Object.fromEntries(
    Object.entries(value).map(([key, child]) => [
      key,
      SENSITIVE_KEY.test(key) ? "[REDACTED]" : redactSensitiveRawFields(child),
    ]),
  );
}

function normalizedStatus(rawStatus: string): MappedNaverOrder["normalizedStatus"] {
  const status = rawStatus.toUpperCase();

  if (status.includes("CANCEL") || status === "CANCELED") return "CANCELED";
  if (
    status.includes("CLAIM") ||
    status.includes("RETURN") ||
    status.includes("EXCHANGE") ||
    status.includes("HOLDBACK")
  ) {
    return "ON_HOLD";
  }
  if (status.includes("DELIVERED") || status.includes("PURCHASE_DECIDED")) {
    return "DELIVERED";
  }
  if (status.includes("DELIVERING") || status.includes("DISPATCH")) {
    return "SHIPPING";
  }
  if (status.includes("READY") || status.includes("PLACE_ORDER")) {
    return "READY_TO_SHIP";
  }
  if (status.includes("PREPARE") || status.includes("DELAY")) {
    return "PREPARING";
  }
  return "NEW";
}

function deliveryMethod(
  value: unknown,
): "DELIVERY" | "DIRECT_DELIVERY" | null {
  const method = nonEmptyString(value)?.toUpperCase();
  if (method === "DIRECT_DELIVERY" || method === "DIRECT") {
    return "DIRECT_DELIVERY";
  }
  if (method === "DELIVERY" || method === "PARCEL") return "DELIVERY";
  return null;
}

export function mapNaverProductOrder(
  change: NaverChangedProductOrder,
  detail: NaverProductOrderDetail,
): NaverMappingResult {
  const productOrder = detail.productOrder;
  const order = detail.order;
  const productOrderId =
    nonEmptyString(productOrder.productOrderId) ??
    nonEmptyString(change.productOrderId);
  if (!productOrderId) {
    return { ok: false, code: "MISSING_PRODUCT_ORDER_ID" };
  }

  const orderId =
    nonEmptyString(productOrder.orderId) ??
    nonEmptyString(order.orderId) ??
    nonEmptyString(change.orderId);
  if (!orderId) return { ok: false, code: "MISSING_ORDER_ID" };

  const sourceUpdatedAt = isoDate(change.lastChangedDate);
  if (!sourceUpdatedAt) return { ok: false, code: "INVALID_CHANGED_AT" };

  const marketStatusRaw =
    nonEmptyString(productOrder.productOrderStatus) ??
    nonEmptyString(change.productOrderStatus) ??
    "UNKNOWN";
  const quantity = positiveInteger(productOrder.quantity) ?? 1;
  const totalPaymentAmount = nonnegativeNumber(productOrder.totalPaymentAmount);
  const unitPrice =
    nonnegativeNumber(productOrder.unitPrice) ??
    (totalPaymentAmount === null ? 0 : totalPaymentAmount / quantity);
  const itemTotal = totalPaymentAmount ?? unitPrice * quantity;
  const orderDate = isoDate(order.orderDate);
  const paymentDate = isoDate(order.paymentDate);
  const status = normalizedStatus(marketStatusRaw);
  const safeRaw = redactSensitiveRawFields(detail) as Record<string, unknown>;
  const safeChange = redactSensitiveRawFields(change);

  return {
    ok: true,
    value: {
      order: {
        externalOrderId: orderId,
        externalOrderNumber: orderId,
        normalizedStatus: status,
        marketStatusRaw,
        grossAmount: itemTotal,
        paidAmount: paymentDate ? itemTotal : 0,
        buyerNameMasked: maskName(order.ordererName),
        orderedAt: orderDate ?? paymentDate ?? sourceUpdatedAt,
        paidAt: paymentDate,
        sourceCreatedAt: orderDate,
        sourceUpdatedAt,
        marketStatusUpdatedAt: sourceUpdatedAt,
        attributes: {
          market: "NAVER",
          lastChangedType: change.lastChangedType,
          claimType: change.claimType ?? null,
          claimStatus: change.claimStatus ?? null,
          raw: {
            change: safeChange,
            detail: safeRaw,
          },
        },
      },
      item: {
        externalOrderItemId: productOrderId,
        sourceLineKey: productOrderId,
        marketProductId: nonEmptyString(productOrder.productId),
        marketOptionId:
          nonEmptyString(productOrder.optionCode) ??
          nonEmptyString(productOrder.optionId),
        sellerSku:
          nonEmptyString(productOrder.sellerProductCode) ??
          nonEmptyString(productOrder.sellerSku),
        productName: nonEmptyString(productOrder.productName) ?? "[상품명 미제공]",
        optionName: nonEmptyString(productOrder.productOption),
        productUrl:
          nonEmptyString(productOrder.productUrl) ??
          nonEmptyString(productOrder.url),
        thumbnailUrl:
          nonEmptyString(productOrder.productImage) ??
          nonEmptyString(productOrder.thumbnailUrl),
        quantity,
        unitPrice,
        itemTotal,
        internalWorkStatus: status,
        marketStatusRaw,
        marketFulfillmentStatus:
          nonEmptyString(productOrder.deliveryStatus) ?? marketStatusRaw,
        marketDeliveryMethod: deliveryMethod(productOrder.deliveryMethod),
        domesticCarrierCode: nonEmptyString(productOrder.deliveryCompanyCode),
        domesticTrackingNumber: nonEmptyString(productOrder.trackingNumber),
        sourceUpdatedAt,
        attributes: {
          market: "NAVER",
          lastChangedType: change.lastChangedType,
          claimType: productOrder.claimType ?? change.claimType ?? null,
          claimStatus: productOrder.claimStatus ?? change.claimStatus ?? null,
          raw: {
            change: safeChange,
            productOrder: safeRaw.productOrder ?? {},
          },
        },
      },
      recipient: mapRecipient(detail),
    },
  };
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (!isRecord(value)) return value;

  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .filter((key) => value[key] !== undefined)
      .map((key) => [key, canonicalize(value[key])]),
  );
}

export function canonicalJson(value: unknown): string {
  return JSON.stringify(canonicalize(value));
}

export function prepareNaverRecord(
  change: NaverChangedProductOrder,
  detail: NaverProductOrderDetail | null,
): PreparedNaverRecord {
  const externalResourceId =
    nonEmptyString(change.productOrderId) ?? "UNKNOWN_PRODUCT_ORDER";
  const rawPayload = canonicalJson({ change, detail });
  const payloadSha256 = createHash("sha256")
    .update(rawPayload, "utf8")
    .digest("hex");
  const sourceEventAt = isoDate(change.lastChangedDate);
  const mapping = detail
    ? mapNaverProductOrder(change, detail)
    : ({ ok: false, code: "MISSING_DETAIL" } as const);

  const claimMapping = detail && mapping.ok
    ? mapNaverClaimSnapshots({
        change,
        detail,
        externalOrderId: mapping.value.order.externalOrderId,
        externalOrderItemId: mapping.value.item.externalOrderItemId,
        orderQuantity: mapping.value.item.quantity,
        sourceUpdatedAt: mapping.value.item.sourceUpdatedAt,
      })
    : { snapshots: [], issues: [] };

  return {
    change,
    detail,
    rawPayload,
    payloadSha256,
    externalResourceId,
    sourceEventAt,
    dedupeKey: [
      "NAVER",
      "PRODUCT_ORDER_CHANGED",
      externalResourceId,
      sourceEventAt ?? "UNKNOWN_TIME",
      payloadSha256,
    ].join(":"),
    mapping,
    claimMapping,
  };
}

export function productOrderIdFromDetail(
  detail: NaverProductOrderDetail,
): string | null {
  return nonEmptyString(detail.productOrder.productOrderId);
}

export function dedupeChangedProductOrders(
  changes: readonly NaverChangedProductOrder[],
): NaverChangedProductOrder[] {
  const byProductOrderId = new Map<string, NaverChangedProductOrder>();

  for (const change of changes) {
    const id = nonEmptyString(change.productOrderId);
    if (!id) continue;
    const previous = byProductOrderId.get(id);
    if (
      !previous ||
      (Date.parse(change.lastChangedDate) || 0) >=
        (Date.parse(previous.lastChangedDate) || 0)
    ) {
      byProductOrderId.set(id, change);
    }
  }

  return [...byProductOrderId.values()];
}

function cursorDate(value: unknown): string | null {
  return isoDate(value);
}

export interface InitialNaverQuery {
  queryStartedAt: string;
  cursorBefore: Record<string, unknown>;
  query: {
    lastChangedFrom: string;
    lastChangedTo: string;
    cursor?: { lastChangedFrom: string; moreSequence: string };
  };
}

export function buildInitialNaverQuery(input: {
  cursor: NaverStoredCursor | null;
  windowStart: string | null;
  windowEnd: string;
  initialLookbackMs: number;
  defaultOverlapSeconds: number;
}): InitialNaverQuery {
  const stored = input.cursor?.cursorValue ?? {};
  const storedFrom = cursorDate(stored.lastChangedFrom);
  const moreSequence = nonEmptyString(stored.moreSequence);
  const cursorBefore = { ...stored };

  if (storedFrom && moreSequence) {
    return {
      queryStartedAt: storedFrom,
      cursorBefore,
      query: {
        lastChangedFrom: storedFrom,
        lastChangedTo: input.windowEnd,
        cursor: { lastChangedFrom: storedFrom, moreSequence },
      },
    };
  }

  const windowEndMs = Date.parse(input.windowEnd);
  const base =
    cursorDate(input.cursor?.watermarkAt) ??
    storedFrom ??
    cursorDate(input.windowStart) ??
    new Date(windowEndMs - input.initialLookbackMs).toISOString();
  const overlapSeconds =
    input.cursor?.overlapSeconds ?? input.defaultOverlapSeconds;
  const overlapped = new Date(
    Math.min(Date.parse(base), windowEndMs) - overlapSeconds * 1_000,
  ).toISOString();

  return {
    queryStartedAt: overlapped,
    cursorBefore,
    query: {
      lastChangedFrom: overlapped,
      lastChangedTo: input.windowEnd,
    },
  };
}

export function checkpointAfterPage(input: {
  nextCursor: { lastChangedFrom: string; moreSequence: string } | null;
  windowEnd: string;
}): CursorCheckpoint {
  if (input.nextCursor) {
    return {
      cursorValue: { ...input.nextCursor },
      watermarkAt: null,
    };
  }

  return {
    cursorValue: { lastChangedFrom: input.windowEnd },
    watermarkAt: input.windowEnd,
  };
}
