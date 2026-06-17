"use client";

import { useState } from "react";
import { CheckCircle2, Settings, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { MARKET_LABELS } from "@/lib/constants/orders";

type MarketAccount = {
    id: string;
    market: "naver" | "coupang" | "11st" | "gmarket" | "auction";
    storeName: string;
    sellerAccount: string;
    authStatus: "connected";
    active: boolean;
    lastCollectedAt: string;
    lastResult: "success" | "failed";
    feeRate: number;
};

const initialAccounts: MarketAccount[] = [
    {
        id: "acct-01",
        market: "naver",
        storeName: "리빙온마켓",
        sellerAccount: "naver_living_01",
        authStatus: "connected",
        active: true,
        lastCollectedAt: "2026-06-15 09:42",
        lastResult: "success",
        feeRate: 3.6,
    },
    {
        id: "acct-02",
        market: "naver",
        storeName: "홈데코랩",
        sellerAccount: "naver_home_02",
        authStatus: "connected",
        active: true,
        lastCollectedAt: "2026-06-15 09:39",
        lastResult: "success",
        feeRate: 3.8,
    },
    {
        id: "acct-03",
        market: "coupang",
        storeName: "쿠팡라이프샵",
        sellerAccount: "coupang_wing_01",
        authStatus: "connected",
        active: true,
        lastCollectedAt: "2026-06-15 09:36",
        lastResult: "success",
        feeRate: 10.8,
    },
    {
        id: "acct-04",
        market: "coupang",
        storeName: "스마트홈셀러",
        sellerAccount: "coupang_wing_02",
        authStatus: "connected",
        active: true,
        lastCollectedAt: "2026-06-15 09:10",
        lastResult: "success",
        feeRate: 10.8,
    },
    {
        id: "acct-05",
        market: "11st",
        storeName: "글로벌픽스토어",
        sellerAccount: "11st_global_01",
        authStatus: "connected",
        active: true,
        lastCollectedAt: "2026-06-15 09:32",
        lastResult: "success",
        feeRate: 13,
    },
    {
        id: "acct-06",
        market: "11st",
        storeName: "홈앤키친11",
        sellerAccount: "11st_home_02",
        authStatus: "connected",
        active: true,
        lastCollectedAt: "2026-06-15 09:28",
        lastResult: "success",
        feeRate: 13,
    },
    {
        id: "acct-07",
        market: "gmarket",
        storeName: "지마켓리빙박스",
        sellerAccount: "gmarket_living_01",
        authStatus: "connected",
        active: true,
        lastCollectedAt: "2026-06-15 09:24",
        lastResult: "success",
        feeRate: 12,
    },
    {
        id: "acct-08",
        market: "gmarket",
        storeName: "데일리홈마켓",
        sellerAccount: "gmarket_home_02",
        authStatus: "connected",
        active: true,
        lastCollectedAt: "2026-06-15 09:21",
        lastResult: "success",
        feeRate: 12,
    },
    {
        id: "acct-09",
        market: "auction",
        storeName: "옥션리빙셀렉트",
        sellerAccount: "auction_living_01",
        authStatus: "connected",
        active: true,
        lastCollectedAt: "2026-06-15 09:18",
        lastResult: "success",
        feeRate: 12,
    },
    {
        id: "acct-10",
        market: "auction",
        storeName: "하우스웨어옥션",
        sellerAccount: "auction_home_02",
        authStatus: "connected",
        active: true,
        lastCollectedAt: "2026-06-15 09:15",
        lastResult: "success",
        feeRate: 12,
    },
];

const authLabel = {
    connected: "연동 완료",
};

export default function MarketsPage() {
    const [accounts, setAccounts] = useState(initialAccounts);

    const updateFee = (id: string, value: string) => {
        const feeRate = Number(value);
        if (Number.isNaN(feeRate)) return;
        setAccounts((current) => current.map((account) => account.id === id ? { ...account, feeRate } : account));
    };

    const toggleActive = (id: string, active: boolean) => {
        setAccounts((current) => current.map((account) => account.id === id ? { ...account, active } : account));
    };

    return (
        <div className="max-w-7xl space-y-6">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                <div>
                    <h1 className="text-3xl font-bold tracking-tight">마켓 설정</h1>
                    <p className="mt-2 text-sm text-muted-foreground">
                        연동 완료된 네이버, 쿠팡, 11번가, 지마켓, 옥션 계정의 수집 설정을 관리합니다.
                    </p>
                </div>
                <Button onClick={() => toast.success("마켓 설정을 저장했습니다.")}>
                    설정 저장
                </Button>
            </div>

            <div className="grid gap-3 md:grid-cols-4">
                <Metric label="연동 계정" value={`${accounts.length}개`} />
                <Metric label="활성 계정" value={`${accounts.filter((account) => account.active).length}개`} />
                <Metric label="연동 완료" value={`${accounts.filter((account) => account.authStatus === "connected").length}개`} />
                <Metric label="수집 실패" value={`${accounts.filter((account) => account.lastResult === "failed").length}개`} />
            </div>

            <Card className="overflow-hidden p-0">
                <CardHeader className="border-b bg-slate-50 py-4">
                    <CardTitle className="text-base">마켓 계정 설정</CardTitle>
                </CardHeader>
                <CardContent className="p-0">
                    <div className="overflow-x-auto">
                        <Table>
                            <TableHeader>
                                <TableRow className="bg-muted/50">
                                    <TableHead>판매처</TableHead>
                                    <TableHead>계정 이름</TableHead>
                                    <TableHead>판매자 계정명</TableHead>
                                    <TableHead>연동상태</TableHead>
                                    <TableHead>활성 여부</TableHead>
                                    <TableHead>마지막 수집시각</TableHead>
                                    <TableHead>수집 결과</TableHead>
                                    <TableHead>마켓수수료율</TableHead>
                                    <TableHead className="text-right">관리</TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {accounts.map((account) => (
                                    <TableRow key={account.id}>
                                        <TableCell className="whitespace-nowrap font-medium">{MARKET_LABELS[account.market]}</TableCell>
                                        <TableCell className="whitespace-nowrap font-mono text-xs">{account.storeName}</TableCell>
                                        <TableCell className="whitespace-nowrap font-mono text-xs">{account.sellerAccount}</TableCell>
                                        <TableCell>
                                            <Badge variant="outline" className="border-emerald-200 bg-emerald-50 text-emerald-700">
                                                <CheckCircle2 className="mr-1 h-3.5 w-3.5" />
                                                {authLabel[account.authStatus]}
                                            </Badge>
                                        </TableCell>
                                        <TableCell>
                                            <Switch checked={account.active} onCheckedChange={(checked) => toggleActive(account.id, checked)} />
                                        </TableCell>
                                        <TableCell className="whitespace-nowrap text-xs">{account.lastCollectedAt}</TableCell>
                                        <TableCell>
                                            <Badge variant="outline" className="border-emerald-200 bg-emerald-50 text-emerald-700">성공</Badge>
                                        </TableCell>
                                        <TableCell>
                                            <div className="flex items-center gap-1">
                                                <Input className="h-8 w-20 text-right" value={account.feeRate} onChange={(event) => updateFee(account.id, event.target.value)} />
                                                <span className="text-xs text-muted-foreground">%</span>
                                            </div>
                                        </TableCell>
                                        <TableCell className="text-right">
                                            <Button variant="ghost" size="icon" onClick={() => toast.info("계정 설정을 엽니다.")}>
                                                <Settings className="h-4 w-4" />
                                                <span className="sr-only">설정</span>
                                            </Button>
                                            <Button variant="ghost" size="icon" onClick={() => toast.info("계정 삭제 확인이 필요합니다.")}>
                                                <Trash2 className="h-4 w-4" />
                                                <span className="sr-only">삭제</span>
                                            </Button>
                                        </TableCell>
                                    </TableRow>
                                ))}
                            </TableBody>
                        </Table>
                    </div>
                </CardContent>
            </Card>
        </div>
    );
}

function Metric({ label, value }: { label: string; value: string }) {
    return (
        <div className="rounded-lg border bg-white px-4 py-3">
            <div className="text-xs font-medium text-muted-foreground">{label}</div>
            <div className="mt-1 text-2xl font-bold">{value}</div>
        </div>
    );
}
