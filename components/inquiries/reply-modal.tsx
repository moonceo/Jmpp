import { Button } from "@/components/ui/button";
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
import { AlertTriangle } from "lucide-react";
import { Inquiry } from "@/types/inquiry";
import { useState } from "react";
import { toast } from "sonner";

interface ReplyModalProps {
    isOpen: boolean;
    onClose: () => void;
    inquiry: Inquiry | null;
    onConfirmReply: (inquiryId: string, content: string) => void;
}

export function ReplyModal({ isOpen, onClose, inquiry, onConfirmReply }: ReplyModalProps) {
    const [replyContent, setReplyContent] = useState("");
    const [isConfirming, setIsConfirming] = useState(false);

    if (!inquiry) return null;

    const handleSendClick = () => {
        if (!replyContent.trim()) {
            toast.error("답변 내용을 입력해주세요.");
            return;
        }
        setIsConfirming(true);
    };

    const handleFinalConfirm = () => {
        onConfirmReply(inquiry.id, replyContent);
        setReplyContent("");
        setIsConfirming(false);
        onClose();
    };

    return (
        <Dialog open={isOpen} onOpenChange={(open) => {
            if (!open) {
                setIsConfirming(false);
                onClose();
            }
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
                        <div className="bg-muted p-4 rounded-lg space-y-2 text-sm">
                            <div className="font-semibold text-foreground flex items-center justify-between">
                                <span>Q. {inquiry.content}</span>
                                <span className="text-xs font-normal text-muted-foreground">
                                    {inquiry.writerId}
                                </span>
                            </div>
                            <div className="text-xs text-muted-foreground/80">
                                {inquiry.product?.name} ({inquiry.product?.optionName})
                            </div>
                        </div>

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
                                <div className="min-h-[200px] border rounded-md p-4 flex flex-col items-center justify-center text-muted-foreground text-sm">
                                    <p>등록된 상용구가 없습니다.</p>
                                    <Button variant="link" className="text-blue-600">상용구 관리 바로가기</Button>
                                </div>
                            </TabsContent>
                        </Tabs>

                        <DialogFooter>
                            <Button variant="outline" onClick={onClose}>취소</Button>
                            <Button onClick={handleSendClick}>
                                답변 전송
                            </Button>
                        </DialogFooter>
                    </>
                ) : (
                    <>
                        <DialogHeader>
                            <DialogTitle className="text-red-600 flex items-center gap-2">
                                <AlertTriangle className="h-6 w-6" />
                                답변 전송 확인
                            </DialogTitle>
                        </DialogHeader>

                        <div className="py-6 space-y-4">
                            <p className="font-medium text-center text-lg">
                                정말로 전송하시겠습니까?
                            </p>
                            <div className="bg-red-50 text-red-800 p-4 rounded border border-red-200 text-sm">
                                ⚠️ <strong>주의:</strong> 마켓 정책상 한 번 전송된 답변은 <strong>수정하거나 삭제할 수 없습니다.</strong> 오타나 잘못된 내용이 없는지 다시 한 번 확인해주세요.
                            </div>
                            <div className="bg-muted p-4 rounded text-sm text-foreground/80 italic border-l-4 border-gray-400">
                                &ldquo;{replyContent}&rdquo;
                            </div>
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
