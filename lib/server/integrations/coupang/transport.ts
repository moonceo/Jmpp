import {
    classifyHttpError,
    errorMessage,
    failureResult,
    successResult,
    type FetchLike,
    type HttpTransport,
    type RawHttpResponse,
    type TransportRequest,
    type TransportResult,
} from "@/lib/server/integrations/core";
import { parseCoupangJson } from "@/lib/server/integrations/coupang/json";

const DEFAULT_TIMEOUT_MS = 15_000;
const DEFAULT_MAX_RESPONSE_BYTES = 4 * 1024 * 1024;

class ResponseTooLargeError extends Error {
    constructor(readonly maximumBytes: number) {
        super(`Coupang response exceeded the ${maximumBytes}-byte limit.`);
        this.name = "ResponseTooLargeError";
    }
}

export interface CoupangReadTransportOptions {
    fetch?: FetchLike;
    defaultTimeoutMs?: number;
    maxResponseBytes?: number;
    now?: () => number;
}

function validatePositiveInteger(value: number, name: string): void {
    if (!Number.isSafeInteger(value) || value <= 0) {
        throw new RangeError(`${name} must be a positive safe integer.`);
    }
}

function responseHeaders(headers: Headers): Readonly<Record<string, string>> {
    return Object.freeze(Object.fromEntries(headers.entries()));
}

function parseBody(bodyText: string): unknown {
    if (!bodyText) return undefined;
    try {
        return parseCoupangJson(bodyText);
    } catch {
        return bodyText;
    }
}

async function readBoundedBody(
    response: Response,
    maximumBytes: number,
): Promise<string> {
    const declaredLength = response.headers.get("content-length");
    if (declaredLength !== null) {
        const length = Number(declaredLength);
        if (Number.isFinite(length) && length > maximumBytes) {
            await response.body?.cancel().catch(() => undefined);
            throw new ResponseTooLargeError(maximumBytes);
        }
    }
    if (!response.body) return "";

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let bytesRead = 0;
    let text = "";

    try {
        while (true) {
            const part = await reader.read();
            if (part.done) break;
            bytesRead += part.value.byteLength;
            if (bytesRead > maximumBytes) {
                await reader.cancel().catch(() => undefined);
                throw new ResponseTooLargeError(maximumBytes);
            }
            text += decoder.decode(part.value, { stream: true });
        }
        return text + decoder.decode();
    } finally {
        reader.releaseLock();
    }
}

/** Read-only transport used while the Coupang adapter remains disabled. */
export class CoupangReadHttpTransport implements HttpTransport {
    private readonly fetchImpl: FetchLike;
    private readonly defaultTimeoutMs: number;
    private readonly maxResponseBytes: number;
    private readonly now: () => number;

    constructor(options: CoupangReadTransportOptions = {}) {
        this.fetchImpl = options.fetch ?? globalThis.fetch.bind(globalThis);
        this.defaultTimeoutMs = options.defaultTimeoutMs ?? DEFAULT_TIMEOUT_MS;
        this.maxResponseBytes = options.maxResponseBytes ?? DEFAULT_MAX_RESPONSE_BYTES;
        this.now = options.now ?? Date.now;
        validatePositiveInteger(this.defaultTimeoutMs, "defaultTimeoutMs");
        validatePositiveInteger(this.maxResponseBytes, "maxResponseBytes");
    }

    async request<TResponse, TBody = unknown>(
        request: TransportRequest<TBody>,
    ): Promise<TransportResult<TResponse>> {
        if (
            request.method !== "GET"
            || request.body !== undefined
            || request.form !== undefined
            || request.query !== undefined
        ) {
            return failureResult({
                kind: "configuration",
                code: "COUPANG_READ_TRANSPORT_ONLY",
                message: "The disabled Coupang adapter transport accepts signed GET URLs only.",
                retryable: false,
            });
        }

        let url: URL;
        try {
            url = new URL(request.url);
            if (
                url.protocol !== "https:"
                || url.hostname !== "api-gateway.coupang.com"
                || (url.port && url.port !== "443")
                || url.username
                || url.password
            ) {
                throw new TypeError(
                    "Coupang requests require the official HTTPS API gateway origin.",
                );
            }
        } catch (cause) {
            return failureResult({
                kind: "validation",
                code: "INVALID_COUPANG_URL",
                message: errorMessage(cause),
                retryable: false,
            });
        }

        const timeoutMs = request.timeoutMs ?? this.defaultTimeoutMs;
        if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0) {
            return failureResult({
                kind: "validation",
                code: "INVALID_COUPANG_TIMEOUT",
                message: "timeoutMs must be a positive safe integer.",
                retryable: false,
            });
        }

        const headers = new Headers(request.headers);
        if (!headers.has("accept")) headers.set("accept", "application/json");
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
                method: "GET",
                headers,
                signal: controller.signal,
                redirect: "error",
            });
            const bodyText = await readBoundedBody(response, this.maxResponseBytes);
            const body = parseBody(bodyText);
            const raw: RawHttpResponse = {
                requestUrl: url.toString(),
                requestMethod: "GET",
                status: response.status,
                statusText: response.statusText,
                headers: responseHeaders(response.headers),
                body,
                bodyText,
                receivedAtMs: this.now(),
            };
            return response.ok
                ? successResult(body as TResponse, raw)
                : failureResult(classifyHttpError(raw), raw);
        } catch (cause) {
            if (cause instanceof ResponseTooLargeError) {
                return failureResult({
                    kind: "unexpected_response",
                    code: "COUPANG_RESPONSE_TOO_LARGE",
                    message: cause.message,
                    retryable: false,
                    details: { maximumBytes: cause.maximumBytes },
                });
            }
            if (timedOut) {
                return failureResult({
                    kind: "timeout",
                    code: "COUPANG_REQUEST_TIMEOUT",
                    message: `Coupang request exceeded ${timeoutMs}ms.`,
                    retryable: true,
                });
            }
            if (request.signal?.aborted || controller.signal.aborted) {
                return failureResult({
                    kind: "aborted",
                    code: "COUPANG_REQUEST_ABORTED",
                    message: "Coupang request was aborted.",
                    retryable: false,
                });
            }
            return failureResult({
                kind: "network",
                code: "COUPANG_NETWORK_ERROR",
                message: errorMessage(cause),
                retryable: true,
            });
        } finally {
            clearTimeout(timeout);
            request.signal?.removeEventListener("abort", forwardAbort);
        }
    }
}

export function createCoupangReadTransport(
    options: CoupangReadTransportOptions = {},
): HttpTransport {
    return new CoupangReadHttpTransport(options);
}
