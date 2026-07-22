const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

function browserCookie(name: string): string | null {
    if (typeof document === "undefined") return null;
    for (const part of document.cookie.split(";")) {
        const separator = part.indexOf("=");
        if (separator <= 0 || part.slice(0, separator).trim() !== name) continue;
        try {
            return decodeURIComponent(part.slice(separator + 1).trim());
        } catch {
            return null;
        }
    }
    return null;
}

export function withBrowserSecurity(init: RequestInit = {}): RequestInit {
    const method = (init.method ?? "GET").toUpperCase();
    const headers = new Headers(init.headers);
    if (!SAFE_METHODS.has(method) && !headers.has("x-csrf-token")) {
        const csrfToken = browserCookie("__Host-jpp_csrf") ?? browserCookie("jpp_csrf");
        if (csrfToken) headers.set("x-csrf-token", csrfToken);
    }

    return {
        ...init,
        credentials: init.credentials ?? "same-origin",
        headers,
    };
}
