import { describe, expect, it } from "vitest";
import { parseOptionAttributes } from "@/components/orders/live-sourcing-mapping-dialog";

describe("manual exact-SKU option parsing", () => {
    it("parses comma and newline separated key-value pairs", () => {
        expect(parseOptionAttributes("색상=검정, 사이즈=M\n재질=면")).toEqual({
            색상: "검정",
            사이즈: "M",
            재질: "면",
        });
    });

    it("rejects a product-only or malformed option", () => {
        expect(() => parseOptionAttributes("")).toThrow();
        expect(() => parseOptionAttributes("검정")).toThrow();
        expect(() => parseOptionAttributes("=검정")).toThrow();
    });
});
