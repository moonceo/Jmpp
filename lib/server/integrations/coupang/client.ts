import {
    failureResult,
    successResult,
    type FetchLike,
    type HttpTransport,
    type IntegrationFailure,
    type QueryValue,
    type TransportResult,
} from "@/lib/server/integrations/core";
import {
    buildCoupangCanonicalQuery,
    createCoupangSignedRequest,
    validateCoupangCredentials,
} from "@/lib/server/integrations/coupang/auth";
import { createCoupangReadTransport } from "@/lib/server/integrations/coupang/transport";
import {
    COUPANG_ORDER_STATUSES,
    type CoupangCredentials,
    type CoupangOrderItem,
    type CoupangOrderReadVerification,
    type CoupangOrderSheet,
    type CoupangOrderSheetDetail,
    type CoupangOrderSheetsByMinuteQuery,
    type CoupangOrderSheetsPage,
    type CoupangSignedRequest,
} from "@/lib/server/integrations/coupang/types";

export const COUPANG_API_BASE_URL = "https://api-gateway.coupang.com";
const MAX_MINUTE_QUERY_WINDOW_MS = 24 * 60 * 60 * 1_000;
const CONNECTION_VERIFICATION_LOOKBACK_MS = 5 * 60 * 1_000;
const ISO_DATE_TIME_WITH_ZONE =
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?:Z|[+-]\d{2}:\d{2})$/;

type CoupangSigner = (input: {
    credentials: CoupangCredentials;
    method: "GET";
    path: string;
    query: string;
    date: Date;
}) => CoupangSignedRequest;

export interface CoupangOpenApiClientOptions {
    credentials: CoupangCredentials;
    fetch?: FetchLike;
    transport?: HttpTransport;
    signer?: CoupangSigner;
    timeoutMs?: number;
    maxResponseBytes?: number;
    now?: () => Date;
}

