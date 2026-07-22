import { Buffer } from "node:buffer";

import { hash } from "bcryptjs";

import {
    errorMessage,
    failureResult,
    successResult,
    type HttpTransport,
    type IntegrationResult,
    type IntegrationSuccess,
} from "../core";
import type {
    NaverAccessToken,
    NaverClientSecretSigner,
    NaverCommerceCredentials,
    NaverOAuthTokenResponse,
} from "./types";

export const NAVER_COMMERCE_API_BASE_URL =
    "https://api.commerce.naver.com/external";

const DEFAULT_CACHE_SKEW_MS = 60_000;

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

function apiUrl(baseUrl: string, path: string): string {
    return `${baseUrl.replace(/\/+$/, "")}/${path.replace(/^\/+/, "")}`;
}

export const createNaverClientSecretSign: NaverClientSecretSigner = async ({
    clientId,
    clientSecret,
    timestamp,
}) => {
    const bcryptDigest = await hash(`${clientId}_${timestamp}`, clientSecret);
    return Buffer.from(bcryptDigest, "utf8").toString("base64");
};

export interface NaverTokenProviderOptions {
    credentials: NaverCommerceCredentials;
    transport: HttpTransport;
    signer?: NaverClientSecretSigner;
    baseUrl?: string;
    now?: () => number;
    cacheSkewMs?: number;
}

export class NaverTokenProvider {
    private readonly credentials: NaverCommerceCredentials;
    private readonly transport: HttpTransport;
    private readonly signer: NaverClientSecretSigner;
    private readonly baseUrl: string;
    private readonly now: () => number;
    private readonly cacheSkewMs: number;
    private cached?: IntegrationSuccess<NaverAccessToken>;
    private cacheValidUntilMs = 0;
    private inFlight?: Promise<IntegrationResult<NaverAccessToken>>;

    constructor(options: NaverTokenProviderOptions) {
        this.credentials = options.credentials;
        this.transport = options.transport;
        this.signer = options.signer ?? createNaverClientSecretSign;
        this.baseUrl = options.baseUrl ?? NAVER_COMMERCE_API_BASE_URL;
        this.now = options.now ?? Date.now;
        this.cacheSkewMs = options.cacheSkewMs ?? DEFAULT_CACHE_SKEW_MS;
    }

    invalidate(): void {
        this.cached = undefined;
        this.cacheValidUntilMs = 0;
    }

    async getAccessToken(
        options: { forceRefresh?: boolean } = {},
    ): Promise<IntegrationResult<NaverAccessToken>> {
        if (
            !options.forceRefresh &&
            this.cached &&
            this.now() < this.cacheValidUntilMs
        ) {
            return this.cached;
        }

        if (this.inFlight) {
            return this.inFlight;
        }

        this.inFlight = this.issueAccessToken();
        try {
            return await this.inFlight;
        } finally {
            this.inFlight = undefined;
        }
    }

    private async issueAccessToken(): Promise<IntegrationResult<NaverAccessToken>> {
        const validationError = this.validateCredentials();
        if (validationError) {
            return failureResult({
                kind: "configuration",
                code: "INVALID_NAVER_CREDENTIALS",
                message: validationError,
                retryable: false,
            });
        }

        const issuedAtMs = this.now();
        let clientSecretSign: string;

        try {
            clientSecretSign = await this.signer({
                clientId: this.credentials.clientId,
                clientSecret: this.credentials.clientSecret,
                timestamp: issuedAtMs,
            });
        } catch (cause) {
            return failureResult({
                kind: "configuration",
                code: "NAVER_SIGNATURE_FAILED",
                message: `네이버 전자서명 생성에 실패했습니다: ${errorMessage(cause)}`,
                retryable: false,
                cause,
            });
        }

        const resourceType = this.credentials.type ?? "SELF";
        const form = new URLSearchParams({
            client_id: this.credentials.clientId,
            timestamp: String(issuedAtMs),
            grant_type: "client_credentials",
            client_secret_sign: clientSecretSign,
            type: resourceType,
        });
        if (resourceType === "SELLER") {
            form.set("account_id", this.credentials.accountId!);
        }

        const response = await this.transport.request<NaverOAuthTokenResponse>({
            method: "POST",
            url: apiUrl(this.baseUrl, "/v1/oauth2/token"),
            form,
        });
        if (!response.ok) {
            return response;
        }

        const body = response.data;
        if (
            !isRecord(body) ||
            typeof body.access_token !== "string" ||
            body.access_token.length === 0 ||
            typeof body.token_type !== "string" ||
            body.token_type.length === 0 ||
            typeof body.expires_in !== "number" ||
            !Number.isFinite(body.expires_in) ||
            body.expires_in <= 0
        ) {
            return failureResult(
                {
                    kind: "unexpected_response",
                    code: "INVALID_NAVER_TOKEN_RESPONSE",
                    message: "네이버 토큰 응답 형식이 올바르지 않습니다.",
                    retryable: false,
                    details: body,
                },
                response.raw,
            );
        }

        const lifetimeMs = body.expires_in * 1_000;
        const expiresAtMs = issuedAtMs + lifetimeMs;
        const token: NaverAccessToken = {
            accessToken: body.access_token,
            tokenType: body.token_type,
            expiresInSeconds: body.expires_in,
            issuedAtMs,
            expiresAtMs,
        };
        const result = successResult(token, response.raw);

        this.cached = result;
        this.cacheValidUntilMs =
            expiresAtMs - Math.min(this.cacheSkewMs, lifetimeMs * 0.1);

        return result;
    }

    private validateCredentials(): string | undefined {
        if (!this.credentials.clientId.trim()) {
            return "clientId가 필요합니다.";
        }
        if (!this.credentials.clientSecret.trim()) {
            return "clientSecret이 필요합니다.";
        }
        if (
            (this.credentials.type ?? "SELF") === "SELLER" &&
            !this.credentials.accountId?.trim()
        ) {
            return "type이 SELLER이면 accountId가 필요합니다.";
        }
        if (!Number.isFinite(this.cacheSkewMs) || this.cacheSkewMs < 0) {
            return "cacheSkewMs는 0 이상의 유한한 숫자여야 합니다.";
        }
        return undefined;
    }
}

