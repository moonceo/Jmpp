import { describe, expect, it, vi } from "vitest";
import type { FetchLike } from "@/lib/server/integrations/core";
import { CoupangOpenApiClient } from "@/lib/server/integrations/coupang/client";

interface CapturedRequest {
    url: string;
    init?: RequestInit;
}

const credentials = {
    vendorId: "A00012345",
    accessKey: "test-access-key",
    secretKey: "test-secret-key",
};
const NOW = new Date("2026-07-10T03:00:45.000Z");

function queuedFetch(bodyTexts: readonly string[]): {
    fetch: FetchLike;
    requests: CapturedRequest[];
} {
    const queue = [...bodyTexts];
    const requests: CapturedRequest[] = [];
    return {
        requests,
        fetch: async (input, init) => {
            requests.push({ url: String(input), init });
            const body = queue.shift();
            if (body === undefined) throw new Error("No mock response remains.");
            return new Response(body, {
                status: 200,
                headers: { "content-type": "application/json" },
            });
        },
    };
}

const orderListBody = `{
  "code": 200,
  "message": "OK",
  "data": [{
    "shipmentBoxId": 642538971006401429,
    "orderId": 22000009546234,
    "orderedAt": "2026-07-10T10:00:00+09:00",
    "paidAt": "2026-07-10T10:01:00+09:00",
    "status": "ACCEPT",
    "orderer": { "name": "masked" },
    "receiver": { "name": "masked" },
    "orderItems": [{
      "vendorItemId": 3834780191,
      "vendorItemName": "option",
      "shippingCount": 1,
      "sellerProductId": 1234567890
    }]
  }]
}`;

describe("CoupangOpenApiClient", () => {
    it("signs and reads the official v5 minute order endpoint losslessly", async () => {
        const mock = queuedFetch([orderListBody]);
        const client = new CoupangOpenApiClient({
            credentials,
            fetch: mock.fetch,
            now: () => new Date(NOW),
        });

        const result = await client.getOrderSheetsByMinute({
            createdAtFrom: "2026-07-10T11:00+09:00",
            createdAtTo: "2026-07-10T12:00+09:00",
            status: "ACCEPT",
        });

        expect(result.outcome).toBe("success");
        if (result.outcome !== "success") return;
        expect(result.data.items[0]).toMatchObject({
            shipmentBoxId: "642538971006401429",
            orderId: "22000009546234",
            status: "ACCEPT",
            orderItems: [{
                vendorItemId: "3834780191",
                sellerProductId: "1234567890",
                shippingCount: 1,
            }],
        });
        expect(result.raw.bodyText).toBe(orderListBody);

        const request = mock.requests[0];
        const url = new URL(request.url);
        expect(url.pathname).toBe(
            "/v2/providers/openapi/apis/api/v5/vendors/A00012345/ordersheets",
        );
        expect(url.search.slice(1)).toBe(
            "createdAtFrom=2026-07-10T11%3A00%2B09%3A00"
            + "&createdAtTo=2026-07-10T12%3A00%2B09%3A00"
            + "&searchType=timeFrame&status=ACCEPT",
        );
        const authorization = new Headers(request.init?.headers).get("authorization");
        expect(authorization).toContain("signed-date=260710T030045Z");
        expect(authorization).toContain("access-key=test-access-key");
        expect(authorization).not.toContain(credentials.secretKey);
        expect(request.init?.redirect).toBe("error");
    });

    it("uses the verified shipmentBoxId detail path without coercing the ID", async () => {
        const singleBody = orderListBody.replace('"data": [{', '"data": {')
            .replace(/}]\s*}\s*$/, "}\n}");
        const mock = queuedFetch([singleBody]);
        const client = new CoupangOpenApiClient({
            credentials,
            fetch: mock.fetch,
            now: () => new Date(NOW),
        });

        const result = await client.getOrderSheetByShipmentBoxId(
            "642538971006401429",
        );

        expect(result.outcome).toBe("success");
        if (result.outcome !== "success") return;
        expect(result.data.item.shipmentBoxId).toBe("642538971006401429");
        expect(new URL(mock.requests[0].url).pathname).toBe(
            "/v2/providers/openapi/apis/api/v5/vendors/A00012345"
            + "/ordersheets/642538971006401429",
        );
    });

    it("verifies signed order-read access with a bounded five-minute KST window", async () => {
        const mock = queuedFetch([orderListBody]);
        const client = new CoupangOpenApiClient({
            credentials,
            fetch: mock.fetch,
            now: () => new Date(NOW),
        });

        const result = await client.verifyOrderReadAccess();

        expect(result.outcome).toBe("success");
        if (result.outcome !== "success") return;
        expect(result.data).toEqual({
            vendorId: "A00012345",
            checkedAt: NOW.toISOString(),
            endpoint: "ORDER_SHEETS_BY_MINUTE",
            status: "ACCESS_VERIFIED",
            sampledOrderCount: 1,
        });
        expect(result.raw.bodyText).toContain("redacted");
        expect(result.raw.bodyText).not.toContain("masked");
        expect(result.raw.body).toMatchObject({
            sampledOrderCount: 1,
            orderDataRedacted: true,
        });
        const url = new URL(mock.requests[0].url);
        expect(url.searchParams.get("createdAtFrom")).toBe("2026-07-10T11:55+09:00");
        expect(url.searchParams.get("createdAtTo")).toBe("2026-07-10T12:00+09:00");
        expect(url.searchParams.get("status")).toBe("ACCEPT");
    });

    it("fails closed before network access for invalid windows or credentials", async () => {
        const fetch = vi.fn<FetchLike>();
        const invalidWindowClient = new CoupangOpenApiClient({ credentials, fetch });
        const invalidWindow = await invalidWindowClient.getOrderSheetsByMinute({
            createdAtFrom: "2026-07-09T00:00+09:00",
            createdAtTo: "2026-07-11T00:01+09:00",
            status: "ACCEPT",
        });
        const secret = "do-not-leak-this-secret";
        const invalidCredentialClient = new CoupangOpenApiClient({
            credentials: { ...credentials, accessKey: "bad\nkey", secretKey: secret },
            fetch,
        });
        const invalidCredential = await invalidCredentialClient.verifyOrderReadAccess();

        expect(invalidWindow.outcome).toBe("failure");
        expect(invalidCredential.outcome).toBe("failure");
        expect(JSON.stringify(invalidCredential)).not.toContain(secret);
        expect(fetch).not.toHaveBeenCalled();
    });
});
