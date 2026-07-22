import { classifyHttpError, errorMessage } from "./errors";
import { failureResult, successResult } from "./result";
import type {
    FetchLike,
    HttpTransport,
    QueryValue,
    RawHttpResponse,
    TransportRequest,
    TransportResult,
} from "./types";

export interface FetchTransportOptions {
    fetch?: FetchLike;
    defaultTimeoutMs?: number;
    now?: () => number;
}

const DEFAULT_TIMEOUT_MS = 15_000;

function appendQuery(url: URL, query: Readonly<Record<string, QueryValue>>): void {
    for (const [name, value] of Object.entries(query)) {
        if (value !== undefined && value !== null) {
            url.searchParams.set(name, String(value));
        }
    }
}

function responseHeaders(headers: Headers): Readonly<Record<string, string>> {
    return Object.freeze(Object.fromEntries(headers.entries()));
}

function parseBody(bodyText: string): unknown {
    if (bodyText.length === 0) {
        return undefined;
    }

    try {
        return JSON.parse(bodyText) as unknown;
    } catch {
        return bodyText;
    }
}

function serializeBody<TBody>(
    request: TransportRequest<TBody>,
    headers: Headers,
): BodyInit | undefined {
    if (request.form !== undefined && request.body !== undefined) {
        throw new TypeError("body와 form은 동시에 지정할 수 없습니다.");
    }

    if (request.form !== undefined) {
        if (!headers.has("content-type")) {
            headers.set("content-type", "application/x-www-form-urlencoded");
        }
        return request.form.toString();
    }

    if (request.body === undefined) {
        return undefined;
    }

    if (!headers.has("content-type")) {
        headers.set("content-type", "application/json");
    }

    const serialized = JSON.stringify(request.body);
    if (serialized === undefined) {
        throw new TypeError("요청 본문을 JSON으로 직렬화할 수 없습니다.");
    }

    return serialized;
}

export class FetchHttpTransport implements HttpTransport {
    private readonly fetchImpl: FetchLike;
    private readonly defaultTimeoutMs: number;
    private readonly now: () => number;

    constructor(options: FetchTransportOptions = {}) {
        this.fetchImpl = options.fetch ?? globalThis.fetch.bind(globalThis);
        this.defaultTimeoutMs = options.defaultTimeoutMs ?? DEFAULT_TIMEOUT_MS;
        this.now = options.now ?? Date.now;
    }

    async request<TResponse, TBody = unknown>(
        request: TransportRequest<TBody>,
    ): Promise<TransportResult<TResponse>> {
        let url: URL;
        let body: BodyInit | undefined;
        const headers = new Headers(request.headers);

        try {
            url = new URL(request.url);
            if (request.query) {
                appendQuery(url, request.query);
            }
            if (!headers.has("accept")) {
                headers.set("accept", "application/json");
            }
            body = serializeBody(request, headers);
        } catch (cause) {
            return failureResult({
                kind: "validation",
                message: errorMessage(cause),
                retryable: false,
                cause,
            });
        }

        const timeoutMs = request.timeoutMs ?? this.defaultTimeoutMs;
        if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
            return failureResult({
                kind: "validation",
                message: "timeoutMs는 0보다 큰 유한한 숫자여야 합니다.",
                retryable: false,
            });
        }

        const controller = new AbortController();
        let timedOut = false;
        const forwardAbort = () => controller.abort(request.signal?.reason);
        if (request.signal?.aborted) {
            forwardAbort();
        } else {
            request.signal?.addEventListener("abort", forwardAbort, { once: true });
        }

        const timeout = setTimeout(() => {
            timedOut = true;
            controller.abort(new DOMException("Request timed out", "TimeoutError"));
        }, timeoutMs);

        try {
            const response = await this.fetchImpl(url, {
                method: request.method,
                headers,
                body,
                signal: controller.signal,
            });
            const bodyText = await response.text();
            const parsedBody = parseBody(bodyText);
            const raw: RawHttpResponse = {
                requestUrl: url.toString(),
                requestMethod: request.method,
                status: response.status,
                statusText: response.statusText,
                headers: responseHeaders(response.headers),
                body: parsedBody,
                bodyText,
                receivedAtMs: this.now(),
            };

            if (!response.ok) {
                return failureResult(classifyHttpError(raw), raw);
            }

            return successResult(parsedBody as TResponse, raw);
        } catch (cause) {
            if (timedOut) {
                return failureResult({
                    kind: "timeout",
                    code: "REQUEST_TIMEOUT",
                    message: `요청 시간이 ${timeoutMs}ms를 초과했습니다.`,
                    retryable: true,
                    cause,
                });
            }

            if (request.signal?.aborted || controller.signal.aborted) {
                return failureResult({
                    kind: "aborted",
                    code: "REQUEST_ABORTED",
                    message: "요청이 취소되었습니다.",
                    retryable: false,
                    cause,
                });
            }

            return failureResult({
                kind: "network",
                code: "NETWORK_ERROR",
                message: errorMessage(cause),
                retryable: true,
                cause,
            });
        } finally {
            clearTimeout(timeout);
            request.signal?.removeEventListener("abort", forwardAbort);
        }
    }
}

export function createFetchTransport(
    options: FetchTransportOptions = {},
): HttpTransport {
    return new FetchHttpTransport(options);
}

