import { createHmac } from "node:crypto";
import { z } from "zod";
import type { HttpMethod, QueryValue } from "@/lib/server/integrations/core";
import type {
    CoupangCredentials,
    CoupangSignedRequest,
} from "@/lib/server/integrations/coupang/types";

const vendorIdSchema = z.string()
    .min(1)
    .max(64)
    .regex(/^[A-Za-z0-9_-]+$/);
const accessKeySchema = z.string()
    .min(1)
    .max(256)
    .regex(/^[\x21-\x2B\x2D-\x7E]+$/);
const secretKeySchema = z.string()
    .min(1)
    .max(512)
    .regex(/^[\x21-\x7E]+$/);
const credentialsSchema = z.object({
    vendorId: vendorIdSchema,
    accessKey: accessKeySchema,
    secretKey: secretKeySchema,
}).strict();

export type CoupangCredentialValidation =
    | { ok: true; credentials: CoupangCredentials }
    | { ok: false; invalidFields: readonly string[] };

export function validateCoupangCredentials(
    value: unknown,
): CoupangCredentialValidation {
    const parsed = credentialsSchema.safeParse(value);
    if (parsed.success) return { ok: true, credentials: parsed.data };

    return {
        ok: false,
        invalidFields: [...new Set(parsed.error.issues.map(
            (issue) => String(issue.path[0] ?? "credentials"),
        ))].sort(),
    };
}

export function formatCoupangSignedDatetime(date: Date): string {
    if (Number.isNaN(date.getTime())) {
        throw new RangeError("date must be valid.");
    }
    const iso = date.toISOString();
    return `${iso.slice(2, 4)}${iso.slice(5, 7)}${iso.slice(8, 10)}`
        + `T${iso.slice(11, 13)}${iso.slice(14, 16)}${iso.slice(17, 19)}Z`;
}

export function buildCoupangCanonicalQuery(
    query: Readonly<Record<string, QueryValue>>,
): string {
    const parameters = new URLSearchParams();
    for (const key of Object.keys(query).sort()) {
        if (!key || /[\r\n]/.test(key)) {
            throw new TypeError("query parameter names must not be blank or contain line breaks.");
        }
        const value = query[key];
        if (value !== undefined && value !== null) {
            if (typeof value === "number" && !Number.isSafeInteger(value)) {
                throw new RangeError("numeric query values must be safe integers.");
            }
            parameters.append(key, String(value));
        }
    }
    return parameters.toString();
}

function validateCanonicalPath(path: string): void {
    if (
        !path.startsWith("/")
        || path.includes("?")
        || path.includes("#")
        || /[\r\n]/.test(path)
    ) {
        throw new TypeError("path must be an absolute URL path without query or fragment.");
    }
}

export function createCoupangSignedRequest(input: {
    credentials: CoupangCredentials;
    method: HttpMethod;
    path: string;
    query?: string;
    date: Date;
}): CoupangSignedRequest {
    const credentials = validateCoupangCredentials(input.credentials);
    if (!credentials.ok) {
        throw new TypeError(
            `Invalid Coupang credentials: ${credentials.invalidFields.join(", ")}.`,
        );
    }
    validateCanonicalPath(input.path);
    const query = input.query ?? "";
    if (query.startsWith("?") || query.includes("#") || /[\r\n]/.test(query)) {
        throw new TypeError(
            "query must not include a leading question mark, fragment, or line breaks.",
        );
    }

    const method = input.method.toUpperCase() as HttpMethod;
    const datetime = formatCoupangSignedDatetime(input.date);
    const canonicalMessage = `${datetime}${method}${input.path}${query}`;
    const signature = createHmac(
        "sha256",
        credentials.credentials.secretKey,
    ).update(canonicalMessage, "utf8").digest("hex");
    const authorization = [
        "CEA algorithm=HmacSHA256",
        `access-key=${credentials.credentials.accessKey}`,
        `signed-date=${datetime}`,
        `signature=${signature}`,
    ].join(", ");

    return {
        authorization,
        canonicalMessage,
        datetime,
        method,
        path: input.path,
        query,
        signature,
    };
}
