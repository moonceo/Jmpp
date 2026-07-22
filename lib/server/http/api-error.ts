import { ZodError, ZodType } from "zod";

export class ApiError extends Error {
    constructor(
        public readonly status: number,
        public readonly code: string,
        message: string,
        public readonly details?: unknown,
    ) {
        super(message);
        this.name = "ApiError";
    }
}

async function readBodyWithinLimit(request: Request, maximumBytes: number): Promise<string> {
    if (!request.body) return "";

    const reader = request.body.getReader();
    const chunks: Uint8Array[] = [];
    let totalBytes = 0;

    try {
        while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            totalBytes += value.byteLength;

            if (totalBytes > maximumBytes) {
                await reader.cancel("request body limit exceeded");
                throw new ApiError(413, "REQUEST_TOO_LARGE", "요청 본문이 너무 큽니다.");
            }

            chunks.push(value);
        }
    } finally {
        reader.releaseLock();
    }

    return Buffer.concat(chunks.map((chunk) => Buffer.from(chunk))).toString("utf8");
}

export async function parseJsonBody<T>(
    request: Request,
    schema: ZodType<T>,
    maximumBytes = 65_536,
): Promise<T> {
    let body: unknown;

    try {
        const declaredLength = Number(request.headers.get("content-length"));
        if (Number.isFinite(declaredLength) && declaredLength > maximumBytes) {
            throw new ApiError(413, "REQUEST_TOO_LARGE", "요청 본문이 너무 큽니다.");
        }

        const raw = await readBodyWithinLimit(request, maximumBytes);
        body = JSON.parse(raw) as unknown;
    } catch (error) {
        if (error instanceof ApiError) throw error;
        throw new ApiError(400, "INVALID_JSON", "요청 본문이 올바른 JSON이 아닙니다.");
    }

    const parsed = schema.safeParse(body);
    if (!parsed.success) {
        throw new ApiError(400, "VALIDATION_ERROR", "요청값을 확인해 주세요.", parsed.error.flatten());
    }

    return parsed.data;
}

export function jsonResponse<T>(data: T, correlationId: string, status = 200): Response {
    return Response.json(
        { data, meta: { correlationId } },
        { status, headers: { "x-correlation-id": correlationId } },
    );
}

export function errorResponse(error: unknown, correlationId: string): Response {
    if (error instanceof ApiError) {
        if (error.status >= 500) {
            console.error("Server API error", {
                correlationId,
                code: error.code,
                status: error.status,
            });
        }
        return Response.json(
            {
                error: {
                    code: error.code,
                    message: error.message,
                    ...(error.details === undefined ? {} : { details: error.details }),
                },
                meta: { correlationId },
            },
            { status: error.status, headers: { "x-correlation-id": correlationId } },
        );
    }

    if (error instanceof ZodError) {
        return Response.json(
            {
                error: {
                    code: "VALIDATION_ERROR",
                    message: "요청값을 확인해 주세요.",
                    details: error.flatten(),
                },
                meta: { correlationId },
            },
            { status: 400, headers: { "x-correlation-id": correlationId } },
        );
    }

    const safeError = error instanceof Error
        ? {
            name: error.name,
            code: "code" in error && typeof error.code === "string" ? error.code : undefined,
            stack: error.stack,
        }
        : { name: "UnknownThrownValue" };
    console.error("Unhandled API error", { correlationId, ...safeError });

    return Response.json(
        {
            error: {
                code: "INTERNAL_ERROR",
                message: "요청을 처리하지 못했습니다.",
            },
            meta: { correlationId },
        },
        { status: 500, headers: { "x-correlation-id": correlationId } },
    );
}
