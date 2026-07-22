import { describe, expect, it } from "vitest";
import { z } from "zod";
import { parseJsonBody } from "@/lib/server/http/api-error";

describe("parseJsonBody", () => {
    it("parses a bounded JSON body", async () => {
        const request = new Request("http://localhost/api/test", {
            method: "POST",
            body: JSON.stringify({ name: "ok" }),
        });

        await expect(parseJsonBody(request, z.object({ name: z.literal("ok") }), 64)).resolves.toEqual({ name: "ok" });
    });

    it("stops reading a chunked body when the byte limit is exceeded", async () => {
        const request = new Request("http://localhost/api/test", {
            method: "POST",
            body: JSON.stringify({ value: "가".repeat(100) }),
        });

        await expect(parseJsonBody(request, z.object({ value: z.string() }), 32)).rejects.toMatchObject({
            status: 413,
            code: "REQUEST_TOO_LARGE",
        });
    });

    it("does not collapse schema errors into invalid JSON", async () => {
        const request = new Request("http://localhost/api/test", {
            method: "POST",
            body: JSON.stringify({ count: "one" }),
        });

        await expect(parseJsonBody(request, z.object({ count: z.number() }))).rejects.toMatchObject({
            status: 400,
            code: "VALIDATION_ERROR",
        });
    });
});
