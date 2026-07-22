import { describe, expect, it } from "vitest";
import { prepareInboundClaimSnapshot } from "@/lib/server/claims/service";
import type { InboundClaimSnapshotPayloadInput } from "@/lib/server/claims/schemas";

const TENANT_ID = "00000000-0000-4000-8000-000000000001";
const ACCOUNT_ID = "00000000-0000-4000-8000-000000000002";
const CORRELATION_ID = "00000000-0000-4000-8000-000000000003";

const CONTEXT = {
    tenantId: TENANT_ID,
    marketAccountId: ACCOUNT_ID,
    correlationId: CORRELATION_ID,
};

function snapshot(overrides: Partial<InboundClaimSnapshotPayloadInput> = {}): InboundClaimSnapshotPayloadInput {
    return {
        externalOrderId: "ORDER-1",
        externalClaimId: "CLAIM-1",
        externalEventId: "EVENT-1",
        claimType: "RETURN",
        source: "MARKET",
        requesterType: "CUSTOMER",
        faultType: "CUSTOMER",
        normalizedStatus: "REQUESTED",
        marketStatusRaw: "RETURN_REQUESTED",
        marketReasonCode: "CHANGE_MIND",
        rawMarketReason: "연락처 010-1234-5678로 전화해 주세요",
        deadlineAt: "2026-07-11T00:00:00.000Z",
        deadlineType: "PROVIDER_RESPONSE_DUE",
        resolutionType: null,
        resolutionStatus: "UNDECIDED",
        requestedAt: "2026-07-10T00:00:00.000Z",
        sourceUpdatedAt: "2026-07-10T00:01:00.000Z",
        lines: [{
            externalClaimLineId: "LINE-1",
            externalOrderItemId: "ITEM-1",
            requestedQuantity: 1,
            rawMarketReason: "P123456789012",
            resolutionType: null,
            resolutionStatus: "UNDECIDED",
        }],
        ...overrides,
    };
}

describe("claim inbound preparation", () => {
    it("encrypts free-text reasons and exposes only a protection marker", () => {
        const encryptedInputs: string[] = [];
        const prepared = prepareInboundClaimSnapshot(CONTEXT, snapshot(), (plaintext, context) => {
            encryptedInputs.push(`${context.secretType}:${plaintext}`);
            return `cipher:${context.secretType}`;
        });

        expect(encryptedInputs).toHaveLength(2);
        expect(prepared.marketReasonEncrypted).toMatch(/^cipher:CLAIM_REASON:/);
        expect(prepared.marketReasonMasked).toBe("[PROTECTED]");
        expect(prepared.lines[0].marketReasonEncrypted).toMatch(/^cipher:CLAIM_LINE_REASON:/);
        expect(JSON.stringify(prepared)).not.toContain("010-1234-5678");
        expect(JSON.stringify(prepared)).not.toContain("P123456789012");
    });

    it("derives stable claim, event, and line identities", () => {
        const encrypt = () => "cipher";
        const first = prepareInboundClaimSnapshot(CONTEXT, snapshot(), encrypt);
        const second = prepareInboundClaimSnapshot(CONTEXT, snapshot(), encrypt);
        expect(first.dedupeKey).toBe(second.dedupeKey);
        expect(first.eventKey).toBe(second.eventKey);
        expect(first.lines[0].lineKey).toBe(second.lines[0].lineKey);
        expect(first.dedupeKey).toMatch(/^[0-9a-f]{64}$/);
    });

    it("keeps provider payload identity stable across delivery correlation ids", () => {
        const first = prepareInboundClaimSnapshot(CONTEXT, snapshot(), () => "cipher");
        const second = prepareInboundClaimSnapshot({
            ...CONTEXT,
            correlationId: "00000000-0000-4000-8000-000000000099",
        }, snapshot(), () => "cipher");
        expect(second.payloadSha256).toBe(first.payloadSha256);
        expect(second.eventKey).toBe(first.eventKey);
    });

    it("keeps provider payload identity stable across internal raw snapshot references", () => {
        const first = prepareInboundClaimSnapshot(CONTEXT, snapshot({
            rawSnapshotRef: "raw/claims/attempt-1.json",
        }), () => "cipher");
        const second = prepareInboundClaimSnapshot(CONTEXT, snapshot({
            rawSnapshotRef: "raw/claims/attempt-2.json",
        }), () => "cipher");
        expect(second.payloadSha256).toBe(first.payloadSha256);
        expect(second.eventKey).toBe(first.eventKey);
    });

    it("treats claim lines as an order-independent provider snapshot set", () => {
        const firstLine = snapshot().lines[0];
        const secondLine = {
            ...firstLine,
            externalClaimLineId: "LINE-2",
            externalOrderItemId: "ITEM-2",
        };
        const first = prepareInboundClaimSnapshot(CONTEXT, snapshot({
            externalEventId: null,
            lines: [firstLine, secondLine],
        }), () => "cipher");
        const second = prepareInboundClaimSnapshot(CONTEXT, snapshot({
            externalEventId: null,
            lines: [secondLine, firstLine],
        }), () => "cipher");
        expect(second.payloadSha256).toBe(first.payloadSha256);
        expect(second.eventKey).toBe(first.eventKey);
    });

    it("rejects type-specific state and resolution conflicts", () => {
        expect(() => prepareInboundClaimSnapshot(CONTEXT, snapshot({
            claimType: "CANCEL",
            normalizedStatus: "COLLECTION_PENDING",
        }), () => "cipher")).toThrowError(expect.objectContaining({ code: "CLAIM_TYPE_STATUS_CONFLICT" }));

        expect(() => prepareInboundClaimSnapshot(CONTEXT, snapshot({
            claimType: "RETURN",
            resolutionType: "REPLACEMENT",
            resolutionStatus: "PENDING",
        }), () => "cipher")).toThrowError(expect.objectContaining({ code: "CLAIM_RESOLUTION_CONFLICT" }));
    });

    it("rejects duplicate order-item lines", () => {
        const base = snapshot();
        expect(() => prepareInboundClaimSnapshot(CONTEXT, {
            ...base,
            lines: [base.lines[0], { ...base.lines[0], externalClaimLineId: "LINE-2" }],
        }, () => "cipher")).toThrow();
    });

    it("rejects a future-dated provider snapshot before it can poison the watermark", () => {
        expect(() => prepareInboundClaimSnapshot(
            CONTEXT,
            snapshot({ sourceUpdatedAt: "2026-07-10T01:11:00.000Z" }),
            () => "cipher",
            new Date("2026-07-10T01:00:00.000Z"),
        )).toThrowError(expect.objectContaining({ code: "CLAIM_SOURCE_TIME_IN_FUTURE" }));
    });

    it("rejects terminal headers with active or unresolved lines", () => {
        expect(() => prepareInboundClaimSnapshot(CONTEXT, snapshot({
            normalizedStatus: "COMPLETED",
            resolutionType: "REFUND",
            resolutionStatus: "SUCCEEDED",
        }), () => "cipher")).toThrow();
    });
});
