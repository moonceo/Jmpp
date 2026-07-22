# Coupang integration core evidence

Checked against Coupang's public documentation on 2026-07-10. This module is
read-only and intentionally disabled. It is not a credential-verification
worker, sync worker, or enabled market adapter.

## Implemented contracts

| Contract | Evidence | Implementation |
|---|---|---|
| HMAC authorization | [HMAC Signature 생성](https://developers.coupangcorp.com/hc/ko/articles/360033461914-HMAC-Signature-%EC%83%9D%EC%84%B1), [official Node.js examples](https://developers.coupangcorp.com/hc/ko/articles/360042793752-Node-js-Examples) | UTC `yyMMddTHHmmssZ`; message is `datetime + method + path + query` with no `?`; HMAC-SHA256 lowercase hex; `CEA algorithm=HmacSHA256` header. |
| Minute order-sheet read | [발주서 목록 조회(분단위 전체)](https://developers.coupangcorp.com/hc/ko/articles/360033792774-%EB%B0%9C%EC%A3%BC%EC%84%9C-%EB%AA%A9%EB%A1%9D-%EC%A1%B0%ED%9A%8C-%EB%B6%84%EB%8B%A8%EC%9C%84-%EC%A0%84%EC%B2%B4) | `GET /v2/providers/openapi/apis/api/v5/vendors/{vendorId}/ordersheets`; `createdAtFrom`, `createdAtTo`, `searchType=timeFrame`, and an official status; maximum 24-hour window. |
| Single order-sheet read | [발주서 단건 조회(shipmentBoxId)](https://developers.coupangcorp.com/hc/ko/articles/360033792854-%EB%B0%9C%EC%A3%BC%EC%84%9C-%EB%8B%A8%EA%B1%B4-%EC%A1%B0%ED%9A%8C-shipmentBoxId) | `GET /v2/providers/openapi/apis/api/v5/vendors/{vendorId}/ordersheets/{shipmentBoxId}`. |
| Rate-limit classification | [Open API rate-limit policy](https://developers.coupangcorp.com/hc/en-us/articles/20414599556889-Introduction-of-Open-API-rate-limit-policy), [2026 adjustment](https://developers.coupangcorp.com/hc/en-us/articles/56090840760089-Optimization-and-Adjustment-of-Open-API-Rate-Limit-Effective-March-17th-2026) | HTTP 429 is classified as retryable rate limiting and `Retry-After` is preserved when supplied. No automatic retry occurs in the client. Current published baseline is 5 requests/second per vendor, but Coupang may vary it. |

`shipmentBoxId` is now up to 18 digits, so response JSON is parsed losslessly
and marketplace identifiers are returned as decimal strings. Responses are
bounded to 4 MiB by default, requests to 15 seconds, redirects are rejected,
and the temporary transport rejects all non-GET requests.

`verifyOrderReadAccess()` sends one signed, five-minute `ACCEPT` query. A 200
response, including an empty list, proves that the key can read the requested
vendor-scoped endpoint. The response does not independently return a seller
profile, so this must not be described as proof that Coupang returned the
vendor identity.

## Remaining blockers before enablement

- No Coupang sandbox is documented; test with an approved Wing business seller.
- Verify outbound IP/integrator registration, clock synchronization, key expiry,
  revocation, and rotation with a real account.
- UAT empty and populated minute windows for every official order status,
  receiver changes after acknowledgement, split shipments, and 18-digit IDs.
- Measure real response sizes and observed 429/403 headers; add the shared
  vendor/endpoint limiter and circuit breaker before a sync worker is enabled.
- Encrypt and lifecycle-manage credentials in the market-account verifier;
  persist PII only through the encrypted order ingestion pipeline.
- Day paging, orderId lookup, claims, acknowledgement, invoices, direct
  delivery, and every write remain unimplemented and require separate contract
  verification and UAT.
- Keep `IMPLEMENTED_MARKET_ADAPTERS` NAVER-only and do not wire this client to
  account creation until the credential verifier and idempotent sync worker ship.
