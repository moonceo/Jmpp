import { NAVER_COMMERCE_CAPABILITIES } from "@/lib/server/integrations/naver";

type CapabilityMode = "MANUAL_FALLBACK" | "UNSUPPORTED";

function capability(
  action: string,
  mode: CapabilityMode,
  note: string,
): Record<string, unknown> {
  return {
    action,
    mode,
    officialDocumentReviewedAt: NAVER_COMMERCE_CAPABILITIES.checkedAt,
    uatStatus: "NOT_RUN",
    note,
  };
}

/**
 * ACCOUNT_VERIFY proves read authentication only. Write actions deliberately
 * remain fail-closed until a separate, account-specific write UAT promotes
 * the corresponding top-level capability to API/PASSED.
 */
export function buildNaverVerifiedAccountCapabilities(): Record<string, unknown> {
  return {
    ORDER_CONFIRM: capability(
      "ORDER_CONFIRM",
      "MANUAL_FALLBACK",
      "The adapter is implemented, but account-specific write UAT has not run.",
    ),
    INVOICE_SUBMIT: capability(
      "INVOICE_SUBMIT",
      "MANUAL_FALLBACK",
      "The adapter is implemented, but account-specific write UAT has not run.",
    ),
    INVOICE_CORRECT: capability(
      "INVOICE_CORRECT",
      "MANUAL_FALLBACK",
      "Invoice correction requires an account-specific operational UAT.",
    ),
    DIRECT_DELIVERY: capability(
      "DIRECT_DELIVERY",
      "MANUAL_FALLBACK",
      "Direct delivery requires account-specific marketplace UAT.",
    ),
    SELLER_CANCEL: capability(
      "SELLER_CANCEL",
      "MANUAL_FALLBACK",
      "The adapter is implemented, but account-specific seller-cancel UAT has not run.",
    ),
    CANCEL_CLAIM: capability(
      "CANCEL_CLAIM",
      "UNSUPPORTED",
      "The Naver cancellation claim adapter is not implemented.",
    ),
    RETURN_CLAIM: capability(
      "RETURN_CLAIM",
      "UNSUPPORTED",
      "The Naver return claim adapter is not implemented.",
    ),
    EXCHANGE_CLAIM: capability(
      "EXCHANGE_CLAIM",
      "UNSUPPORTED",
      "The Naver exchange claim adapter is not implemented.",
    ),
    adapterManifest: JSON.parse(JSON.stringify(NAVER_COMMERCE_CAPABILITIES)),
  };
}
