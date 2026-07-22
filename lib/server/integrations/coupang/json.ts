import JSONBigInt from "json-bigint";

const parser = JSONBigInt({
    strict: true,
    storeAsString: true,
    protoAction: "error",
    constructorAction: "error",
});

/** Parses Coupang JSON without rounding 18-digit marketplace identifiers. */
export function parseCoupangJson(bodyText: string): unknown {
    return parser.parse(bodyText) as unknown;
}
