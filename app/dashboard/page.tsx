"use client";

import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { AnnouncementsWidget } from "@/components/shared/announcements-widget";
import { MonthlyStatsControl } from "@/components/shared/monthly-stats-control";
import { PageHeader } from "@/components/shared/page-header";
import { PendingTasks } from "@/components/shared/pending-tasks";
import { SalesCalendar } from "@/components/shared/sales-calendar";
import { SalesSummary } from "@/components/shared/sales-summary";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export default function DashboardPage() {
    return (
        <div className="min-h-full space-y-6 p-4 sm:p-6 lg:p-8">
            <PageHeader
                title="대시보드"
                eyebrow="COMMERCE LIFE · OPERATIONS"
                description="주문 처리량과 마진, 남은 작업, 운영 공지를 한눈에 확인합니다."
                actions={(
                    <Button asChild>
                        <Link href="/journey">
                            주문현황 보기
                            <ArrowRight />
                        </Link>
                    </Button>
                )}
            />

            <Card className="gap-0 overflow-hidden py-0">
                <CardHeader className="border-b p-4 sm:p-5">
                    <CardTitle>월별 통계</CardTitle>
                    <CardDescription>확정 마진과 취소·반품, 직접 입력 비용을 같은 기준으로 비교합니다.</CardDescription>
                </CardHeader>
                <CardContent className="p-4 sm:p-5">
                    <MonthlyStatsControl />
                    <SalesSummary />
                </CardContent>
            </Card>

            <section className="space-y-3" aria-labelledby="pending-work-title">
                <div>
                    <h2 id="pending-work-title" className="text-lg font-bold">남은 작업</h2>
                    <p className="mt-1 text-sm text-muted-foreground">처리가 필요한 주문 작업함으로 바로 이동합니다.</p>
                </div>
                <PendingTasks />
            </section>

            <div className="grid min-w-0 gap-6 xl:grid-cols-[minmax(0,2fr)_minmax(320px,1fr)]">
                <SalesCalendar />
                <AnnouncementsWidget />
            </div>
        </div>
    );
}
