import {
    CLAIM_PROVIDER_ACTIONS,
    type ClaimActionAvailabilityMap,
    type ClaimResolutionStatus,
    type ClaimResolutionType,
    type ClaimStatus,
    type ClaimType,
} from "@/lib/server/claims/types";

const TERMINAL_STATUSES = new Set<ClaimStatus>(["REJECTED", "WITHDRAWN", "COMPLETED"]);

const transitions: Record<ClaimStatus, ReadonlySet<ClaimStatus>> = {
    REQUESTED: new Set([
        "UNDER_REVIEW", "APPROVAL_PENDING", "APPROVED", "REJECTED", "ON_HOLD",
        "COLLECTION_PENDING", "IN_TRANSIT", "RECEIVED", "REFUND_PENDING", "REFUNDED",
        "REPLACEMENT_PENDING", "REPLACEMENT_SHIPPED", "WITHDRAWN", "COMPLETED",
    ]),
    UNDER_REVIEW: new Set([
        "APPROVAL_PENDING", "APPROVED", "REJECTED", "ON_HOLD", "COLLECTION_PENDING",
        "IN_TRANSIT", "RECEIVED", "REFUND_PENDING", "REFUNDED", "REPLACEMENT_PENDING",
        "REPLACEMENT_SHIPPED", "WITHDRAWN", "COMPLETED",
    ]),
    APPROVAL_PENDING: new Set([
        "APPROVED", "REJECTED", "ON_HOLD", "COLLECTION_PENDING", "IN_TRANSIT",
        "RECEIVED", "REFUND_PENDING", "REFUNDED", "REPLACEMENT_PENDING",
        "REPLACEMENT_SHIPPED", "WITHDRAWN", "COMPLETED",
    ]),
    APPROVED: new Set([
        "COLLECTION_PENDING", "IN_TRANSIT", "RECEIVED", "REFUND_PENDING", "REFUNDED",
        "REPLACEMENT_PENDING", "REPLACEMENT_SHIPPED", "ON_HOLD", "WITHDRAWN", "COMPLETED",
    ]),
    REJECTED: new Set(),
    ON_HOLD: new Set([
        "UNDER_REVIEW", "APPROVAL_PENDING", "APPROVED", "REJECTED",
        "COLLECTION_PENDING", "IN_TRANSIT", "RECEIVED", "REFUND_PENDING",
        "REFUNDED", "REPLACEMENT_PENDING", "REPLACEMENT_SHIPPED", "WITHDRAWN", "COMPLETED",
    ]),
    COLLECTION_PENDING: new Set([
        "IN_TRANSIT", "RECEIVED", "REFUND_PENDING", "REPLACEMENT_PENDING",
        "ON_HOLD", "WITHDRAWN", "COMPLETED",
    ]),
    IN_TRANSIT: new Set([
        "RECEIVED", "REFUND_PENDING", "REPLACEMENT_PENDING", "ON_HOLD", "COMPLETED",
    ]),
    RECEIVED: new Set([
        "REFUND_PENDING", "REFUNDED", "REPLACEMENT_PENDING", "REPLACEMENT_SHIPPED",
        "ON_HOLD", "COMPLETED",
    ]),
    REFUND_PENDING: new Set(["REFUNDED", "ON_HOLD", "COMPLETED"]),
    REFUNDED: new Set(["COMPLETED"]),
    REPLACEMENT_PENDING: new Set(["REPLACEMENT_SHIPPED", "ON_HOLD", "COMPLETED"]),
    REPLACEMENT_SHIPPED: new Set(["COMPLETED"]),
    WITHDRAWN: new Set(),
    COMPLETED: new Set(),
};

export function isTerminalClaimStatus(status: ClaimStatus): boolean {
    return TERMINAL_STATUSES.has(status);
}

export function isClaimStatusAllowedForType(type: ClaimType, status: ClaimStatus): boolean {
    if (type === "CANCEL" && new Set<ClaimStatus>([
        "COLLECTION_PENDING", "IN_TRANSIT", "RECEIVED",
        "REPLACEMENT_PENDING", "REPLACEMENT_SHIPPED",
    ]).has(status)) return false;
    if (type === "RETURN" && (status === "REPLACEMENT_PENDING" || status === "REPLACEMENT_SHIPPED")) {
        return false;
    }
    return true;
}

export function isClaimStatusTransitionAllowed(
    type: ClaimType,
    previous: ClaimStatus,
    next: ClaimStatus,
): boolean {
    return isClaimStatusAllowedForType(type, next)
        && (previous === next || transitions[previous].has(next));
}

export function isResolutionCoherent(
    type: ClaimType,
    resolutionType: ClaimResolutionType | null,
    resolutionStatus: ClaimResolutionStatus,
): boolean {
    if (resolutionType === null) return resolutionStatus === "UNDECIDED";
    if (resolutionStatus === "UNDECIDED") return false;
    return resolutionType !== "REPLACEMENT" || type === "EXCHANGE";
}

export function unavailableClaimActions(): ClaimActionAvailabilityMap {
    return Object.fromEntries(CLAIM_PROVIDER_ACTIONS.map((action) => [action, {
        available: false as const,
        execution: "UNAVAILABLE" as const,
        reason: "CLAIM_PROVIDER_WRITES_NOT_IMPLEMENTED" as const,
    }])) as ClaimActionAvailabilityMap;
}
