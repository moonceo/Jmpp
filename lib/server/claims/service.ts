import { createHash } from "node:crypto";
import type { TransactionClient } from "@/lib/server/db";
import {
    isClaimStatusAllowedForType,
    isResolutionCoherent,
} from "@/lib/server/claims/domain";
import {
    inboundClaimContextSchema,
    inboundClaimSnapshotPayloadSchema,
    type InboundClaimContext,
    type InboundClaimSnapshotPayloadInput,
} from "@/lib/server/claims/schemas";
import type {
    InboundClaimUpsertResult,
    PreparedInboundClaimSnapshot,
} from "@/lib/server/claims/types";
import { persistInboundClaimSnapshot } from "@/lib/server/claims/repository";
import { ApiError } from "@/lib/server/http/api-error";
import {
    encryptCredential,
    type CredentialEncryptionContext,
} from "@/lib/server/security";

type ReasonEncryptor = (plaintext: string, context: CredentialEncryptionContext) => string;

function canonicalize(value: unknown): unknown {
    if (Array.isArray(value)) return value.map(canonicalize);
    if (typeof value !== "object" || value === null) return value;
    const record = value as Record<string, unknown>;
    return Object.fromEntries(Object.keys(record).sort()
        .filter((key) => record[key] !== undefined)
        .map((key) => [key, canonicalize(record[key])]));
}

function sha256(value: unknown): string {
    return createHash("sha256")
        .update(typeof value === "string" ? value : JSON.stringify(canonicalize(value)), "utf8")
        .digest("hex");
}

function protectedReason(
    reason: string | null,
    context: CredentialEncryptionContext,
    encrypt: ReasonEncryptor,
): { encrypted: string | null; masked: string | null } {
    return reason === null
        ? { encrypted: null, masked: null }
        : { encrypted: encrypt(reason, context), masked: "[PROTECTED]" };
}

function optionalDate(value: string | null): Date | null {
    return value === null ? null : new Date(value);
}

