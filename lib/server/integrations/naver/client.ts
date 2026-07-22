import {
    createFetchTransport,
    failureResult,
    partialResult,
    successResult,
    type FetchLike,
    type HttpTransport,
    type IntegrationFailure,
    type IntegrationIssue,
    type IntegrationResult,
    type TransportRequest,
    type TransportResult,
} from "../core";
import {
    NAVER_COMMERCE_API_BASE_URL,
    NaverTokenProvider,
} from "./auth";
import { NAVER_COMMERCE_CAPABILITIES } from "./capabilities";
import type {
    NaverBatchFailure,
    NaverBatchOperationResult,
    NaverChangedProductOrder,
    NaverChangedProductOrdersCursor,
    NaverChangedProductOrdersPage,
    NaverChangedProductOrdersQuery,
    NaverClientSecretSigner,
    NaverCommerceCredentials,
    NaverDispatchProductOrder,
    NaverProductOrderDetail,
    NaverProductOrderDetailOptions,
    NaverProductOrderDetails,
    NaverSellerCancelRequest,
} from "./types";
import { NAVER_SELLER_CANCEL_REASONS } from "./types";

export const NAVER_CHANGED_ORDERS_MAX_PAGE_SIZE = 300;
export const NAVER_PRODUCT_ORDER_DETAIL_MAX_BATCH_SIZE = 300;
export const NAVER_CONFIRM_MAX_BATCH_SIZE = 30;
export const NAVER_DISPATCH_MAX_BATCH_SIZE = 30;

interface NaverConfirmResponseData {
    successProductOrderInfos?: unknown;
    failProductOrderInfos?: unknown;
}

interface NaverDispatchResponseData {
    successProductOrderIds?: unknown;
    failProductOrderInfos?: unknown;
}

interface NaverClaimOperationResponseData {
    successProductOrderIds?: unknown;
    failProductOrderInfos?: unknown;
}

export interface NaverCommerceClientOptions {
    credentials: NaverCommerceCredentials;
    signer?: NaverClientSecretSigner;
    fetch?: FetchLike;
    transport?: HttpTransport;
    baseUrl?: string;
    timeoutMs?: number;
    now?: () => number;
    tokenCacheSkewMs?: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
    return typeof value === "string" && value.trim().length > 0;
}

function isDateTime(value: string): boolean {
    return isNonEmptyString(value) && !Number.isNaN(Date.parse(value));
}

function apiUrl(baseUrl: string, path: string): string {
    return `${baseUrl.replace(/\/+$/, "")}/${path.replace(/^\/+/, "")}`;
}

function validationFailure(message: string, details?: unknown): IntegrationFailure {
    return failureResult({
        kind: "validation",
        code: "INVALID_NAVER_REQUEST",
        message,
        retryable: false,
        ...(details === undefined ? {} : { details }),
    });
}

function validateIds(
    productOrderIds: readonly string[],
    maximum: number,
): IntegrationFailure | undefined {
    if (productOrderIds.length === 0) {
        return validationFailure("상품 주문 번호를 1개 이상 입력해야 합니다.");
    }
    if (productOrderIds.length > maximum) {
        return validationFailure(
            `한 요청의 상품 주문 번호는 최대 ${maximum}개입니다.`,
            { count: productOrderIds.length, maximum },
        );
    }
    if (productOrderIds.some((id) => !isNonEmptyString(id))) {
        return validationFailure("빈 상품 주문 번호를 입력할 수 없습니다.");
    }
    if (new Set(productOrderIds).size !== productOrderIds.length) {
        return validationFailure("상품 주문 번호를 중복 입력할 수 없습니다.");
    }
    return undefined;
}

function remoteCode(body: unknown): string | undefined {
    if (!isRecord(body)) return undefined;
    return typeof body.code === "string" ? body.code : undefined;
}

function isExpiredTokenResponse(result: TransportResult<unknown>): boolean {
    return (
        result.outcome === "failure" &&
        result.raw?.status === 401 &&
        remoteCode(result.raw.body) === "GW.AUTHN"
    );
}

function isChangedProductOrder(value: unknown): value is NaverChangedProductOrder {
    return (
        isRecord(value) &&
        isNonEmptyString(value.productOrderStatus) &&
        isNonEmptyString(value.productOrderId) &&
        isNonEmptyString(value.orderId) &&
        isNonEmptyString(value.lastChangedDate) &&
        isNonEmptyString(value.lastChangedType)
    );
}

