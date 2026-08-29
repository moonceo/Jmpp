export const LEDGER_MANUAL_FIELDS = [
    { key: "purchaseCostKrw", label: "구매금액(원화)", columnIndex: 26, type: "number", group: "비용" },
    { key: "internationalShippingFee", label: "국제배송비", columnIndex: 30, type: "number", group: "비용" },
    { key: "freightShippingFee", label: "화물택배비", columnIndex: 33, type: "number", group: "비용" },
    { key: "customsTax", label: "관부가세", columnIndex: 34, type: "number", group: "비용" },
] as const;

export const LEDGER_MANUAL_FIELD_KEYS = LEDGER_MANUAL_FIELDS.map((field) => field.key) as [LedgerManualField, ...LedgerManualField[]];

export type LedgerManualField = (typeof LEDGER_MANUAL_FIELDS)[number]["key"];
export type LedgerManualValue = number;

export interface LedgerManualEntry {
    id: string;
    orderId: string;
    field: LedgerManualField;
    value: LedgerManualValue;
    updatedAt: string;
}

export function getLedgerManualField(field: LedgerManualField) {
    return LEDGER_MANUAL_FIELDS.find((definition) => definition.key === field)!;
}

export function isLedgerManualField(value: unknown): value is LedgerManualField {
    return typeof value === "string" && (LEDGER_MANUAL_FIELD_KEYS as readonly string[]).includes(value);
}

export function parseLedgerManualValue(field: LedgerManualField, rawValue: string): LedgerManualValue | null {
    getLedgerManualField(field);
    const value = rawValue.trim();
    if (!value) return null;

    const numberValue = Number(value.replaceAll(",", ""));
    return Number.isFinite(numberValue) && numberValue >= 0 ? numberValue : null;
}

export function isLedgerManualCostField(field: LedgerManualField): boolean {
    return field === "purchaseCostKrw"
        || field === "internationalShippingFee"
        || field === "freightShippingFee"
        || field === "customsTax";
}
