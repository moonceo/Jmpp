import { NextRequest, NextResponse } from "next/server";
import {
    browserSessionCookieNames,
    verifyBrowserSessionToken,
} from "@/lib/server/auth/browser-session";

function hasValidBrowserSession(request: NextRequest): boolean {
    try {
        const cookieName = browserSessionCookieNames(process.env).session;
        verifyBrowserSessionToken(request.cookies.get(cookieName)?.value ?? null);
        return true;
    } catch {
        return false;
    }
}

export function proxy(request: NextRequest): NextResponse {
    const insecureDevelopment = process.env.NODE_ENV !== "production"
        && process.env.ALLOW_INSECURE_DEV_AUTH === "true";
    const authenticated = insecureDevelopment
        || Boolean(request.headers.get("x-internal-auth-context"))
        || hasValidBrowserSession(request);

    if (request.nextUrl.pathname === "/login") {
        // A signed cookie may already be revoked in PostgreSQL. Always allow
        // recovery through login; a successful login overwrites stale cookies.
        return NextResponse.next();
    }
    if (authenticated) return NextResponse.next();

    const loginUrl = new URL("/login", request.url);
    loginUrl.searchParams.set("next", `${request.nextUrl.pathname}${request.nextUrl.search}`);
    return NextResponse.redirect(loginUrl);
}

export const config = {
    matcher: [
        "/((?!api|_next|favicon.ico|.*\\.(?:svg|png|jpe?g|gif|webp|ico|css|js|map|woff2?|txt|xml)$).*)",
    ],
};
