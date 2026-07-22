import { ApiError } from "@/lib/server/http/api-error";
import {
    ORDER_MARKET_CODES,
    type OrderMarketCode,
} from "@/lib/server/repositories/orders";

/** Add a code here only after its credential verifier and sync worker ship. */
export const IMPLEMENTED_MARKET_ADAPTERS = ["NAVER"] as const satisfies readonly OrderMarketCode[];

function configuredAdapters(
    environment: NodeJS.ProcessEnv = process.env,
): ReadonlySet<OrderMarketCode> {
    const configured = environment.ENABLED_MARKET_ADAPTERS;
    if (configured === undefined) return new Set(IMPLEMENTED_MARKET_ADAPTERS);

    const requested = configured
        .split(",")
        .map((value) => value.trim().toUpperCase())
        .filter(Boolean);
    const known = new Set<string>(ORDER_MARKET_CODES);
    const implemented = new Set<string>(IMPLEMENTED_MARKET_ADAPTERS);

    for (const marketCode of requested) {
        if (!known.has(marketCode) || !implemented.has(marketCode)) {
            throw new ApiError(
                503,
                "MARKET_ADAPTER_CONFIGURATION_INVALID",
                `ENABLED_MARKET_ADAPTERS contains an adapter that is not implemented: ${marketCode}`,
            );
        }
    }

    return new Set(requested as OrderMarketCode[]);
}

export function isMarketAdapterEnabled(
    marketCode: OrderMarketCode,
    environment: NodeJS.ProcessEnv = process.env,
): boolean {
    return configuredAdapters(environment).has(marketCode);
}

export function requireEnabledMarketAdapter(
    marketCode: OrderMarketCode,
    environment: NodeJS.ProcessEnv = process.env,
): void {
    if (isMarketAdapterEnabled(marketCode, environment)) return;

    throw new ApiError(
        422,
        "MARKET_ADAPTER_NOT_READY",
        `${marketCode} 마켓 어댑터는 현재 사용할 수 없습니다.`,
    );
}