function parseCursor(value: unknown): NaverChangedProductOrdersCursor | null | undefined {
    if (value === undefined || value === null) return null;
    if (
        !isRecord(value) ||
        !isNonEmptyString(value.moreFrom) ||
        !isNonEmptyString(value.moreSequence)
    ) {
        return undefined;
    }
    return {
        lastChangedFrom: value.moreFrom,
        moreSequence: value.moreSequence,
    };
}

function parseBatchFailures(value: unknown): NaverBatchFailure[] | undefined {
    if (value === undefined) return [];
    if (!Array.isArray(value)) return undefined;

    const failures: NaverBatchFailure[] = [];
    for (const item of value) {
        if (!isRecord(item) || !isNonEmptyString(item.productOrderId)) {
            return undefined;
        }
        failures.push({
            productOrderId: item.productOrderId,
            ...(typeof item.code === "string" ? { code: item.code } : {}),
            ...(typeof item.message === "string" ? { message: item.message } : {}),
            retryable: false,
        });
    }
    return failures;
}

function missingBatchResults(
    requestedIds: readonly string[],
    succeededIds: readonly string[],
    failedItems: readonly NaverBatchFailure[],
): NaverBatchFailure[] {
    const responded = new Set([
        ...succeededIds,
        ...failedItems.map((item) => item.productOrderId),
    ]);

    return requestedIds
        .filter((id) => !responded.has(id))
        .map((productOrderId) => ({
            productOrderId,
            code: "MISSING_ITEM_RESULT",
            message: "네이버 응답에 해당 상품 주문의 처리 결과가 없습니다.",
            retryable: true,
        }));
}

function batchOutcome(
    requestedIds: readonly string[],
    succeededIds: readonly string[],
    remoteFailures: readonly NaverBatchFailure[],
    raw: TransportResult<unknown> & { ok: true },
): IntegrationResult<NaverBatchOperationResult> {
    const failures = [
        ...remoteFailures,
        ...missingBatchResults(requestedIds, succeededIds, remoteFailures),
    ];
    const data: NaverBatchOperationResult = {
        succeededProductOrderIds: [...new Set(succeededIds)],
        failedProductOrders: failures,
    };

    if (failures.length === 0) {
        return successResult(data, raw.raw);
    }

    if (data.succeededProductOrderIds.length === 0) {
        return failureResult(
            {
                kind: "remote_rejection",
                code: "NAVER_BATCH_REJECTED",
                message: "네이버가 요청한 모든 상품 주문 처리를 거부했습니다.",
                retryable: failures.some((failure) => failure.retryable),
                details: data,
            },
            raw.raw,
        );
    }

    const issues: IntegrationIssue[] = failures.map((failure) => ({
        kind: "remote_item_failure",
        externalId: failure.productOrderId,
        ...(failure.code === undefined ? {} : { code: failure.code }),
        message: failure.message ?? "상품 주문 처리에 실패했습니다.",
        retryable: failure.retryable,
        details: failure,
    }));
    return partialResult(data, issues, raw.raw);
}

export class NaverCommerceClient {
    static readonly capabilities = NAVER_COMMERCE_CAPABILITIES;

    readonly capabilities = NAVER_COMMERCE_CAPABILITIES;

    private readonly baseUrl: string;
    private readonly transport: HttpTransport;
    private readonly tokenProvider: NaverTokenProvider;

    constructor(options: NaverCommerceClientOptions) {
        if (options.fetch && options.transport) {
            throw new TypeError("fetch와 transport는 동시에 지정할 수 없습니다.");
        }

        this.baseUrl = options.baseUrl ?? NAVER_COMMERCE_API_BASE_URL;
        this.transport =
            options.transport ??
            createFetchTransport({
                fetch: options.fetch,
                defaultTimeoutMs: options.timeoutMs,
                now: options.now,
            });
        this.tokenProvider = new NaverTokenProvider({
            credentials: options.credentials,
            transport: this.transport,
            signer: options.signer,
            baseUrl: this.baseUrl,
            now: options.now,
            cacheSkewMs: options.tokenCacheSkewMs,
        });
    }

