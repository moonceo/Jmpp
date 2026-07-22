import { describe, expect, it } from "vitest";
import {
    isMarketAdapterEnabled,
    requireEnabledMarketAdapter,
} from "@/lib/server/market-accounts/adapter-registry";

describe("market adapter registry", () => {
    it("enables only the implemented Naver adapter by default", () => {
        const environment: NodeJS.ProcessEnv = { NODE_ENV: "test" };

        expect(isMarketAdapterEnabled("NAVER", environment)).toBe(true);
        expect(isMarketAdapterEnabled("COUPANG", environment)).toBe(false);
        expect(() => requireEnabledMarketAdapter("COUPANG", environment)).toThrowError(
            expect.objectContaining({ status: 422, code: "MARKET_ADAPTER_NOT_READY" }),
        );
    });

    it("allows an explicit subset of implemented adapters", () => {
        const environment: NodeJS.ProcessEnv = {
            NODE_ENV: "test",
            ENABLED_MARKET_ADAPTERS: "NAVER",
        };

        expect(isMarketAdapterEnabled("NAVER", environment)).toBe(true);
    });

    it("fails closed when configuration names an unimplemented adapter", () => {
        const environment: NodeJS.ProcessEnv = {
            NODE_ENV: "test",
            ENABLED_MARKET_ADAPTERS: "NAVER,COUPANG",
        };

        expect(() => isMarketAdapterEnabled("NAVER", environment)).toThrowError(
            expect.objectContaining({
                status: 503,
                code: "MARKET_ADAPTER_CONFIGURATION_INVALID",
            }),
        );
    });
});
