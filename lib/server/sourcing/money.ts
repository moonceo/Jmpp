export interface TransparentCostInput {
    unitPriceCny: string;
    sourceQuantity: number;
    chinaShippingCny: string | null;
    exchangeRateKrwPerCny: string;
    agencyFeeKrw: number;
    internationalShippingAmountKrw: number | null;
    customsTaxAmountKrw: number | null;
    otherFeeKrw: number;
    discountKrw: number;
}

export interface TransparentCostBreakdown {
    productSubtotalCny: string;
    productAmountKrw: number;
    chinaShippingAmountKrw: number | null;
    knownCostTotalKrw: number;
}

function scaledDecimal(value: string, scale: number): bigint {
    const [whole, fraction = ""] = value.split(".");
    return BigInt(whole) * BigInt(10) ** BigInt(scale)
        + BigInt(fraction.padEnd(scale, "0").slice(0, scale));
}

function roundedKrw(cnyCents: bigint, exchangeRateMicros: bigint): bigint {
    const denominator = BigInt(100_000_000);
    const numerator = cnyCents * exchangeRateMicros;
    return (numerator + denominator / BigInt(2)) / denominator;
}

function safeNumber(value: bigint, field: string): number {
    if (value < BigInt(0) || value > BigInt(Number.MAX_SAFE_INTEGER)) {
        throw new RangeError(`${field} exceeds the supported KRW range.`);
    }
    return Number(value);
}

function centsText(cents: bigint): string {
    return `${cents / BigInt(100)}.${(cents % BigInt(100)).toString().padStart(2, "0")}`;
}

export function calculateTransparentCosts(
    input: TransparentCostInput,
): TransparentCostBreakdown {
    if (!Number.isSafeInteger(input.sourceQuantity) || input.sourceQuantity <= 0) {
        throw new RangeError("sourceQuantity must be a positive safe integer.");
    }
    const unitCents = scaledDecimal(input.unitPriceCny, 2);
    const subtotalCents = unitCents * BigInt(input.sourceQuantity);
    if (subtotalCents > BigInt("999999999999999999")) {
        throw new RangeError("productSubtotalCny exceeds numeric(18,2).");
    }
    const exchangeRateMicros = scaledDecimal(input.exchangeRateKrwPerCny, 6);
    const productAmount = roundedKrw(subtotalCents, exchangeRateMicros);
    const chinaShippingAmount = input.chinaShippingCny === null
        ? null
        : roundedKrw(scaledDecimal(input.chinaShippingCny, 2), exchangeRateMicros);
    const knownCosts = productAmount
        + (chinaShippingAmount ?? BigInt(0))
        + BigInt(input.agencyFeeKrw)
        + BigInt(input.internationalShippingAmountKrw ?? 0)
        + BigInt(input.customsTaxAmountKrw ?? 0)
        + BigInt(input.otherFeeKrw);
    const total = knownCosts - BigInt(input.discountKrw);
    if (total < BigInt(0)) throw new RangeError("discountKrw exceeds all known costs.");

    return {
        productSubtotalCny: centsText(subtotalCents),
        productAmountKrw: safeNumber(productAmount, "productAmountKrw"),
        chinaShippingAmountKrw: chinaShippingAmount === null
            ? null
            : safeNumber(chinaShippingAmount, "chinaShippingAmountKrw"),
        knownCostTotalKrw: safeNumber(total, "knownCostTotalKrw"),
    };
}
