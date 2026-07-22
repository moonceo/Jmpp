"use client";

import { FormEvent, useState } from "react";
import { ArrowRight, Boxes, CheckCircle2, LockKeyhole } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

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
            <section className="relative hidden overflow-hidden bg-[#17231d] px-12 py-12 text-white lg:flex lg:flex-col lg:justify-between">
                <div className="absolute inset-0 opacity-25 [background-image:linear-gradient(rgba(255,255,255,.08)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,.08)_1px,transparent_1px)] [background-size:48px_48px]" />
                <div className="relative flex items-center gap-3 text-sm font-bold tracking-[0.16em] text-[#d9f99d]">
                    <span className="grid size-9 place-items-center rounded-sm border border-[#d9f99d]/40 bg-[#d9f99d]/10">
                        <Boxes className="size-5" />
                    </span>
                    SOURCINGLIFE OMS
                </div>

                <div className="relative max-w-xl">
                    <p className="mb-5 text-xs font-semibold uppercase tracking-[0.22em] text-[#d9f99d]">Seller operations, connected</p>
                    <h1 className="text-5xl font-black leading-[1.08] tracking-[-0.045em]">
                        주문에서 소싱까지,
                        <br />흐름이 끊기지 않게.
                    </h1>
                    <p className="mt-6 max-w-lg text-base leading-7 text-white/65">
                        여러 판매처 주문과 타오바오 옵션 매칭, 구매대행 준비, 송장과 클레임을 한 업무 원장에서 관리합니다.
                    </p>
                </div>

                <div className="relative grid max-w-xl grid-cols-3 gap-3 text-xs text-white/65">
                    {["워크스페이스 격리", "비밀키 암호화", "처리 이력 추적"].map((label) => (
                        <div key={label} className="flex items-center gap-2 border-t border-white/15 pt-3">
                            <CheckCircle2 className="size-4 text-[#d9f99d]" />
                            {label}
                        </div>
                    ))}
                </div>
            </section>

            <section className="flex items-center justify-center px-6 py-12 sm:px-10">
                <div className="w-full max-w-[420px]">
                    <div className="mb-10 lg:hidden">
                        <div className="inline-flex items-center gap-2 text-xs font-bold tracking-[0.14em] text-[#315f46]">
                            <Boxes className="size-5" /> SOURCINGLIFE OMS
                        </div>
                    </div>

                    <div className="mb-8">
                        <div className="mb-4 grid size-11 place-items-center rounded-md border border-[#cfd6ce] bg-white shadow-sm">
                            <LockKeyhole className="size-5 text-[#315f46]" />
                        </div>
                        <h2 className="text-3xl font-black tracking-[-0.04em] text-slate-950">업무 공간 로그인</h2>
                        <p className="mt-2 text-sm leading-6 text-slate-600">회사 워크스페이스와 등록된 운영자 계정으로 접속하세요.</p>
                    </div>

                    <form className="space-y-5" onSubmit={submit}>
                        <div className="space-y-2">
                            <Label htmlFor="workspace" className="text-xs font-bold text-slate-700">워크스페이스</Label>
                            <Input
                                id="workspace"
                                value={workspaceSlug}
                                onChange={(event) => setWorkspaceSlug(event.target.value)}
                                autoComplete="organization"
                                placeholder="예: sourcinglife"
                                className="h-11 bg-white"
                                required
                            />
                        </div>
                        <div className="space-y-2">
                            <Label htmlFor="email" className="text-xs font-bold text-slate-700">이메일</Label>
                            <Input
                                id="email"
                                type="email"
                                value={email}
                                onChange={(event) => setEmail(event.target.value)}
                                autoComplete="username"
                                placeholder="operator@example.com"
                                className="h-11 bg-white"
                                required
                            />
                        </div>
                        <div className="space-y-2">
                            <Label htmlFor="password" className="text-xs font-bold text-slate-700">비밀번호</Label>
                            <Input
                                id="password"
                                type="password"
                                value={password}
                                onChange={(event) => setPassword(event.target.value)}
                                autoComplete="current-password"
                                className="h-11 bg-white"
                                required
                            />
                        </div>

                        {error ? (
                            <div role="alert" className="border-l-2 border-red-500 bg-red-50 px-3 py-2.5 text-sm text-red-800">
                                {error}
                            </div>
                        ) : null}

                        <Button type="submit" disabled={submitting} className="h-11 w-full justify-between bg-[#244c36] px-4 hover:bg-[#193b29]">
                            <span>{submitting ? "확인 중..." : "로그인"}</span>
                            <ArrowRight className="size-4" />
                        </Button>
                    </form>

                    <p className="mt-8 border-t border-slate-200 pt-5 text-xs leading-5 text-slate-500">
                        계정이 없거나 워크스페이스를 모르면 회사 관리자에게 초대를 요청하세요.
                    </p>
                </div>
            </section>
        </div>
    );
}
