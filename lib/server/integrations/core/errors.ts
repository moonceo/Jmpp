import type {
    IntegrationError,
    IntegrationErrorKind,
    RawHttpResponse,
} from "./types";

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readString(value: unknown): string | undefined {
    return typeof value === "string" && value.length > 0 ? value : undefined;
}

function remoteErrorFields(body: unknown): { code?: string; message?: string } {
    if (!isRecord(body)) {
        return {};
    }

    const nestedError = isRecord(body.error) ? body.error : undefined;

    return {
        code: readString(body.code) ?? readString(nestedError?.code),
        message: readString(body.message) ?? readString(nestedError?.message),
    };
}

function parseRetryAfter(value: string | undefined, nowMs: number): number | undefined {
    if (!value) {
        return undefined;
    }

    const seconds = Number(value);
    if (Number.isFinite(seconds) && seconds >= 0) {
        return Math.round(seconds * 1_000);
    }

    const retryAt = Date.parse(value);
    if (Number.isNaN(retryAt)) {
        return undefined;
    }

    return Math.max(0, retryAt - nowMs);
}

function kindForStatus(status: number): IntegrationErrorKind {
    if (status === 400 || status === 422) return "validation";
    if (status === 401) return "authentication";
    if (status === 403) return "authorization";
    if (status === 404) return "not_found";
    if (status === 408) return "timeout";
    if (status === 409) return "conflict";
    if (status === 429) return "rate_limit";
    if (status >= 500) return "server";
    return "http";
}

export function classifyHttpError(raw: RawHttpResponse): IntegrationError {
    const kind = kindForStatus(raw.status);
    const remote = remoteErrorFields(raw.body);
    const retryable =
        kind === "timeout" || kind === "rate_limit" || kind === "server";
    const retryAfterMs = parseRetryAfter(
        raw.headers["retry-after"],
        raw.receivedAtMs,
    );

    return {
        kind,
        message:
            remote.message ??
            `HTTP ${raw.status}${raw.statusText ? ` ${raw.statusText}` : ""}`,
        retryable,
        httpStatus: raw.status,
        ...(remote.code === undefined ? {} : { code: remote.code }),
        ...(retryAfterMs === undefined ? {} : { retryAfterMs }),
        details: raw.body,
    };
}

export function errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