export function prepareInboundClaimSnapshot(
    context: InboundClaimContext,
    input: InboundClaimSnapshotPayloadInput,
    encrypt: ReasonEncryptor = encryptCredential,
    now = new Date(),
): PreparedInboundClaimSnapshot {
    const trustedContext = inboundClaimContextSchema.parse(context);
    const parsed = inboundClaimSnapshotPayloadSchema.parse(input);
    if (Date.parse(parsed.sourceUpdatedAt) > now.getTime() + 10 * 60 * 1_000) {
        throw new ApiError(422, "CLAIM_SOURCE_TIME_IN_FUTURE", "클레임 공급자 수정시각이 허용 범위를 벗어났습니다.");
    }
    if (!isClaimStatusAllowedForType(parsed.claimType, parsed.normalizedStatus)) {
        throw new ApiError(422, "CLAIM_TYPE_STATUS_CONFLICT", "클레임 유형에 맞지 않는 상태입니다.");
    }
    if (!isResolutionCoherent(parsed.claimType, parsed.resolutionType, parsed.resolutionStatus)) {
        throw new ApiError(422, "CLAIM_RESOLUTION_CONFLICT", "클레임 해결 유형과 상태가 일치하지 않습니다.");
    }

    const dedupeKey = sha256([
        "claim:v1", trustedContext.tenantId, trustedContext.marketAccountId, parsed.externalClaimId,
    ]);
    // Correlation IDs belong to the delivery attempt, not the provider event.
    // Excluding their value keeps retries of the same event idempotent while
    // still hashing every provider/domain field, including protected reasons.
    const identityLines = [...parsed.lines].sort((left, right) => (
        left.externalOrderItemId < right.externalOrderItemId ? -1
            : left.externalOrderItemId > right.externalOrderItemId ? 1
                : 0
    ));
    const providerPayload = { ...parsed };
    Reflect.deleteProperty(providerPayload, "rawSnapshotRef");
    const payloadSha256 = sha256({
        // The snapshot reference is assigned by our ingestion/storage path and
        // is intentionally absent from the provider-event identity.
        ...providerPayload,
        lines: identityLines,
    });
    const eventKey = sha256([
        "claim-event:v1",
        trustedContext.marketAccountId,
        parsed.externalEventId ?? `${parsed.externalClaimId}:${parsed.sourceUpdatedAt}:${payloadSha256}`,
    ]);
    const caseReason = protectedReason(parsed.rawMarketReason, {
        tenantId: trustedContext.tenantId,
        marketAccountId: trustedContext.marketAccountId,
        secretType: `CLAIM_REASON:${dedupeKey}`,
    }, encrypt);

    const lines = parsed.lines.map((line) => {
        const normalizedStatus = line.normalizedStatus ?? parsed.normalizedStatus;
        const resolutionType = line.resolutionType;
        const resolutionStatus = line.resolutionStatus;
        if (!isClaimStatusAllowedForType(parsed.claimType, normalizedStatus)) {
            throw new ApiError(422, "CLAIM_LINE_TYPE_STATUS_CONFLICT", "클레임 상품 상태가 유형과 맞지 않습니다.");
        }
        if (!isResolutionCoherent(parsed.claimType, resolutionType, resolutionStatus)) {
            throw new ApiError(422, "CLAIM_LINE_RESOLUTION_CONFLICT", "클레임 상품 해결 상태가 올바르지 않습니다.");
        }
        const lineKey = sha256([
            "claim-line:v1",
            dedupeKey,
            line.externalClaimLineId ?? line.externalOrderItemId,
        ]);
        const lineReason = protectedReason(line.rawMarketReason, {
            tenantId: trustedContext.tenantId,
            marketAccountId: trustedContext.marketAccountId,
            secretType: `CLAIM_LINE_REASON:${lineKey}`,
        }, encrypt);
        return {
            externalClaimLineId: line.externalClaimLineId,
            externalOrderItemId: line.externalOrderItemId,
            lineKey,
            requestedQuantity: line.requestedQuantity,
            normalizedStatus,
            marketStatusRaw: line.marketStatusRaw ?? parsed.marketStatusRaw,
            marketReasonCode: line.marketReasonCode,
            marketReasonEncrypted: lineReason.encrypted,
            marketReasonMasked: lineReason.masked,
            resolutionType,
            resolutionStatus,
            refundAmount: line.refundAmount,
            refundCurrency: line.refundCurrency,
        };
    });

    return {
        tenantId: trustedContext.tenantId,
        marketAccountId: trustedContext.marketAccountId,
        externalOrderId: parsed.externalOrderId,
        externalClaimId: parsed.externalClaimId,
        externalEventId: parsed.externalEventId,
        dedupeKey,
        eventKey,
        payloadSha256,
        correlationId: trustedContext.correlationId,
        claimType: parsed.claimType,
        source: parsed.source,
        requesterType: parsed.requesterType,
        faultType: parsed.faultType,
        normalizedStatus: parsed.normalizedStatus,
        marketStatusRaw: parsed.marketStatusRaw,
        marketReasonCode: parsed.marketReasonCode,
        marketReasonEncrypted: caseReason.encrypted,
        marketReasonMasked: caseReason.masked,
        providerProcessingId: parsed.providerProcessingId,
        providerErrorCode: parsed.providerErrorCode,
        rawSnapshotRef: parsed.rawSnapshotRef,
        deadlineAt: optionalDate(parsed.deadlineAt),
        deadlineType: parsed.deadlineType,
        resolutionType: parsed.resolutionType,
        resolutionStatus: parsed.resolutionStatus,
        requestedAt: new Date(parsed.requestedAt),
        reviewedAt: optionalDate(parsed.reviewedAt),
        approvedAt: optionalDate(parsed.approvedAt),
        rejectedAt: optionalDate(parsed.rejectedAt),
        collectionStartedAt: optionalDate(parsed.collectionStartedAt),
        receivedAt: optionalDate(parsed.receivedAt),
        resolvedAt: optionalDate(parsed.resolvedAt),
        completedAt: optionalDate(parsed.completedAt),
        sourceCreatedAt: optionalDate(parsed.sourceCreatedAt),
        sourceUpdatedAt: new Date(parsed.sourceUpdatedAt),
        lines,
    };
}

/** Worker-facing only. No browser/provider-write route calls this service. */
export async function upsertInboundClaimSnapshot(
    client: TransactionClient,
    context: InboundClaimContext,
    input: InboundClaimSnapshotPayloadInput,
    encrypt: ReasonEncryptor = encryptCredential,
): Promise<InboundClaimUpsertResult> {
    return persistInboundClaimSnapshot(client, prepareInboundClaimSnapshot(context, input, encrypt));
}
