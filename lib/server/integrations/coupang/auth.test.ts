import { describe, expect, it } from "vitest";
import {
    buildCoupangCanonicalQuery,
    createCoupangSignedRequest,
    formatCoupangSignedDatetime,
    validateCoupangCredentials,
} from "@/lib/server/integrations/coupang/auth";

const credentials = {
    vendorId: "A00012345",
    accessKey: "test-access-key",
    secretKey: "test-secret-key",
};

describe("Coupang HMAC authorization", () => {
    it("formats UTC signed-date exactly as yyMMdd'T'HHmmss'Z'", () => {
        expect(formatCoupangSignedDatetime(
            new Date("2025-01-02T03:04:05.999Z"),
        )).toBe("250102T030405Z");
    });

    it("builds one deterministic encoded query regardless of insertion order", () => {
        expect(buildCoupangCanonicalQuery({
            status: "UC",
            createdAtTo: "2018-08-09",
            createdAtFrom: "2018-08-09",
        })).toBe("createdAtFrom=2018-08-09&createdAtTo=2018-08-09&status=UC");

        expect(buildCoupangCanonicalQuery({
            createdAtFrom: "2025-07-29T00:01+09:00",
        })).toBe("createdAtFrom=2025-07-29T00%3A01%2B09%3A00");
    });

    it("matches an official-formula HMAC-SHA256 contract vector", () => {
        const path = "/v2/providers/openapi/apis/api/v4/vendors/A00012345/returnRequests";
        const query = "createdAtFrom=2018-08-09&createdAtTo=2018-08-09&status=UC";
        const signed = createCoupangSignedRequest({
            credentials,
            method: "GET",
            path,
            query,
            date: new Date("2025-01-02T03:04:05Z"),
        });

        expect(signed.canonicalMessage).toBe(
            `250102T030405ZGET${path}${query}`,
        );
        expect(signed.signature).toBe(
            "35b2a7c3340b6c33b5ad9214af1f36146221ee2458846a43f5a54ba8e9302a67",
        );
        expect(signed.authorization).toBe(
            "CEA algorithm=HmacSHA256, access-key=test-access-key, "
            + "signed-date=250102T030405Z, "
            + `signature=${signed.signature}`,
        );
        expect(signed.authorization).not.toContain(credentials.secretKey);
    });

    it("rejects header injection and reports field names without credential values", () => {
        const validation = validateCoupangCredentials({
            ...credentials,
            accessKey: "bad\r\nheader",
            secretKey: " secret ",
        });
        expect(validation).toEqual({
            ok: false,
            invalidFields: ["accessKey", "secretKey"],
        });
        expect(JSON.stringify(validation)).not.toContain("bad");
        expect(() => createCoupangSignedRequest({
            credentials,
            method: "GET",
            path: "/orders?secret=true",
            date: new Date("2025-01-02T03:04:05Z"),
        })).toThrow("without query");
    });
});
