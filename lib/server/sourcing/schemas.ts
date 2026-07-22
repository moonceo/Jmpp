import { z } from "zod";

export const bigintVersionSchema = z.string()
    .regex(/^[1-9]\d*$/)
    .max(19)
    .refine((value) => BigInt(value) <= BigInt("9223372036854775807"));

function normalizedDecimal(value: string, scale: number): string {
    const [whole, fraction = ""] = value.split(".");
    return `${whole}.${fraction.padEnd(scale, "0")}`;
}

export const cnyAmountSchema = z.string()
    .regex(/^(?:0|[1-9]\d{0,15})(?:\.\d{1,2})?$/)
    .transform((value) => normalizedDecimal(value, 2));

export const exchangeRateSchema = z.string()
    .regex(/^(?:0|[1-9]\d{0,8})(?:\.\d{1,6})?$/)
    .refine((value) => !/^0(?:\.0+)?$/.test(value))
    .transform((value) => normalizedDecimal(value, 6));

const safeText = (max: number) => z.string()
    .trim()
    .min(1)
    .max(max)
    .regex(/^[^\u0000-\u001f\u007f]+$/);

const sourceProductSchema = z.object({
    platform: z.enum(["TAOBAO", "TMALL", "SOURCING_LIFE"]),
    externalProductId: safeText(200),
    canonicalUrl: z.url().max(2_000),
    sellerId: safeText(200).optional(),
    titleKo: safeText(500).optional(),
    titleZh: safeText(500).optional(),
    thumbnailUrl: z.url().max(2_000).refine(
        (value) => new URL(value).protocol === "https:",
        "HTTPS is required.",
    ).optional(),
    saleStatus: z.enum(["ACTIVE", "UNAVAILABLE", "DELETED"]),
    restrictionStatus: z.enum(["CLEAR", "REVIEW_REQUIRED", "PROHIBITED"]),
    restrictionReason: safeText(1_000).optional(),
    customsRequirement: z.enum(["NOT_REQUIRED", "FORMAT_VALID", "IDENTITY_VERIFIED"]),
    sourceVersion: safeText(200),
    lastCheckedAt: z.iso.datetime({ offset: true }),
}).strict().superRefine((value, context) => {
    const url = new URL(value.canonicalUrl);
    if (url.protocol !== "https:") {
        context.addIssue({ code: "custom", path: ["canonicalUrl"], message: "HTTPS is required." });
    }
    const hostname = url.hostname.toLowerCase();
    const isHostOrSubdomain = (domain: string) => hostname === domain || hostname.endsWith(`.${domain}`);
    if (value.platform === "TAOBAO" && !isHostOrSubdomain("taobao.com")) {
        context.addIssue({ code: "custom", path: ["canonicalUrl"], message: "The URL is not a Taobao URL." });
    }
    if (value.platform === "TMALL" && !isHostOrSubdomain("tmall.com")) {
        context.addIssue({ code: "custom", path: ["canonicalUrl"], message: "The URL is not a Tmall URL." });
    }
    if (value.restrictionStatus !== "CLEAR" && !value.restrictionReason) {
        context.addIssue({ code: "custom", path: ["restrictionReason"], message: "A restriction reason is required." });
    }
});