interface CoupangEnvelope {
    code: number | string;
    message: string;
    data: unknown;
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

function validationFailure(message: string): IntegrationFailure {
    return failureResult({
        kind: "validation",
        code: "INVALID_COUPANG_REQUEST",
        message,
        retryable: false,
    });
}

function unexpectedResponse(
    message: string,
    raw: TransportResult<unknown> & { ok: true },
): IntegrationFailure {
    return failureResult({
        kind: "unexpected_response",
        code: "INVALID_COUPANG_RESPONSE",
        message,
        retryable: false,
    }, raw.raw);
}

function identifier(value: unknown): string | null {
    if (typeof value === "string" && /^\d+$/.test(value)) return value;
    if (typeof value === "number" && Number.isSafeInteger(value) && value >= 0) {
        return String(value);
    }
    return null;
}

function optionalIdentifier(value: unknown): string | undefined | null {
    if (value === undefined || value === null) return undefined;
    return identifier(value);
}

function normalizeOrderItem(value: unknown): CoupangOrderItem | null {
    if (!isRecord(value)) return null;
    const vendorItemId = identifier(value.vendorItemId);
    const vendorItemPackageId = optionalIdentifier(value.vendorItemPackageId);
    const productId = optionalIdentifier(value.productId);
    const sellerProductId = optionalIdentifier(value.sellerProductId);
    if (
        vendorItemId === null
        || vendorItemPackageId === null
        || productId === null
        || sellerProductId === null
        || typeof value.vendorItemName !== "string"
        || !Number.isSafeInteger(value.shippingCount)
        || (value.shippingCount as number) < 0
    ) {
        return null;
    }

    const remaining: Record<string, unknown> = { ...value };
    for (const field of [
        "vendorItemId",
        "vendorItemName",
        "shippingCount",
        "vendorItemPackageId",
        "productId",
        "sellerProductId",
        "sellerProductName",
        "sellerProductItemName",
        "externalVendorSkuCode",
    ]) {
        delete remaining[field];
    }

    return {
        ...remaining,
        vendorItemId,
        vendorItemName: value.vendorItemName,
        shippingCount: value.shippingCount as number,
        ...(vendorItemPackageId === undefined ? {} : { vendorItemPackageId }),
        ...(productId === undefined ? {} : { productId }),
        ...(sellerProductId === undefined ? {} : { sellerProductId }),
        ...(typeof value.sellerProductName === "string"
            ? { sellerProductName: value.sellerProductName }
            : {}),
        ...(typeof value.sellerProductItemName === "string"
            ? { sellerProductItemName: value.sellerProductItemName }
            : {}),
        ...(typeof value.externalVendorSkuCode === "string"
            ? { externalVendorSkuCode: value.externalVendorSkuCode }
            : {}),
    };
}

function normalizeOrderSheet(value: unknown): CoupangOrderSheet | null {
    if (!isRecord(value)) return null;
    const shipmentBoxId = identifier(value.shipmentBoxId);
    const orderId = identifier(value.orderId);
    const status = typeof value.status === "string" ? value.status : "";
    const orderItems = Array.isArray(value.orderItems)
        ? value.orderItems.map(normalizeOrderItem)
        : null;
    if (
        shipmentBoxId === null
        || orderId === null
        || typeof value.orderedAt !== "string"
        || Number.isNaN(Date.parse(value.orderedAt))
        || !COUPANG_ORDER_STATUSES.includes(status as never)
        || orderItems === null
        || orderItems.some((item) => item === null)
    ) {
        return null;
    }

    const remaining: Record<string, unknown> = { ...value };
    for (const field of [
        "shipmentBoxId",
        "orderId",
        "orderedAt",
        "paidAt",
        "status",
        "orderItems",
        "orderer",
        "receiver",
    ]) {
        delete remaining[field];
    }

    return {
        ...remaining,
        shipmentBoxId,
        orderId,
        orderedAt: value.orderedAt,
        status: status as CoupangOrderSheet["status"],
        orderItems: orderItems as CoupangOrderItem[],
        ...(typeof value.paidAt === "string" ? { paidAt: value.paidAt } : {}),
        ...(isRecord(value.orderer) ? { orderer: value.orderer } : {}),
        ...(isRecord(value.receiver) ? { receiver: value.receiver } : {}),
    };
}

function parseEnvelope(value: unknown): CoupangEnvelope | null {
    if (
        !isRecord(value)
        || (typeof value.code !== "number" && typeof value.code !== "string")
        || typeof value.message !== "string"
        || !("data" in value)
    ) {
        return null;
    }
    return { code: value.code, message: value.message, data: value.data };
}

function envelopeSucceeded(code: number | string): boolean {
    return code === 200 || code === "200" || code === "SUCCESS";
}

function validateMinuteQuery(
    query: CoupangOrderSheetsByMinuteQuery,
): IntegrationFailure | undefined {
    if (
        !ISO_DATE_TIME_WITH_ZONE.test(query.createdAtFrom)
        || !ISO_DATE_TIME_WITH_ZONE.test(query.createdAtTo)
    ) {
        return validationFailure(
            "createdAtFrom and createdAtTo must use ISO-8601 minute precision with an explicit timezone.",
        );
    }
    const from = Date.parse(query.createdAtFrom);
    const to = Date.parse(query.createdAtTo);
    if (!Number.isFinite(from) || !Number.isFinite(to) || to <= from) {
        return validationFailure("createdAtTo must be later than createdAtFrom.");
    }
    if (to - from > MAX_MINUTE_QUERY_WINDOW_MS) {
        return validationFailure("The minute order query window must not exceed 24 hours.");
    }
    if (!COUPANG_ORDER_STATUSES.includes(query.status)) {
        return validationFailure("status is not an official Coupang order-sheet status.");
    }
    return undefined;
}

function formatKoreaMinute(date: Date): string {
    const korea = new Date(date.getTime() + 9 * 60 * 60 * 1_000);
    return `${korea.toISOString().slice(0, 16)}+09:00`;
}

export class CoupangOpenApiClient {
    private readonly credentials: CoupangCredentials;
    private readonly credentialValidation: ReturnType<typeof validateCoupangCredentials>;
    private readonly baseUrl: string;
    private readonly transport: HttpTransport;
    private readonly signer: CoupangSigner;
    private readonly timeoutMs?: number;
    private readonly now: () => Date;

    constructor(options: CoupangOpenApiClientOptions) {
        if (options.fetch && options.transport) {
            throw new TypeError("fetch and transport cannot both be configured.");
        }
        this.credentials = options.credentials;
        this.credentialValidation = validateCoupangCredentials(options.credentials);
        this.baseUrl = COUPANG_API_BASE_URL;
        this.signer = options.signer ?? createCoupangSignedRequest;
        this.timeoutMs = options.timeoutMs;
        this.now = options.now ?? (() => new Date());
        this.transport = options.transport ?? createCoupangReadTransport({
            fetch: options.fetch,
            defaultTimeoutMs: options.timeoutMs,
            maxResponseBytes: options.maxResponseBytes,
            now: () => this.now().getTime(),
        });
    }

