"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Search, MessageSquare, CheckCircle2, Store } from "lucide-react";
import { InquiryListItem } from "@/components/inquiries/inquiry-list-item";
import { ReplyModal } from "@/components/inquiries/reply-modal";
import { mockInquiries, mockInquiryStats } from "@/lib/mock-data/inquiries";
import { Inquiry } from "@/types/inquiry";
import { toast } from "sonner";
import { format } from "date-fns";
import {
    Tooltip,
    TooltipContent,
    TooltipProvider,
    TooltipTrigger,
} from "@/components/ui/tooltip";

export default function InquiriesPage() {
    const [activeTab, setActiveTab] = useState("waiting");
    const [selectedInquiry, setSelectedInquiry] = useState<Inquiry | null>(null);
    const [isReplyModalOpen, setIsReplyModalOpen] = useState(false);
    const [isSyncing, setIsSyncing] = useState(false);

    // Data State (Mock)
    const [inquiries, setInquiries] = useState<Inquiry[]>(mockInquiries);
    const filteredInquiries = inquiries.filter(i => i.status === activeTab);

    // Handlers
    const handleSync = () => {
        setIsSyncing(true);
        setTimeout(() => {
            setIsSyncing(false);
            toast.success("3건의 새로운 문의를 가져왔습니다.");
            // In real app, refetch data here
        }, 1500);
    };

    const handleReplyClick = (inquiry: Inquiry) => {
        setSelectedInquiry(inquiry);
        setIsReplyModalOpen(true);
    };

    const handleConfirmReply = (inquiryId: string, content: string) => {
        // Determine the next status based on API logic (for mock, just move to answered)
        setInquiries(prev => prev.map(item =>
            item.id === inquiryId
                ? { ...item, status: 'answered', replyContent: content, repliedAt: format(new Date(), "yyyy-MM-dd HH:mm") }
                : item
        ));
        toast.success("답변이 성공적으로 전송되었습니다.");
    };

    return (
        <div className="space-y-6">
            {/* 1. Page Header */}
            <div>
                <h1 className="text-3xl font-bold tracking-tight">문의관리</h1>
                <p className="text-muted-foreground mt-2">
                    여러 마켓의 고객 문의를 한 곳에서 관리하세요.
                </p>
            </div>

            {/* 2. CS Dashboard */}
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
                <Card>
                    <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                        <CardTitle className="text-sm font-medium">미답변 문의</CardTitle>
                        <div className="h-2 w-2 rounded-full bg-red-500 animate-pulse" />
                    </CardHeader>
                    <CardContent>
                        <div className="text-2xl font-bold">{mockInquiryStats.unansweredCount}건</div>
                        <p className="text-xs text-muted-foreground">신속한 응대가 필요합니다</p>
                    </CardContent>
                </Card>
                <Card>
                    <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                        <CardTitle className="text-sm font-medium">답변 완료</CardTitle>
                        <CheckCircle2 className="h-4 w-4 text-green-500" />
                    </CardHeader>
                    <CardContent>
                        <div className="text-2xl font-bold">{mockInquiryStats.answeredCount}건</div>
                        <p className="text-xs text-muted-foreground">이번 달 처리 완료</p>
                    </CardContent>
                </Card>
                <Card>
                    <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                        <CardTitle className="text-sm font-medium">전체 문의</CardTitle>
                        <MessageSquare className="h-4 w-4 text-muted-foreground" />
                    </CardHeader>
                    <CardContent>
                        <div className="text-2xl font-bold">{mockInquiryStats.totalCount.toLocaleString()}건</div>
                        <p className="text-xs text-muted-foreground">누적 수집 문의</p>
                    </CardContent>
                </Card>
                <Card>
                    <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                        <CardTitle className="text-sm font-medium">연동 스토어</CardTitle>
                        <Store className="h-4 w-4 text-muted-foreground" />
                    </CardHeader>
                    <CardContent>
                        <div className="text-2xl font-bold">{mockInquiryStats.connectedStores}개</div>
                        <p className="text-xs text-muted-foreground opacity-80">모두 정상 연결됨</p>
                    </CardContent>
                </Card>
            </div>

            {/* 3. Control Bar */}
            <div className="flex flex-col sm:flex-row gap-4 items-start sm:items-center justify-between bg-white dark:bg-zinc-900 p-4 rounded-lg border shadow-sm">
                <div className="flex items-center gap-2 w-full sm:w-auto">
                    <TooltipProvider>
                        <Tooltip>
                            <TooltipTrigger asChild>
                                <Button
                                    variant={isSyncing ? "secondary" : "default"}
                                    onClick={handleSync}
                                    disabled={isSyncing}
                                    className="min-w-[140px]"
                                >
                                    {isSyncing ? "동기화 중..." : "문의 불러오기"}
                                </Button>
                            </TooltipTrigger>
                            <TooltipContent>
                                <p className="text-xs">마지막 업데이트: 방금 전</p>
                            </TooltipContent>
                        </Tooltip>
                    </TooltipProvider>
                </div>

                <div className="flex items-center gap-2 w-full sm:w-auto">
                    <Select defaultValue="1month">
                        <SelectTrigger className="w-[130px]">
                            <SelectValue placeholder="기간 선택" />
                        </SelectTrigger>
                        <SelectContent>
                            <SelectItem value="1week">최근 1주일</SelectItem>
                            <SelectItem value="1month">최근 1개월</SelectItem>
                            <SelectItem value="3months">최근 3개월</SelectItem>
                        </SelectContent>
                    </Select>
                    <div className="relative w-full sm:w-[240px]">
                        <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                        <Input placeholder="문의 내용, 주문번호..." className="pl-9" />
                    </div>
                </div>
            </div>

            {/* 4. Inquiry List & Tabs */}
            <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-4">
                <TabsList>
                    <TabsTrigger value="waiting" className="relative">
                        미답변
                        {mockInquiryStats.unansweredCount > 0 && (
                            <span className="ml-2 bg-red-100 text-red-600 px-1.5 py-0.5 rounded-full text-[10px] font-bold">
                                {mockInquiryStats.unansweredCount}
                            </span>
                        )}
                    </TabsTrigger>
                    <TabsTrigger value="answered">답변완료</TabsTrigger>
                </TabsList>

                <TabsContent value="waiting" className="space-y-4">
                    {filteredInquiries.length > 0 ? (
                        filteredInquiries.map(inquiry => (
                            <InquiryListItem
                                key={inquiry.id}
                                inquiry={inquiry}
                                onReply={handleReplyClick}
                            />
                        ))
                    ) : (
                        <EmptyState tab="waiting" />
                    )}
                </TabsContent>

                <TabsContent value="answered" className="space-y-4">
                    {filteredInquiries.length > 0 ? (
                        filteredInquiries.map(inquiry => (
                            <InquiryListItem
                                key={inquiry.id}
                                inquiry={inquiry}
                                onReply={handleReplyClick}
                            />
                        ))
                    ) : (
                        <EmptyState tab="answered" />
                    )}
                </TabsContent>
            </Tabs>

            {/* Reply Modal */}
            <ReplyModal
                isOpen={isReplyModalOpen}
                onClose={() => setIsReplyModalOpen(false)}
                inquiry={selectedInquiry}
                onConfirmReply={handleConfirmReply}
            />
        </div>
    );
}

function EmptyState({ tab }: { tab: string }) {
    return (
        <div className="flex flex-col items-center justify-center py-16 text-center border rounded-lg border-dashed bg-muted/20">
            <div className="bg-muted p-4 rounded-full mb-4">
                {tab === 'waiting' ? (
                    <CheckCircle2 className="h-8 w-8 text-green-500" />
                ) : (
                    <MessageSquare className="h-8 w-8 text-muted-foreground" />
                )}
            </div>
            <h3 className="text-lg font-semibold mb-1">
                {tab === 'waiting' ? "미답변 문의가 없습니다!" : "답변 완료된 문의가 없습니다."}
            </h3>
            <p className="text-sm text-muted-foreground max-w-[400px]">
                {tab === 'waiting'
                    ? "모든 고객 문의를 처리하셨군요. 정말 대단해요! 👍"
                    : "아직 처리된 문의 내역이 없습니다."}
            </p>
            {tab === 'waiting' && (
                <Button variant="outline" className="mt-6">
                    혹시 모르니 다시 불러오기
                </Button>
            )}
        </div>
    );
}