    clearTokenCache(): void {
        this.tokenProvider.invalidate();
    }

    async getChangedProductOrders(
        query: NaverChangedProductOrdersQuery,
    ): Promise<IntegrationResult<NaverChangedProductOrdersPage>> {
        const lastChangedFrom = query.cursor?.lastChangedFrom ?? query.lastChangedFrom;
        if (!isDateTime(lastChangedFrom)) {
            return validationFailure("lastChangedFrom은 유효한 date-time이어야 합니다.");
        }
        if (query.lastChangedTo !== undefined && !isDateTime(query.lastChangedTo)) {
            return validationFailure("lastChangedTo는 유효한 date-time이어야 합니다.");
        }
        if (
            query.lastChangedTo !== undefined &&
            Date.parse(query.lastChangedTo) < Date.parse(lastChangedFrom)
        ) {
            return validationFailure("lastChangedTo는 lastChangedFrom보다 빠를 수 없습니다.");
        }
        if (
            query.limitCount !== undefined &&
            (!Number.isInteger(query.limitCount) ||
                query.limitCount < 1 ||
                query.limitCount > NAVER_CHANGED_ORDERS_MAX_PAGE_SIZE)
        ) {
            return validationFailure(
                `limitCount는 1~${NAVER_CHANGED_ORDERS_MAX_PAGE_SIZE} 사이의 정수여야 합니다.`,
            );
        }
        if (
            query.cursor &&
            (!isDateTime(query.cursor.lastChangedFrom) ||
                !isNonEmptyString(query.cursor.moreSequence))
        ) {
            return validationFailure("cursor의 값이 올바르지 않습니다.");
        }

        const response = await this.authorizedRequest<unknown>({
            method: "GET",
            url: apiUrl(
                this.baseUrl,
                "/v1/pay-order/seller/product-orders/last-changed-statuses",
            ),
            query: {
                lastChangedFrom,
                lastChangedTo: query.lastChangedTo,
                lastChangedType: query.lastChangedType,
                moreSequence: query.cursor?.moreSequence,
                limitCount: query.limitCount,
            },
        });
        if (!response.ok) return response;

        const envelope = response.data;
        const data = isRecord(envelope) && isRecord(envelope.data)
            ? envelope.data
            : undefined;
        const items = data?.lastChangeStatuses;
        const count = data?.count;
        const cursor = parseCursor(data?.more);

        if (
            !Array.isArray(items) ||
            !items.every(isChangedProductOrder) ||
            typeof count !== "number" ||
            !Number.isInteger(count) ||
            count < 0 ||
            cursor === undefined
        ) {
            return failureResult(
                {
                    kind: "unexpected_response",
                    code: "INVALID_NAVER_CHANGED_ORDERS_RESPONSE",
                    message: "변경 상품 주문 응답 형식이 올바르지 않습니다.",
                    retryable: false,
                    details: envelope,
                },
                response.raw,
            );
        }

        return successResult(
            {
                items,
                count,
                cursor,
                hasMore: cursor !== null,
            },
            response.raw,
        );
    }

    async getProductOrderDetails(
        productOrderIds: readonly string[],
        options: NaverProductOrderDetailOptions = {},
    ): Promise<IntegrationResult<NaverProductOrderDetails>> {
        const invalid = validateIds(
            productOrderIds,
            NAVER_PRODUCT_ORDER_DETAIL_MAX_BATCH_SIZE,
        );
        if (invalid) return invalid;

        const response = await this.authorizedRequest<unknown, object>({
            method: "POST",
            url: apiUrl(
                this.baseUrl,
                "/v1/pay-order/seller/product-orders/query",
            ),
            body: {
                productOrderIds,
                ...(options.quantityClaimCompatibility === undefined
                    ? {}
                    : {
                        quantityClaimCompatibility:
                            options.quantityClaimCompatibility,
                    }),
            },
        });
        if (!response.ok) return response;

        const envelope = response.data;
        const items = isRecord(envelope) ? envelope.data : undefined;
        if (
            !Array.isArray(items) ||
            !items.every(
                (item) =>
                    isRecord(item) &&
                    isRecord(item.order) &&
                    isRecord(item.productOrder),
            )
        ) {
            return failureResult(
                {
                    kind: "unexpected_response",
                    code: "INVALID_NAVER_PRODUCT_ORDER_RESPONSE",
                    message: "상품 주문 상세 응답 형식이 올바르지 않습니다.",
                    retryable: false,
                    details: envelope,
                },
                response.raw,
            );
        }

        return successResult(
            { items: items as NaverProductOrderDetail[] },
            response.raw,
        );
    }

