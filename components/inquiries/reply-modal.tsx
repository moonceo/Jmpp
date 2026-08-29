import { Button } from "@/components/ui/button";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Empty, EmptyContent, EmptyDescription, EmptyHeader } from "@/components/ui/empty";
import { Item, ItemContent, ItemDescription, ItemTitle } from "@/components/ui/item";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { AlertTriangle, Sparkles } from "lucide-react";
import { Inquiry } from "@/types/inquiry";
import { useState } from "react";
import { toast } from "sonner";
import { createInquiryReplyDraft } from "@/lib/inquiry-ai-draft";

interface ReplyModalProps {
    isOpen: boolean;
    onClose: () => void;
    inquiry: Inquiry | null;
    onConfirmReply: (inquiryId: string, content: string) => void;
}

export function ReplyModal({ isOpen, onClose, inquiry, onConfirmReply }: ReplyModalProps) {
    const [replyContent, setReplyContent] = useState("");
    const [isConfirming, setIsConfirming] = useState(false);
    const [isGeneratingDraft, setIsGeneratingDraft] = useState(false);

    if (!inquiry) return null;

    const closeDialog = () => {
        setReplyContent("");
        setIsConfirming(false);
        setIsGeneratingDraft(false);
        onClose();
    };

    const handleSendClick = () => {
        if (!replyContent.trim()) {
            toast.error("답변 내용을 입력해주세요.");
            return;
        }
        setIsConfirming(true);
    };

    const handleFinalConfirm = () => {
        onConfirmReply(inquiry.id, replyContent);
        closeDialog();
    };

    const generateDraft = () => {
        setIsGeneratingDraft(true);
        window.setTimeout(() => {
            setReplyContent(createInquiryReplyDraft(inquiry));
            setIsGeneratingDraft(false);
            toast.success("문의와 상품 정보를 바탕으로 답변 초안을 만들었습니다.");
        }, 500);
    };

    return (
        <Dialog open={isOpen} onOpenChange={(open) => {
            if (!open) closeDialog();
        }}>
            <DialogContent className="sm:max-w-[600px]">
                {!isConfirming ? (
                    <>
                        <DialogHeader>
                            <DialogTitle>문의 답변하기</DialogTitle>
                            <DialogDescription>
                                고객 문의에 대한 답변을 작성합니다.
                            </DialogDescription>
                        </DialogHeader>

                        {/* Inquiry Context */}
                        <Item variant="muted">
                            <ItemContent>
                            <ItemTitle className="w-full justify-between">
                                <span>Q. {inquiry.content}</span>
                                <span className="text-xs font-normal text-muted-foreground">
                                    {inquiry.writerId}
                                </span>
                            </ItemTitle>
                            <ItemDescription>
                                {inquiry.product?.name} ({inquiry.product?.optionName})
                            </ItemDescription>
                            </ItemContent>
                        </Item>

                        <Alert>
                            <Sparkles />
                            <AlertTitle>AI 답변작성 도우미</AlertTitle>
                            <AlertDescription className="flex flex-col items-start gap-3 sm:flex-row sm:items-center sm:justify-between">
                                <span>문의·상품 정보를 사용해 과도한 약속이 없는 검토용 초안을 만듭니다. 전송 전 사실관계를 확인하세요.</span>
                                <Button type="button" variant="outline" size="sm" onClick={generateDraft} disabled={isGeneratingDraft}>
                                    <Sparkles />
                                    {isGeneratingDraft ? "초안 생성 중" : "AI 초안 만들기"}
                                </Button>
                            </AlertDescription>
                        </Alert>

                        {/* Templates (Mock) */}
                        <Tabs defaultValue="direct" className="w-full">
                            <TabsList className="grid w-full grid-cols-2">
                                <TabsTrigger value="direct">직접 입력</TabsTrigger>
                                <TabsTrigger value="template">상용구 선택</TabsTrigger>
                            </TabsList>
                            <TabsContent value="direct" className="mt-4">
                                <Textarea
                                    placeholder="답변 내용을 입력하세요..."
                                    className="min-h-[200px] resize-none"
                                    value={replyContent}
                                    onChange={(e) => setReplyContent(e.target.value)}
                                />
                            </TabsContent>
                            <TabsContent value="template" className="mt-4">
                                <Empty className="min-h-[200px] border">
                                    <EmptyHeader>
                                        <EmptyDescription>등록된 상용구가 없습니다.</EmptyDescription>
                                    </EmptyHeader>
                                    <EmptyContent>
                                        <Button variant="outline">상용구 관리 바로가기</Button>
                                    </EmptyContent>
                                </Empty>
                            </TabsContent>
                        </Tabs>

                        <DialogFooter>
                            <Button variant="outline" onClick={closeDialog}>취소</Button>
                            <Button onClick={handleSendClick}>
                                답변 전송
                            </Button>
                        </DialogFooter>
                    </>
                ) : (
                    <>
                        <DialogHeader>
                            <DialogTitle className="text-foreground flex items-center gap-2">
                                <AlertTriangle className="h-6 w-6" />
                                답변 전송 확인
                            </DialogTitle>
                        </DialogHeader>

                        <div className="py-6 space-y-4">
                            <p className="font-medium text-center text-lg">
                                정말로 전송하시겠습니까?
                            </p>
                            <Alert>
                                <AlertTriangle />
                                <AlertTitle>주의</AlertTitle>
                                <AlertDescription>마켓 정책상 한 번 전송된 답변은 수정하거나 삭제할 수 없습니다. 오타나 잘못된 내용이 없는지 다시 확인해주세요.</AlertDescription>
                            </Alert>
                            <Item variant="outline">
                                <ItemContent>
                                    <ItemDescription className="italic text-foreground/80">&ldquo;{replyContent}&rdquo;</ItemDescription>
                                </ItemContent>
                            </Item>
                        </div>

                        <DialogFooter className="gap-2 sm:justify-center">
                            <Button variant="ghost" onClick={() => setIsConfirming(false)}>
                                다시 수정하기
                            </Button>
                            <Button variant="destructive" onClick={handleFinalConfirm} className="w-full sm:w-auto px-8">
                                확인했습니다, 전송합니다
                            </Button>
                        </DialogFooter>
                    </>
                )}
            </DialogContent>
        </Dialog>
    );
}
