import type {
    IntegrationError,
    IntegrationFailure,
    IntegrationIssue,
    IntegrationPartial,
    IntegrationSuccess,
    RawHttpResponse,
} from "./types";

export function successResult<T>(
    data: T,
    raw: RawHttpResponse,
): IntegrationSuccess<T> {
    return {
        ok: true,
        outcome: "success",
        data,
        raw,
    };
}

export function partialResult<T>(
    data: T,
    issues: readonly IntegrationIssue[],
    raw: RawHttpResponse,
): IntegrationPartial<T> {
    return {
        ok: false,
        outcome: "partial",
        data,
        issues,
        raw,
    };
}

export function failureResult(
    error: IntegrationError,
    raw?: RawHttpResponse,
): IntegrationFailure {
    return {
        ok: false,
        outcome: "failure",
        error,
        ...(raw === undefined ? {} : { raw }),
    };
}

