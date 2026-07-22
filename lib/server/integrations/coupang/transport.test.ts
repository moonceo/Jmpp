import { describe, expect, it, vi } from "vitest";
import type { FetchLike } from "@/lib/server/integrations/core";
import { CoupangReadHttpTransport } from "@/lib/server/integrations/coupang/transport";

describe("Coupang bounded read transport", () => {
    it("classifies 429 and preserves Retry-After without automatic retry", async () => {
        const fetch = vi.fn<FetchLike>(async () => new Response(
            JSON.stringify({ code: "TOO_MANY_REQUESTS", message: "slow down" }),
            {
                status: 429,
                headers: {
                    "content-type": "application/json",
                    "retry-after": "2",
                    "x-cag-warnings": "near-threshold",
                },
            },
        ));
        const transport = new CoupangReadHttpTransport({
            fetch,
            now: () => 1_000,
        });

        const result = await transport.request({
            method: "GET",
            url: "https://api-gateway.coupang.com/test",
        });

        expect(result.outcome).toBe("failure");
        if (result.outcome !== "failure") return;
        expect(result.error).toMatchObject({
            kind: "rate_limit",
            retryable: true,
            retryAfterMs: 2_000,
            code: "TOO_MANY_REQUESTS",
        });
        expect(fetch).toHaveBeenCalledOnce();
        expect(result.raw?.headers["x-cag-warnings"]).toBe("near-threshold");
    });

    it.each([
        { status: 401, kind: "authentication", retryable: false },
        { status: 403, kind: "authorization", retryable: false },
        { status: 500, kind: "server", retryable: true },
    ] as const)(
        "classifies HTTP $status as $kind",
        async ({ status, kind, retryable }) => {
            const transport = new CoupangReadHttpTransport({
                fetch: async () => new Response(
                    JSON.stringify({ code: `HTTP_${status}`, message: "provider error" }),
                    { status },
                ),
            });

            const result = await transport.request({
                method: "GET",
                url: "https://api-gateway.coupang.com/test",
            });

            expect(result.outcome).toBe("failure");
            if (result.outcome !== "failure") return;
            expect(result.error).toMatchObject({ kind, retryable, httpStatus: status });
        },
    );

    it("stops reading responses over the configured byte limit", async () => {
        const transport = new CoupangReadHttpTransport({
            fetch: async () => new Response("x".repeat(128)),
            maxResponseBytes: 32,
        });

        const result = await transport.request({
            method: "GET",
            url: "https://api-gateway.coupang.com/test",
        });

        expect(result.outcome).toBe("failure");
        if (result.outcome !== "failure") return;
        expect(result.error).toMatchObject({
            kind: "unexpected_response",
            code: "COUPANG_RESPONSE_TOO_LARGE",
            retryable: false,
            details: { maximumBytes: 32 },
        });
    });

    it("bounds request time and never turns timeout into a hidden replay", async () => {
        const fetch: FetchLike = async (_input, init) => new Promise((_resolve, reject) => {
            init?.signal?.addEventListener("abort", () => {
                reject(new DOMException("aborted", "AbortError"));
            }, { once: true });
        });
        const transport = new CoupangReadHttpTransport({
            fetch,
            defaultTimeoutMs: 5,
        });

        const result = await transport.request({
            method: "GET",
            url: "https://api-gateway.coupang.com/test",
        });

        expect(result.outcome).toBe("failure");
        if (result.outcome !== "failure") return;
        expect(result.error).toMatchObject({
            kind: "timeout",
            code: "COUPANG_REQUEST_TIMEOUT",
            retryable: true,
        });
    });

    it("rejects writes and insecure URLs before fetch", async () => {
        const fetch = vi.fn<FetchLike>();
        const transport = new CoupangReadHttpTransport({ fetch });

        const write = await transport.request({
            method: "POST",
            url: "https://api-gateway.coupang.com/test",
            body: {},
        });
        const insecure = await transport.request({
            method: "GET",
            url: "http://api-gateway.coupang.com/test",
        });

        expect(write.outcome).toBe("failure");
        expect(insecure.outcome).toBe("failure");
        expect(fetch).not.toHaveBeenCalled();
    });
});