const sourceOptionSchema = z.object({
    externalSkuId: safeText(200),
    optionAttributes: z.record(safeText(100), safeText(300)).refine(
        (value) => Object.keys(value).length > 0 && Object.keys(value).length <= 20,
    ),
    optionLabelKo: safeText(500).optional(),
    optionLabelZh: safeText(500).optional(),
    unitPriceCny: cnyAmountSchema,
    stockStatus: z.enum(["AVAILABLE", "LOW_STOCK", "OUT_OF_STOCK", "UNKNOWN"]),
    stockQuantity: z.number().int().nonnegative().max(10_000_000).nullable(),
    minimumQuantity: z.number().int().positive().max(1_000_000),
    quantityStep: z.number().int().positive().max(1_000_000),
    chinaShippingStatus: z.enum(["CONFIRMED", "ESTIMATED", "UNKNOWN"]),
    chinaShippingCny: cnyAmountSchema.nullable(),
    sourceVersion: safeText(200),
    lastCheckedAt: z.iso.datetime({ offset: true }),
}).strict().superRefine((value, context) => {
    if (value.chinaShippingStatus === "UNKNOWN" && value.chinaShippingCny !== null) {
        context.addIssue({ code: "custom", path: ["chinaShippingCny"], message: "Unknown shipping cannot have an amount." });
    }
    if (value.chinaShippingStatus !== "UNKNOWN" && value.chinaShippingCny === null) {
        context.addIssue({ code: "custom", path: ["chinaShippingCny"], message: "Known shipping requires an amount." });
    }
    if (value.stockStatus === "OUT_OF_STOCK" && value.stockQuantity !== null && value.stockQuantity !== 0) {
        context.addIssue({ code: "custom", path: ["stockQuantity"], message: "Out-of-stock quantity must be zero or unknown." });
    }
});

export const saveSourcingMappingBodySchema = z.object({
    expectedOrderItemVersion: bigintVersionSchema,
    expectedMappingRevision: z.number().int().positive().optional(),
    quantityMultiplier: z.number().int().positive().max(10_000),
    sourceProduct: sourceProductSchema,
    sourceOption: sourceOptionSchema,
}).strict();

export const validateSourcingMappingBodySchema = z.object({
    expectedOrderItemVersion: bigintVersionSchema,
    expectedMappingRevision: z.number().int().positive(),
    maximumAgeSeconds: z.number().int().positive().max(3_600).optional(),
}).strict();

const laterCostSchema = z.object({
    status: z.enum(["ESTIMATED", "PAY_LATER", "UNKNOWN"]),
    amountKrw: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER).nullable(),
}).strict().superRefine((value, context) => {
    if (value.status === "ESTIMATED" && value.amountKrw === null) {
        context.addIssue({ code: "custom", path: ["amountKrw"], message: "Estimated cost requires an amount." });
    }
    if (value.status === "UNKNOWN" && value.amountKrw !== null) {
        context.addIssue({ code: "custom", path: ["amountKrw"], message: "Unknown cost cannot have an amount." });
    }
});

const customsCostSchema = z.object({
    status: z.enum(["ESTIMATED", "PAY_LATER", "NOT_APPLICABLE", "UNKNOWN"]),
    amountKrw: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER).nullable(),
}).strict().superRefine((value, context) => {
    if (value.status === "ESTIMATED" && value.amountKrw === null) {
        context.addIssue({ code: "custom", path: ["amountKrw"], message: "Estimated tax requires an amount." });
    }
    if ((value.status === "UNKNOWN" || value.status === "NOT_APPLICABLE") && value.amountKrw !== null) {
        context.addIssue({ code: "custom", path: ["amountKrw"], message: "This status cannot have an amount." });
    }
});

export const preparePurchaseDraftBodySchema = z.object({
    expectedOrderItemVersion: bigintVersionSchema,
    expectedMappingRevision: z.number().int().positive(),
    requestRevision: safeText(200),
    exchangeRateKrwPerCny: exchangeRateSchema,
    exchangeRateSource: safeText(200),
    exchangeRateObservedAt: z.iso.datetime({ offset: true }),
    quoteExpiresAt: z.iso.datetime({ offset: true }),
    agencyFeeKrw: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
    internationalShipping: laterCostSchema,
    customsTax: customsCostSchema,
    otherFeeKrw: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
    discountKrw: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
    discountStatus: z.enum(["CONFIRMED", "ESTIMATED"]),
    forwarderStatus: z.enum(["READY", "NOT_CONFIGURED", "ACTION_REQUIRED"]),
    userNote: safeText(1_000).optional(),
}).strict();

export type SaveSourcingMappingBody = z.infer<typeof saveSourcingMappingBodySchema>;
export type ValidateSourcingMappingBody = z.infer<typeof validateSourcingMappingBodySchema>;
export type PreparePurchaseDraftBody = z.infer<typeof preparePurchaseDraftBodySchema>;
