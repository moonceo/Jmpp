import { z } from "zod";
import { browserSessionSetCookieHeaders } from "@/lib/server/auth/browser-session";
import { createPasswordBrowserSession } from "@/lib/server/auth/password-login";
import { getCorrelationId } from "@/lib/server/auth/request-context";
import { errorResponse, jsonResponse, parseJsonBody } from "@/lib/server/http/api-error";

const loginSchema = z.object({
    workspaceSlug: z.string().trim().min(1).max(63).regex(/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/i),
    email: z.string().trim().email().max(254),
    password: z.string().min(1).max(1024).refine(
        (value) => Buffer.byteLength(value, "utf8") <= 72,
        { message: "비밀번호는 UTF-8 기준 72바이트 이하여야 합니다." },
    ),
}).strict();

export async function POST(request: Request): Promise<Response> {
    const correlationId = getCorrelationId(request);

    try {
        const body = await parseJsonBody(request, loginSchema, 8_192);
        const session = await createPasswordBrowserSession({
            ...body,
            correlationId,
        });
        const response = jsonResponse({
            tenantId: session.tenantId,
            userId: session.userId,
            expiresAt: session.expiresAt,
        }, correlationId);
        response.headers.set("cache-control", "no-store");
        for (const cookie of browserSessionSetCookieHeaders(
            session.sessionToken,
            session.csrfToken,
            session.maxAgeSeconds,
        )) {
            response.headers.append("set-cookie", cookie);
        }
        return response;
    } catch (error) {
        return errorResponse(error, correlationId);
    }
}
