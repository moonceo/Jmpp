"use client";

import { FormEvent, useState } from "react";
import { ArrowRight, Boxes, CheckCircle2, LockKeyhole } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Card, CardContent } from "@/components/ui/card";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";

interface LoginErrorPayload {
    error?: { message?: string };
}

function nextPath(): string {
    if (typeof window === "undefined") return "/orders";
    const candidate = new URLSearchParams(window.location.search).get("next");
    return candidate?.startsWith("/") && !candidate.startsWith("//")
        ? candidate
        : "/orders";
}

export default function LoginPage() {
    const [workspaceSlug, setWorkspaceSlug] = useState("");
    const [email, setEmail] = useState("");
    const [password, setPassword] = useState("");
    const [error, setError] = useState<string | null>(null);
    const [submitting, setSubmitting] = useState(false);

    const submit = async (event: FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        setError(null);
        setSubmitting(true);
        try {
            const response = await fetch("/api/auth/login", {
                method: "POST",
                credentials: "same-origin",
                headers: { "content-type": "application/json" },
                body: JSON.stringify({ workspaceSlug, email, password }),
            });
            const payload = await response.json().catch(() => null) as LoginErrorPayload | null;
            if (!response.ok) {
                throw new Error(payload?.error?.message ?? "로그인 요청을 처리하지 못했습니다.");
            }
            window.location.assign(nextPath());
        } catch (caught) {
            setError(caught instanceof Error ? caught.message : "로그인 요청을 처리하지 못했습니다.");
        } finally {
            setSubmitting(false);
        }
    };

    return (
        <div className="grid min-h-svh lg:grid-cols-[minmax(0,1.05fr)_minmax(420px,0.95fr)]">
            <section className="relative hidden overflow-hidden bg-primary px-12 py-12 text-primary-foreground lg:flex lg:flex-col lg:justify-between">
                <div className="relative flex items-center gap-3 text-sm font-bold tracking-[0.16em] text-primary-foreground">
                    <span className="grid size-9 place-items-center rounded-sm border border-primary-foreground/30 bg-primary-foreground/10">
                        <Boxes className="size-5" />
                    </span>
                    COMMERCE LIFE
                </div>

                <div className="relative max-w-xl">
                    <p className="mb-5 text-xs font-semibold uppercase tracking-[0.22em] text-primary-foreground/70">Seller operations, connected</p>
                    <h1 className="text-5xl font-black leading-[1.08] tracking-[-0.045em]">
                        주문에서 소싱까지,
                        <br />흐름이 끊기지 않게.
                    </h1>
                    <p className="mt-6 max-w-lg text-base leading-7 text-primary-foreground/65">
                        여러 판매처 주문과 타오바오 옵션 매칭, 구매대행 준비, 송장과 클레임을 한 업무 원장에서 관리합니다.
                    </p>
                </div>

                <div className="relative grid max-w-xl grid-cols-3 gap-3 text-xs text-primary-foreground/65">
                    {["워크스페이스 격리", "비밀키 암호화", "처리 이력 추적"].map((label) => (
                        <div key={label} className="flex items-center gap-2 border-t border-border/15 pt-3">
                            <CheckCircle2 className="size-4 text-primary-foreground" />
                            {label}
                        </div>
                    ))}
                </div>
            </section>

            <section className="flex items-center justify-center px-6 py-12 sm:px-10">
                <Card className="w-full max-w-md gap-0 py-0">
                    <CardContent className="p-6 sm:p-8">
                    <div className="mb-10 lg:hidden">
                        <div className="inline-flex items-center gap-2 text-xs font-bold tracking-[0.14em] text-foreground">
                            <Boxes className="size-5" /> COMMERCE LIFE
                        </div>
                    </div>

                    <div className="mb-8">
                        <div className="mb-4 grid size-11 place-items-center rounded-md border border-border bg-card shadow-sm">
                            <LockKeyhole className="size-5 text-foreground" />
                        </div>
                        <h2 className="text-3xl font-black tracking-[-0.04em] text-foreground">업무 공간 로그인</h2>
                        <p className="mt-2 text-sm leading-6 text-muted-foreground">회사 워크스페이스와 등록된 운영자 계정으로 접속하세요.</p>
                    </div>

                    <form className="space-y-5" onSubmit={submit}>
                        <FieldGroup className="gap-5">
                        <Field>
                            <FieldLabel htmlFor="workspace">워크스페이스</FieldLabel>
                            <Input
                                id="workspace"
                                value={workspaceSlug}
                                onChange={(event) => setWorkspaceSlug(event.target.value)}
                                autoComplete="organization"
                                placeholder="예: sourcinglife"
                                className="h-11 bg-card"
                                required
                            />
                        </Field>
                        <Field>
                            <FieldLabel htmlFor="email">이메일</FieldLabel>
                            <Input
                                id="email"
                                type="email"
                                value={email}
                                onChange={(event) => setEmail(event.target.value)}
                                autoComplete="username"
                                placeholder="operator@example.com"
                                className="h-11 bg-card"
                                required
                            />
                        </Field>
                        <Field>
                            <FieldLabel htmlFor="password">비밀번호</FieldLabel>
                            <Input
                                id="password"
                                type="password"
                                value={password}
                                onChange={(event) => setPassword(event.target.value)}
                                autoComplete="current-password"
                                className="h-11 bg-card"
                                required
                            />
                        </Field>

                        {error ? (
                            <Alert>
                                <AlertDescription>{error}</AlertDescription>
                            </Alert>
                        ) : null}

                        <Button type="submit" disabled={submitting} className="h-11 w-full justify-between px-4">
                            <span>{submitting ? "확인 중..." : "로그인"}</span>
                            <ArrowRight className="size-4" />
                        </Button>
                        </FieldGroup>
                    </form>

                    <p className="mt-8 border-t border-border pt-5 text-xs leading-5 text-muted-foreground">
                        계정이 없거나 워크스페이스를 모르면 회사 관리자에게 초대를 요청하세요.
                    </p>
                    </CardContent>
                </Card>
            </section>
        </div>
    );
}