    async getOrderSheetsByMinute(
        query: CoupangOrderSheetsByMinuteQuery,
        options: { signal?: AbortSignal } = {},
    ): Promise<TransportResult<CoupangOrderSheetsPage>> {
        const invalid = validateMinuteQuery(query);
        if (invalid) return invalid;
        const response = await this.authorizedGet(
            `/v2/providers/openapi/apis/api/v5/vendors/${this.credentials.vendorId}/ordersheets`,
            {
                createdAtFrom: query.createdAtFrom,
                createdAtTo: query.createdAtTo,
                searchType: "timeFrame",
                status: query.status,
            },
            options.signal,
        );
        if (!response.ok) return response;

        const envelope = parseEnvelope(response.data);
        if (!envelope) {
            return unexpectedResponse("Coupang order list envelope is invalid.", response);
        }
        if (!envelopeSucceeded(envelope.code)) {
            return failureResult({
                kind: "remote_rejection",
                code: String(envelope.code),
                message: envelope.message || "Coupang rejected the order-list request.",
                retryable: false,
            }, response.raw);
        }
        if (!Array.isArray(envelope.data)) {
            return unexpectedResponse("Coupang order list data must be an array.", response);
        }
        const items = envelope.data.map(normalizeOrderSheet);
        if (items.some((item) => item === null)) {
            return unexpectedResponse(
                "Coupang order list contains an invalid order-sheet item.",
                response,
            );
        }
        return successResult({ items: items as CoupangOrderSheet[] }, response.raw);
    }

    async getOrderSheetByShipmentBoxId(
        shipmentBoxId: string,
        options: { signal?: AbortSignal } = {},
    ): Promise<TransportResult<CoupangOrderSheetDetail>> {
        if (!/^\d{1,18}$/.test(shipmentBoxId)) {
            return validationFailure("shipmentBoxId must contain 1 to 18 decimal digits.");
        }
        const response = await this.authorizedGet(
            `/v2/providers/openapi/apis/api/v5/vendors/${this.credentials.vendorId}`
                + `/ordersheets/${shipmentBoxId}`,
            {},
            options.signal,
        );
        if (!response.ok) return response;

        const envelope = parseEnvelope(response.data);
        if (!envelope) {
            return unexpectedResponse("Coupang order detail envelope is invalid.", response);
        }
        if (!envelopeSucceeded(envelope.code)) {
            return failureResult({
                kind: "remote_rejection",
                code: String(envelope.code),
                message: envelope.message || "Coupang rejected the order-detail request.",
                retryable: false,
            }, response.raw);
        }
        const item = normalizeOrderSheet(envelope.data);
        if (!item) {
            return unexpectedResponse("Coupang order detail data is invalid.", response);
        }
        return successResult({ item }, response.raw);
    }

    async verifyOrderReadAccess(): Promise<TransportResult<CoupangOrderReadVerification>> {
        const checkedAt = this.now();
        if (Number.isNaN(checkedAt.getTime())) {
            return validationFailure("The configured clock returned an invalid date.");
        }
        const end = new Date(Math.floor(checkedAt.getTime() / 60_000) * 60_000);
        const start = new Date(end.getTime() - CONNECTION_VERIFICATION_LOOKBACK_MS);
        const result = await this.getOrderSheetsByMinute({
            createdAtFrom: formatKoreaMinute(start),
            createdAtTo: formatKoreaMinute(end),
            status: "ACCEPT",
        });
        if (!result.ok) return result;

        const sampledOrderCount = result.data.items.length;
        return successResult({
            vendorId: this.credentials.vendorId,
            checkedAt: checkedAt.toISOString(),
            endpoint: "ORDER_SHEETS_BY_MINUTE",
            status: "ACCESS_VERIFIED",
            sampledOrderCount,
        }, {
            ...result.raw,
            body: {
                code: 200,
                message: "ORDER_READ_ACCESS_VERIFIED",
                sampledOrderCount,
                orderDataRedacted: true,
            },
            bodyText: "[Coupang order data redacted after access verification]",
        });
    }

    private async authorizedGet(
        path: string,
        query: Readonly<Record<string, QueryValue>>,
        signal?: AbortSignal,
    ): Promise<TransportResult<unknown>> {
        if (!this.credentialValidation.ok) {
            return failureResult({
                kind: "configuration",
                code: "INVALID_COUPANG_CREDENTIALS",
                message: `Invalid Coupang credential fields: ${this.credentialValidation.invalidFields.join(", ")}.`,
                retryable: false,
            });
        }

        const canonicalQuery = buildCoupangCanonicalQuery(query);
        let signed: CoupangSignedRequest;
        try {
            signed = this.signer({
                credentials: this.credentialValidation.credentials,
                method: "GET",
                path,
                query: canonicalQuery,
                date: this.now(),
            });
        } catch {
            return failureResult({
                kind: "configuration",
                code: "COUPANG_SIGNATURE_FAILED",
                message: "Coupang request signature could not be generated.",
                retryable: false,
            });
        }

        const url = new URL(path, this.baseUrl);
        url.search = canonicalQuery;
        return this.transport.request<unknown>({
            method: "GET",
            url,
            headers: {
                accept: "application/json",
                authorization: signed.authorization,
            },
            timeoutMs: this.timeoutMs,
            signal,
        });
    }
}
