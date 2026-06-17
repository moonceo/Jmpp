"use client";

import { useState } from "react";
import { FileSpreadsheet, Filter } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

export default function LedgerPage() {
    const [year, setYear] = useState("2026");
    const [month, setMonth] = useState("6");
    const [onlyConfirmed, setOnlyConfirmed] = useState(true);
    const [excludeCancel, setExcludeCancel] = useState(true);
    const [isGenerating, setIsGenerating] = useState(false);

    const summary = {
        totalOrders: 154,
        totalSales: 4820000,
        totalMargin: 1250000,
        marginRate: 25.9,
    };

    const handleDownload = () => {
        setIsGenerating(true);
        setTimeout(() => {
            setIsGenerating(false);
            toast.success(`장부 다운로드 완료: jumunpangpang_ledger_${year}${month.padStart(2, "0")}.xlsx`);
        }, 1200);
    };

    return (
        <div className="mx-auto w-full max-w-7xl space-y-8 p-6 lg:p-10">
            <div>
                <h1 className="text-3xl font-bold tracking-tight">장부다운로드</h1>
                <p className="mt-2 text-muted-foreground">
                    주문, 정산, 마진 데이터를 기간별로 추출합니다.
                </p>
            </div>

            <div className="flex flex-col gap-6 md:flex-row">
                <Card className="h-fit md:w-[350px]">
                    <CardContent className="space-y-6 p-6">
                        <div className="space-y-4">
                            <h3 className="flex items-center gap-2 font-semibold">
                                <Filter className="h-4 w-4" />
                                데이터 기간 및 필터
                            </h3>

                            <div className="grid grid-cols-2 gap-2">
                                <Select value={year} onValueChange={setYear}>
                                    <SelectTrigger>
                                        <SelectValue placeholder="연도" />
                                    </SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="2026">2026년</SelectItem>
                                        <SelectItem value="2025">2025년</SelectItem>
                                        <SelectItem value="2024">2024년</SelectItem>
                                    </SelectContent>
                                </Select>
                                <Select value={month} onValueChange={setMonth}>
                                    <SelectTrigger>
                                        <SelectValue placeholder="월" />
                                    </SelectTrigger>
                                    <SelectContent>
                                        {Array.from({ length: 12 }, (_, index) => index + 1).map((monthValue) => (
                                            <SelectItem key={monthValue} value={monthValue.toString()}>
                                                {monthValue}월
                                            </SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                            </div>

                            <div className="space-y-4 pt-2">
                                <div className="flex items-center justify-between gap-4">
                                    <Label htmlFor="margin-filter" className="cursor-pointer">
                                        마진 확정 주문만
                                    </Label>
                                    <Switch id="margin-filter" checked={onlyConfirmed} onCheckedChange={setOnlyConfirmed} />
                                </div>
                                <div className="flex items-center justify-between gap-4">
                                    <Label htmlFor="cancel-filter" className="cursor-pointer">
                                        취소/반품 제외
                                    </Label>
                                    <Switch id="cancel-filter" checked={excludeCancel} onCheckedChange={setExcludeCancel} />
                                </div>
                            </div>
                        </div>

                        <Button className="h-12 w-full text-lg" onClick={handleDownload} disabled={isGenerating}>
                            {isGenerating ? (
                                "데이터 추출 중"
                            ) : (
                                "엑셀 다운로드"
                            )}
                        </Button>
                        <p className="text-center text-xs text-muted-foreground">
                            최근 연동된 주문과 소싱라이프 정산 데이터를 기준으로 생성됩니다.
                        </p>
                    </CardContent>
                </Card>

                <div className="flex-1 space-y-6">
                    <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
                        <div className="rounded-lg border bg-white p-4 text-center shadow-sm dark:bg-zinc-900">
                            <div className="mb-1 text-xs text-muted-foreground">총 주문</div>
                            <div className="text-lg font-bold">{summary.totalOrders}건</div>
                        </div>
                        <div className="rounded-lg border bg-white p-4 text-center shadow-sm dark:bg-zinc-900">
                            <div className="mb-1 text-xs text-muted-foreground">총 매출</div>
                            <div className="text-lg font-bold">{summary.totalSales.toLocaleString()}원</div>
                        </div>
                        <div className="rounded-lg border border-blue-100 bg-blue-50 p-4 text-center shadow-sm dark:border-blue-900 dark:bg-blue-900/20">
                            <div className="mb-1 text-xs text-blue-600 dark:text-blue-400">예상 마진</div>
                            <div className="text-lg font-bold text-blue-700 dark:text-blue-300">{summary.totalMargin.toLocaleString()}원</div>
                        </div>
                        <div className="rounded-lg border bg-white p-4 text-center shadow-sm dark:bg-zinc-900">
                            <div className="mb-1 text-xs text-muted-foreground">마진율</div>
                            <div className="text-lg font-bold">{summary.marginRate}%</div>
                        </div>
                    </div>

                    <div className="overflow-hidden rounded-lg border bg-white dark:bg-zinc-900">
                        <div className="flex items-center gap-2 border-b bg-slate-50 p-4 dark:bg-slate-900/50">
                            <FileSpreadsheet className="h-4 w-4 text-green-600" />
                            <span className="text-sm font-medium">추출 데이터 미리보기</span>
                        </div>
                        <Table>
                            <TableHeader>
                                <TableRow>
                                    <TableHead className="w-[110px]">주문일</TableHead>
                                    <TableHead>주문번호</TableHead>
                                    <TableHead>상품명</TableHead>
                                    <TableHead className="text-right">결제금액</TableHead>
                                    <TableHead className="text-right text-blue-600">예상마진</TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                <TableRow>
                                    <TableCell>2026-06-10</TableCell>
                                    <TableCell className="font-mono text-xs">NAVER-20260610-1001</TableCell>
                                    <TableCell className="max-w-[180px] truncate">북유럽 인테리어 TV 거실장 2000</TableCell>
                                    <TableCell className="text-right">159,000원</TableCell>
                                    <TableCell className="text-right font-medium text-blue-600">+42,000원</TableCell>
                                </TableRow>
                                <TableRow>
                                    <TableCell>2026-06-09</TableCell>
                                    <TableCell className="font-mono text-xs">11ST-555555</TableCell>
                                    <TableCell className="max-w-[180px] truncate">캠핑 접이식 경량 체어 1+1</TableCell>
                                    <TableCell className="text-right">90,000원</TableCell>
                                    <TableCell className="text-right font-medium text-blue-600">+18,400원</TableCell>
                                </TableRow>
                                <TableRow>
                                    <TableCell>2026-06-08</TableCell>
                                    <TableCell className="font-mono text-xs">NAVER-PAY-0004</TableCell>
                                    <TableCell className="max-w-[180px] truncate">빈티지 글라스 무드 조명</TableCell>
                                    <TableCell className="text-right">38,000원</TableCell>
                                    <TableCell className="text-right font-medium text-blue-600">+18,600원</TableCell>
                                </TableRow>
                            </TableBody>
                        </Table>
                    </div>
                </div>
            </div>
        </div>
    );
}
