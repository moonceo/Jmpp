import { z } from "zod";
import {
    CLAIM_FAULT_TYPES,
    CLAIM_REQUESTERS,
    CLAIM_RESOLUTION_STATUSES,
    CLAIM_RESOLUTION_TYPES,
    CLAIM_SOURCES,
    CLAIM_STATUSES,
    CLAIM_TYPES,
} from "@/lib/server/claims/types";

const safeOpaque = (maximum: number) => z.string().trim().min(1).max(maximum)
    .refine((value) => !/[\u0000-\u001f\u007f]/.test(value), "Control characters are not allowed.");
const safeCode = z.string().trim().min(1).max(200).regex(/^[A-Za-z0-9_.:\-]+$/);
const timestamp = z.iso.datetime({ offset: true });
const nullableTimestamp = timestamp.nullish().transform((value) => value ?? null);

const resolutionFields = {
    resolutionType: z.enum(CLAIM_RESOLUTION_TYPES).nullish().transform((value) => value ?? null),
    resolutionStatus: z.enum(CLAIM_RESOLUTION_STATUSES).default("UNDECIDED"),
};

const inboundLineSchema = z.object({
    externalClaimLineId: safeOpaque(500).nullish().transform((value) => value ?? null),
    externalOrderItemId: safeOpaque(500),
    requestedQuantity: z.number().int().positive().max(2_147_483_647),
    normalizedStatus: z.enum(CLAIM_STATUSES).optional(),
    marketStatusRaw: safeOpaque(300).optional(),
    marketReasonCode: safeCode.nullish().transform((value) => value ?? null),
    rawMarketReason: safeOpaque(4_000).nullish().transform((value) => value ?? null),
    ...resolutionFields,
    refundAmount: z.string().regex(/^\d{1,16}(?:\.\d{1,2})?$/).nullish().transform((value) => value ?? null),
    refundCurrency: z.string().regex(/^[A-Z]{3}$/).nullish().transform((value) => value ?? null),
}).strict().superRefine((value, context) => {
    if ((value.refundAmount === null) !== (value.refundCurrency === null)) {
        context.addIssue({ code: "custom", path: ["refundAmount"], message: "Refund amount and currency must be provided together." });
    }
    if (value.refundAmount !== null && value.resolutionType !== "REFUND") {
        context.addIssue({ code: "custom", path: ["resolutionType"], message: "Refund amounts require REFUND resolution." });
    }
});

export const inboundClaimContextSchema = z.object({
    tenantId: z.uuid(),
    marketAccountId: z.uuid(),
    correlationId: z.uuid(),
}).strict();

export const inboundClaimSnapshotPayloadSchema = z.object({
    externalOrderId: safeOpaque(500),
    externalClaimId: safeOpaque(500),
    externalEventId: safeOpaque(500).nullish().transform((value) => value ?? null),
    claimType: z.enum(CLAIM_TYPES),
    source: z.enum(CLAIM_SOURCES),
    requesterType: z.enum(CLAIM_REQUESTERS),
    faultType: z.enum(CLAIM_FAULT_TYPES).default("UNKNOWN"),
    normalizedStatus: z.enum(CLAIM_STATUSES),
    marketStatusRaw: safeOpaque(300),
    marketReasonCode: safeCode.nullish().transform((value) => value ?? null),
    rawMarketReason: safeOpaque(4_000).nullish().transform((value) => value ?? null),
    providerProcessingId: safeOpaque(500).nullish().transform((value) => value ?? null),
    providerErrorCode: safeCode.nullish().transform((value) => value ?? null),
    rawSnapshotRef: safeOpaque(1_000).nullish().transform((value) => value ?? null),
    deadlineAt: nullableTimestamp,
    deadlineType: safeCode.nullish().transform((value) => value ?? null),
    ...resolutionFields,
    requestedAt: timestamp,
    reviewedAt: nullableTimestamp,
    approvedAt: nullableTimestamp,
    rejectedAt: nullableTimestamp,
    collectionStartedAt: nullableTimestamp,
    receivedAt: nullableTimestamp,
    resolvedAt: nullableTimestamp,
    completedAt: nullableTimestamp,
    sourceCreatedAt: nullableTimestamp,
    sourceUpdatedAt: timestamp,
    lines: z.array(inboundLineSchema).min(1).max(100),
}).strict().superRefine((value, context) => {
    if ((value.deadlineAt === null) !== (value.deadlineType === null)) {
        context.addIssue({ code: "custom", path: ["deadlineAt"], message: "Deadline time and type must be provided together." });
    }
    if (value.sourceCreatedAt && Date.parse(value.sourceUpdatedAt) < Date.parse(value.sourceCreatedAt)) {
        context.addIssue({ code: "custom", path: ["sourceUpdatedAt"], message: "Source update time cannot precede creation." });
    }
    const itemIds = value.lines.map((line) => line.externalOrderItemId);
    if (new Set(itemIds).size !== itemIds.length) {
        context.addIssue({ code: "custom", path: ["lines"], message: "A claim may contain only one line per order item." });
    }
    const externalLineIds = value.lines.flatMap((line) => line.externalClaimLineId ? [line.externalClaimLineId] : []);
    if (new Set(externalLineIds).size !== externalLineIds.length) {
        context.addIssue({ code: "custom", path: ["lines"], message: "External claim line IDs must be unique." });
    }
    if (["REJECTED", "WITHDRAWN", "COMPLETED"].includes(value.normalizedStatus)) {
        const nonTerminalLine = value.lines.find((line) => !["REJECTED", "WITHDRAWN", "COMPLETED"].includes(
            line.normalizedStatus ?? value.normalizedStatus,
        ));
        if (nonTerminalLine) {
            context.addIssue({
                code: "custom",
                path: ["lines"],
                message: "A terminal claim cannot contain an active claim line.",
            });
        }
        if (!["SUCCEEDED", "NOT_REQUIRED"].includes(value.resolutionStatus)) {
            context.addIssue({
                code: "custom",
                path: ["resolutionStatus"],
                message: "A terminal claim must have a terminal resolution.",
            });
        }
        const unresolvedLine = value.lines.find((line) => !["SUCCEEDED", "NOT_REQUIRED"].includes(
            line.resolutionStatus,
        ));
        if (unresolvedLine) {
            context.addIssue({
                code: "custom",
                path: ["lines"],
                message: "A terminal claim cannot contain an unresolved claim line.",
            });
        }
    }
});

export type InboundClaimContext = z.input<typeof inboundClaimContextSchema>;
export type InboundClaimSnapshotPayloadInput = z.input<typeof inboundClaimSnapshotPayloadSchema>;
export type ParsedInboundClaimSnapshotPayload = z.output<typeof inboundClaimSnapshotPayloadSchema>;
