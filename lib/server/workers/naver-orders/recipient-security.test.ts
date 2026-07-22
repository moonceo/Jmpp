import { describe, expect, it } from "vitest";

import { createCredentialCipher } from "@/lib/server/security";
import {
  buildRecipientFieldSecretType,
  recipientBlindIndex,
  recipientFingerprintInput,
  recipientNeedsNewVersion,
} from "@/lib/server/workers/naver-orders/recipient-security";

const key = Buffer.alloc(32, 7).toString("base64");

describe("recipient security", () => {
  it("binds encrypted fields to an order and field-specific AAD value", () => {
    expect(
      buildRecipientFieldSecretType(
        "00000000-0000-4000-8000-000000000001",
        "ADDRESS_LINE1",
      ),
    ).toBe(
      "ORDER_RECIPIENT:00000000-0000-4000-8000-000000000001:ADDRESS_LINE1",
    );
  });

  it("encrypts a recipient field with tenant, account, order, and field AAD", () => {
    const cipher = createCredentialCipher(key);
    const tenantId = "00000000-0000-4000-8000-000000000001";
    const marketAccountId = "00000000-0000-4000-8000-000000000002";
    const salesOrderId = "00000000-0000-4000-8000-000000000003";
    const context = {
      tenantId,
      marketAccountId,
      secretType: buildRecipientFieldSecretType(salesOrderId, "NAME"),
    };
    const encrypted = cipher.encrypt("홍길동", context);

    expect(encrypted).not.toContain("홍길동");
    expect(cipher.decrypt(encrypted, context)).toBe("홍길동");
    expect(() =>
      cipher.decrypt(encrypted, {
        ...context,
        secretType: buildRecipientFieldSecretType(salesOrderId, "PHONE"),
      }),
    ).toThrow();
  });

  it("creates deterministic, purpose-separated keyed blind indexes", () => {
    const phone = recipientBlindIndex("01012345678", "PHONE", key);
    expect(phone).toMatch(/^[0-9a-f]{64}$/);
    expect(recipientBlindIndex("01012345678", "PHONE", key)).toBe(phone);
    expect(recipientBlindIndex("01012345678", "CUSTOMS", key)).not.toBe(
      phone,
    );
  });

  it("uses every normalized recipient field in the fingerprint input", () => {
    expect(
      recipientFingerprintInput({
        name: "홍길동",
        nameMasked: "홍**",
        phone: "01012345678",
        postalCode: "01234",
        addressLine1: "서울시 테스트로 1",
        addressLine2: "101호",
        personalCustomsCode: "P123456789012",
        deliveryMessage: "문 앞",
      }),
    ).toBe(
      '["홍길동","01012345678","01234","서울시 테스트로 1","101호","P123456789012","문 앞"]',
    );
  });

  it("rotates only when the keyed recipient fingerprint changes", () => {
    expect(recipientNeedsNewVersion(null, "next")).toBe(true);
    expect(recipientNeedsNewVersion("old", "next")).toBe(true);
    expect(recipientNeedsNewVersion("same", "same")).toBe(false);
  });
});
