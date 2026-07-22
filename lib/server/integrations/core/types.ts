export type IntegrationErrorKind =
    | "validation"
    | "configuration"
    | "authentication"
    | "authorization"
    | "not_found"
    | "conflict"
    | "rate_limit"
    | "timeout"
    | "aborted"
    | "network"
    | "server"
    | "remote_rejection"
    | "unexpected_response"
    | "http";

export interface IntegrationError {
    kind: IntegrationErrorKind;
    message: string;
    retryable: boolean;
    code?: string;
    httpStatus?: number;
    retryAfterMs?: number;
    details?: unknown;
    cause?: unknown;
}

export interface RawHttpResponse<TBody = unknown> {
    requestUrl: string;
    requestMethod: HttpMethod;
    status: number;
    statusText: string;
    headers: Readonly<Record<string, string>>;
    body: TBody;
    bodyText: string;
    receivedAtMs: number;
}

export interface IntegrationIssue {
    kind: "remote_item_failure" | "warning";
    message: string;
    code?: string;
    externalId?: string;
    retryable: boolean;
    details?: unknown;
}

export interface IntegrationSuccess<T> {
    ok: true;
    outcome: "success";
    data: T;
    raw: RawHttpResponse;
}

export interface IntegrationPartial<T> {
    ok: false;
    outcome: "partial";
    data: T;
    issues: readonly IntegrationIssue[];
    raw: RawHttpResponse;
}

export interface IntegrationFailure {
    ok: false;
    outcome: "failure";
    error: IntegrationError;
    raw?: RawHttpResponse;
}

export type IntegrationResult<T> =
    | IntegrationSuccess<T>
    | IntegrationPartial<T>
    | IntegrationFailure;

export type TransportResult<T> = IntegrationSuccess<T> | IntegrationFailure;

export type HttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

export type FetchLike = (
    input: RequestInfo | URL,
    init?: RequestInit,
) => Promise<Response>;

export type QueryValue = string | number | boolean | null | undefined;

export interface TransportRequest<TBody = unknown> {
    method: HttpMethod;
    url: string | URL;
    headers?: HeadersInit;
    query?: Readonly<Record<string, QueryValue>>;
    body?: TBody;
    form?: URLSearchParams;
    timeoutMs?: number;
    signal?: AbortSignal;
}

export interface HttpTransport {
    request<TResponse, TBody = unknown>(
        request: TransportRequest<TBody>,
    ): Promise<TransportResult<TResponse>>;
}

