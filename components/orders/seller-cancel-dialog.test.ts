import { describe, expect, it } from "vitest";
import {
    NAVER_SELLER_CANCEL_REASON_OPTIONS,
    buildSellerCancelCommandPayload,
    validateSellerCancelDraft,
    type SellerCancelSubmitResult,
} from "@/components/orders/seller-cancel-dialog";
import { NAVER_SELLER_CANCEL_REASONS } from "@/lib/server/integrations/naver/types";

describe("seller cancel intent validation", () => {
    it("supports a retained inline failure result for partial bulk submissions", () => {
        const result: SellerCancelSubmitResult = {
            accepted: false,
            message: "1건 접수, 1건 실패했습니다. 실패 주문: ORD-2: UAT 미승인",
        };

        expect(result).toMatchObject({ accepted: false });
        expect(result.message).toContain("ORD-2");
    });

    it("omits cancel quantity for a full cancellation command", () => {
        expect(buildSellerCancelCommandPayload({
            reasonCode: "SOLD_OUT",
            reasonDetail: "공급처 품절 확인",
            quantity: 3,
        }, 3)).toEqual({
            reasonCode: "SOLD_OUT",
            reasonDetail: "공급처 품절 확인",
        });
        expect(buildSellerCancelCommandPayload({
            reasonCode: "SOLD_OUT",
            reasonDetail: "공급처 일부 품절",
            quantity: 2,
        }, 3)).toMatchObject({ quantity: 2 });
    });

    it("exposes exactly the seven current Naver cancellation reasons", () => {
        expect(NAVER_SELLER_CANCEL_REASON_OPTIONS.map((option) => option.value))
            .toEqual(NAVER_SELLER_CANCEL_REASONS);
    });

    it("builds a trimmed official payload with a bounded partial quantity", () => {
        expect(validateSellerCancelDraft({
            reasonCode: "SOLD_OUT",
            reasonDetail: "  공급처\n품절 확인  ",
            quantity: "2",
            orderedQuantity: 3,
        })).toEqual({
            ok: true,
            value: {
                reasonCode: "SOLD_OUT",
                reasonDetail: "공급처 품절 확인",
                quantity: 2,
            },
        });
    });

    it("rejects an unofficial reason and missing operational detail", () => {
        expect(validateSellerCancelDraft({
            reasonCode: "SELLER_REQUEST",
            reasonDetail: " ",
            quantity: "1",
            orderedQuantity: 1,
        })).toMatchObject({
            ok: false,
            errors: {
                reasonCode: expect.any(String),
                reasonDetail: expect.any(String),
            },
        });
    });

    it.each(["0", "1.5", "4", "not-a-number"])(
        "rejects invalid or excessive quantity %s",
        (quantity) => {
            expect(validateSellerCancelDraft({
                reasonCode: "SOLD_OUT",
                reasonDetail: "공급처 품절 확인",
                quantity,
                orderedQuantity: 3,
            })).toMatchObject({
                ok: false,
                errors: { quantity: expect.any(String) },
            });
        },
    );

    it("omits quantity only for a bulk draft that will be expanded per order", () => {
        expect(validateSellerCancelDraft({
            reasonCode: "DELAYED_DELIVERY",
            reasonDetail: "공급처 출고 일정 지연",
            quantity: null,
            orderedQuantity: null,
        })).toEqual({
            ok: true,
            value: {
                reasonCode: "DELAYED_DELIVERY",
                reasonDetail: "공급처 출고 일정 지연",
            },
        });
    });

    it("rejects an order quantity outside the server command bound", () => {
        expect(validateSellerCancelDraft({
            reasonCode: "SOLD_OUT",
            reasonDetail: "공급처 품절 확인",
            quantity: "100001",
            orderedQuantity: 100001,
        })).toMatchObject({
            ok: false,
            errors: { quantity: expect.any(String) },
        });
    });
});