    async confirmProductOrders(
        productOrderIds: readonly string[],
    ): Promise<IntegrationResult<NaverBatchOperationResult>> {
        const invalid = validateIds(productOrderIds, NAVER_CONFIRM_MAX_BATCH_SIZE);
        if (invalid) return invalid;

        const response = await this.authorizedRequest<unknown, object>({
            method: "POST",
            url: apiUrl(
                this.baseUrl,
                "/v1/pay-order/seller/product-orders/confirm",
            ),
            body: { productOrderIds },
        });
        if (!response.ok) return response;

        const envelope = response.data;
        const data = isRecord(envelope) && isRecord(envelope.data)
            ? (envelope.data as NaverConfirmResponseData)
            : undefined;
        const successItems = data?.successProductOrderInfos ?? [];
        const failures = parseBatchFailures(data?.failProductOrderInfos);
        if (
            data === undefined ||
            (data.successProductOrderInfos === undefined &&
                data.failProductOrderInfos === undefined) ||
            !Array.isArray(successItems) ||
            !successItems.every(
                (item) => isRecord(item) && isNonEmptyString(item.productOrderId),
            ) ||
            failures === undefined
        ) {
            return failureResult(
                {
                    kind: "unexpected_response",
                    code: "INVALID_NAVER_CONFIRM_RESPONSE",
                    message: "발주 확인 응답 형식이 올바르지 않습니다.",
                    retryable: false,
                    details: envelope,
                },
                response.raw,
            );
        }

        const succeededIds = successItems.map(
            (item) => (item as Record<string, unknown>).productOrderId as string,
        );
        return batchOutcome(productOrderIds, succeededIds, failures, response);
    }

    async dispatchProductOrders(
        dispatchProductOrders: readonly NaverDispatchProductOrder[],
    ): Promise<IntegrationResult<NaverBatchOperationResult>> {
        const productOrderIds = dispatchProductOrders.map(
            (item) => item.productOrderId,
        );
        const invalid = validateIds(productOrderIds, NAVER_DISPATCH_MAX_BATCH_SIZE);
        if (invalid) return invalid;

        for (const item of dispatchProductOrders) {
            if (!isDateTime(item.dispatchDate)) {
                return validationFailure(
                    "dispatchDate는 유효한 date-time이어야 합니다.",
                    { productOrderId: item.productOrderId },
                );
            }
            if (
                item.deliveryMethod === "DELIVERY" &&
                (!isNonEmptyString(item.deliveryCompanyCode) ||
                    !isNonEmptyString(item.trackingNumber))
            ) {
                return validationFailure(
                    "DELIVERY 발송에는 택배사 코드와 송장번호가 필요합니다.",
                    { productOrderId: item.productOrderId },
                );
            }
        }

        const response = await this.authorizedRequest<unknown, object>({
            method: "POST",
            url: apiUrl(
                this.baseUrl,
                "/v1/pay-order/seller/product-orders/dispatch",
            ),
            body: { dispatchProductOrders },
        });
        if (!response.ok) return response;

        const envelope = response.data;
        const data = isRecord(envelope) && isRecord(envelope.data)
            ? (envelope.data as NaverDispatchResponseData)
            : undefined;
        const succeededIds = data?.successProductOrderIds ?? [];
        const failures = parseBatchFailures(data?.failProductOrderInfos);
        if (
            data === undefined ||
            (data.successProductOrderIds === undefined &&
                data.failProductOrderInfos === undefined) ||
            !Array.isArray(succeededIds) ||
            !succeededIds.every(isNonEmptyString) ||
            failures === undefined
        ) {
            return failureResult(
                {
                    kind: "unexpected_response",
                    code: "INVALID_NAVER_DISPATCH_RESPONSE",
                    message: "발송 처리 응답 형식이 올바르지 않습니다.",
                    retryable: false,
                    details: envelope,
                },
                response.raw,
            );
        }

        return batchOutcome(productOrderIds, succeededIds, failures, response);
    }

