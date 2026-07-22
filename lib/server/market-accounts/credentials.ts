import { z } from "zod";

export const naverCredentialsSchema = z.object({
    clientId: z.string().trim().min(1).max(300),
    clientSecret: z.string().min(1).max(1000),
    type: z.enum(["SELF", "SELLER"]).default("SELF"),
    accountId: z.string().trim().min(1).max(300).optional(),
}).strict().superRefine((value, context) => {
    if (value.type === "SELLER" && !value.accountId) {
        context.addIssue({
            code: "custom",
            path: ["accountId"],
            message: "SELLER 자격증명에는 accountId가 필요합니다.",
        });
    }
});

export type NaverCredentialsInput = z.infer<typeof naverCredentialsSchema>;
