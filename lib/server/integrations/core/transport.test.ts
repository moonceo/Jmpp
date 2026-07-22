import { describe, expect, it } from "vitest";

import { createFetchTransport } from "./transport";
import type { FetchLike, IntegrationErrorKind } from "./types";

describe("FetchHttpTransport", () => {
    it.each<{
        status: number;
        expectedKind: IntegrationErrorKind;
        retryable: boolean;
    }>([
        { status: 401, expectedKind: "authentication", retryable: false },
        { status: 403, expectedKind: "authorization", retryable: false },
        { status: 409, expectedKind: "conflict", retryable: false },
        { status: 429, expectedKind: "rate_limit", retryable: true },
        { status: 503, expectedKind: "server", retryable: true },
    ])(
        "HTTP $status 응답을 $expectedKind 오류로 분류한다",
        async ({ status, expectedKind, retryable }) => {
            const fetchMock: FetchLike = async () =>
                new Response(JSON.stringify({ code: "REMOTE", message: "실패" }), {
                    status,
                    headers: {
                        "content-type": "application/json",
                        "retry-after": "2",
                    },
                });
            const transport = createFetchTransport({
                fetch: fetchMock,
                now: () => 1_000,
            });

            const result = await transport.request({
                method: "GET",
                url: "https://example.test/orders",
            });

            expect(result.outcome).toBe("failure");
            if (result.outcome !== "failure") return;
            expect(result.error).toMatchObject({
                kind: expectedKind,
                code: "REMOTE",
                message: "실패",
                retryable,
                httpStatus: status,
            });
            expect(result.raw?.bodyText).toBe(
                JSON.stringify({ code: "REMOTE", message: "실패" }),
            );
            if (status === 429) {
                expect(result.error.retryAfterMs).toBe(2_000);
            }
        },
    );

    it("응답 원문과 파싱 본문을 함께 보존한다", async () => {
        const bodyText = "{\"data\":{\"id\":\"A-1\"}}";
        const transport = createFetchTransport({
            fetch: async () =>
                new Response(bodyText, {
                    status: 200,
                    headers: { "x-trace-id": "trace-1" },
                }),
            now: () => 123,
        });

        const result = await transport.request<{ data: { id: string } }>({
            method: "GET",
            url: "https://example.test/orders",
        });

        expect(result.outcome).toBe("success");
        if (result.outcome !== "success") return;
        expect(result.data.data.id).toBe("A-1");
        expect(result.raw).toMatchObject({
            bodyText,
            body: { data: { id: "A-1" } },
            receivedAtMs: 123,
            headers: { "x-trace-id": "trace-1" },
        });
    });

    it("클라이언트 타임아웃을 재시도 가능한 timeout으로 분류한다", async () => {
        const fetchMock: FetchLike = async (_input, init) =>
            new Promise<Response>((_resolve, reject) => {
                init?.signal?.addEventListener(
                    "abort",
                    () => reject(init.signal?.reason ?? new Error("aborted")),
                    { once: true },
                );
            });
        const transport = createFetchTransport({
            fetch: fetchMock,
            defaultTimeoutMs: 5,
        });

        const result = await transport.request({
            method: "GET",
            url: "https://example.test/slow",
        });

        expect(result.outcome).toBe("failure");
        if (result.outcome !== "failure") return;
        expect(result.error).toMatchObject({
            kind: "timeout",
            code: "REQUEST_TIMEOUT",
            retryable: true,
        });
    });
});