    async requestCancelProductOrder(
        productOrderId: string,
        request: NaverSellerCancelRequest,
    ): Promise<IntegrationResult<NaverBatchOperationResult>> {
        const invalidId = validateIds([productOrderId], 1);
        if (invalidId) return invalidId;
        if (!NAVER_SELLER_CANCEL_REASONS.includes(request.cancelReason)) {
            return validationFailure("cancelReason is not supported by Naver Commerce API.");
        }
        if (
            request.cancelDetailedReason !== undefined
            && (
                !isNonEmptyString(request.cancelDetailedReason)
                || request.cancelDetailedReason.length > 500
                || /[\u0000-\u001f\u007f]/.test(request.cancelDetailedReason)
            )
        ) {
            return validationFailure("cancelDetailedReason must be 1 to 500 characters without control characters.");
        }
        if (
            request.cancelQuantity !== undefined
            && (!Number.isSafeInteger(request.cancelQuantity) || request.cancelQuantity <= 0)
        ) {
            return validationFailure("cancelQuantity must be a positive safe integer.");
        }

        const response = await this.authorizedRequest<unknown, NaverSellerCancelRequest>({
            method: "POST",
            url: apiUrl(
                this.baseUrl,
                `/v1/pay-order/seller/product-orders/${encodeURIComponent(productOrderId)}/claim/cancel/request`,
            ),
            body: request,
        });
        if (!response.ok) return response;

        const envelope = response.data;
        const data = isRecord(envelope) && isRecord(envelope.data)
            ? (envelope.data as NaverClaimOperationResponseData)
            : undefined;
        const succeededIds = data?.successProductOrderIds ?? [];
        const failures = parseBatchFailures(data?.failProductOrderInfos);
        if (
            data === undefined
            || (
                data.successProductOrderIds === undefined
                && data.failProductOrderInfos === undefined
            )
            || !Array.isArray(succeededIds)
            || !succeededIds.every(isNonEmptyString)
            || failures === undefined
        ) {
            return failureResult(
                {
                    kind: "unexpected_response",
                    code: "INVALID_NAVER_SELLER_CANCEL_RESPONSE",
                    message: "The Naver seller-cancel response shape is invalid.",
                    retryable: false,
                    details: envelope,
                },
                response.raw,
            );
        }

        return batchOutcome([productOrderId], succeededIds, failures, response);
    }

    private async authorizedRequest<TResponse, TBody = unknown>(
        request: TransportRequest<TBody>,
    ): Promise<TransportResult<TResponse>> {
        const firstToken = await this.tokenProvider.getAccessToken();
        if (firstToken.outcome === "failure") return firstToken;
        if (firstToken.outcome === "partial") {
            return failureResult(
                {
                    kind: "unexpected_response",
                    code: "PARTIAL_TOKEN_RESULT",
                    message: "토큰 발급이 부분 성공으로 반환되었습니다.",
                    retryable: false,
                },
                firstToken.raw,
            );
        }

        let response = await this.requestWithToken<TResponse, TBody>(
            request,
            firstToken.data.accessToken,
            firstToken.data.tokenType,
        );
        if (!isExpiredTokenResponse(response)) {
            return response;
        }

        this.tokenProvider.invalidate();
        const refreshedToken = await this.tokenProvider.getAccessToken({
            forceRefresh: true,
        });
        if (refreshedToken.outcome === "failure") return refreshedToken;
        if (refreshedToken.outcome === "partial") {
            return failureResult(
                {
                    kind: "unexpected_response",
                    code: "PARTIAL_TOKEN_RESULT",
                    message: "토큰 재발급이 부분 성공으로 반환되었습니다.",
                    retryable: false,
                },
                refreshedToken.raw,
            );
        }

        response = await this.requestWithToken<TResponse, TBody>(
            request,
            refreshedToken.data.accessToken,
            refreshedToken.data.tokenType,
        );
        return response;
    }

    private requestWithToken<TResponse, TBody>(
        request: TransportRequest<TBody>,
        accessToken: string,
        tokenType: string,
    ): Promise<TransportResult<TResponse>> {
        const headers = new Headers(request.headers);
        headers.set("authorization", `${tokenType} ${accessToken}`);
        return this.transport.request<TResponse, TBody>({
            ...request,
            headers,
        });
    }
}
