import { getCorrelationId } from "@/lib/server/auth/request-context";
import { jsonResponse } from "@/lib/server/http/api-error";

export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
    const correlationId = getCorrelationId(request);

    return jsonResponse({
        status: "ok",
        probe: "liveness",
        service: "commerce-life",
        timestamp: new Date().toISOString(),
    }, correlationId);
}
