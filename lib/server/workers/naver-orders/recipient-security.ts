import { createHmac } from "node:crypto";

import type { MappedNaverRecipient } from "@/lib/server/workers/naver-orders/types";

export type RecipientField =
  | "NAME"
  | "PHONE"
  | "POSTAL_CODE"
  | "ADDRESS_LINE1"
  | "ADDRESS_LINE2"
  | "CUSTOMS_CODE"
  | "DELIVERY_MESSAGE";

export type RecipientBlindIndexPurpose = "PHONE" | "CUSTOMS" | "FINGERPRINT";

function dataEncryptionKey(encodedKey: string | undefined): Buffer {
  const value = encodedKey?.trim();
  if (!value) throw new Error("DATA_ENCRYPTION_KEY is required for recipient indexing.");
  if (
    !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(
      value,
    )
  ) {
    throw new Error("DATA_ENCRYPTION_KEY must be canonical base64.");
  }

  const key = Buffer.from(value, "base64");
  if (key.length !== 32 || key.toString("base64") !== value) {
    key.fill(0);
    throw new Error("DATA_ENCRYPTION_KEY must decode to 32 bytes.");
  }
  return key;
}

export function buildRecipientFieldSecretType(
  salesOrderId: string,
  field: RecipientField,
): string {
  if (!salesOrderId.trim() || salesOrderId.includes("\0")) {
    throw new Error("salesOrderId is required for recipient field encryption.");
  }
  return `ORDER_RECIPIENT:${salesOrderId}:${field}`;
}

export function recipientBlindIndex(
  value: string,
  purpose: RecipientBlindIndexPurpose,
  encodedKey: string | undefined = process.env.DATA_ENCRYPTION_KEY,
): string {
  const key = dataEncryptionKey(encodedKey);
  try {
    return createHmac("sha256", key)
      .update("jumunpangpang:order-recipient-index:v1", "utf8")
      .update("\0", "utf8")
      .update(purpose, "utf8")
      .update("\0", "utf8")
      .update(value, "utf8")
      .digest("hex");
  } finally {
    key.fill(0);
  }
}

export function recipientFingerprintInput(
  recipient: MappedNaverRecipient,
): string {
  return JSON.stringify([
    recipient.name,
    recipient.phone,
    recipient.postalCode,
    recipient.addressLine1,
    recipient.addressLine2,
    recipient.personalCustomsCode,
    recipient.deliveryMessage,
  ]);
}

export function recipientNeedsNewVersion(
  currentFingerprint: string | null,
  nextFingerprint: string,
): boolean {
  return currentFingerprint !== nextFingerprint;
}
