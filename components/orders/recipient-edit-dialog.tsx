"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import type { Order, Recipient } from "@/types/order";

export function canEditRecipientInfo(order: Pick<Order, "status" | "dataSource">) {
    return order.dataSource !== "api" && ["NEW", "PREPARING", "READY_TO_SHIP"].includes(order.status);
}

function customsState(code?: string) {
    return code?.trim() && /^P\d{12}$/.test(code.trim().toUpperCase()) ? "통관부호 일치" : "통관부호 불일치";
}

export function RecipientEditDialog({
    order,
    onSaveRecipientInfo,
    label = "수정",
    className,
}: {
    order: Order;
    onSaveRecipientInfo?: (order: Order, recipient: Recipient) => void;
    label?: string;
    className?: string;
}) {
    const [open, setOpen] = useState(false);
    const [name, setName] = useState(order.recipient.name);
    const [phone, setPhone] = useState(order.recipient.phone);
    const [zipCode, setZipCode] = useState(order.recipient.zipCode ?? "");
    const [address, setAddress] = useState(order.recipient.address);
    const [detailAddress, setDetailAddress] = useState(order.recipient.detailAddress ?? "");
    const [deliveryMessage, setDeliveryMessage] = useState(order.recipient.deliveryMessage ?? "");
    const [customsCode, setCustomsCode] = useState(order.recipient.personalCustomsCode ?? "");
    const normalizedCode = customsCode.trim().toUpperCase();
    const editorCustoms = customsState(normalizedCode);
    const editable = canEditRecipientInfo(order) && Boolean(onSaveRecipientInfo);
    const canSave = editable && Boolean(name.trim() && phone.trim() && address.trim() && /^P\d{12}$/.test(normalizedCode));

    if (!editable) return null;

    const openEditor = () => {
        setName(order.recipient.name);
        setPhone(order.recipient.phone);
        setZipCode(order.recipient.zipCode ?? "");
        setAddress(order.recipient.address);
        setDetailAddress(order.recipient.detailAddress ?? "");
        setDeliveryMessage(order.recipient.deliveryMessage ?? "");
        setCustomsCode(order.recipient.personalCustomsCode ?? "");
        setOpen(true);
    };

    const save = () => {
        if (!canSave || !onSaveRecipientInfo) {
            toast.info("수령인, 연락처, 주소, 개인통관부호를 확인하세요.");
            return;
        }

        onSaveRecipientInfo(order, {
            name: name.trim(),
            phone: phone.trim(),
            zipCode: zipCode.trim() || undefined,
            address: address.trim(),
            detailAddress: detailAddress.trim() || undefined,
            deliveryMessage: deliveryMessage.trim() || undefined,
            personalCustomsCode: normalizedCode,
        });
        setOpen(false);
    };

    return (
        <>
            <Button
                type="button"
                size="sm"
                variant="outline"
                className={cn("h-[29px] whitespace-nowrap border-border bg-card px-2 text-xs shadow-none hover:bg-muted", className)}
                onClick={openEditor}
            >
                {label}
            </Button>
            <Dialog open={open} onOpenChange={setOpen}>
                <DialogContent className="max-w-lg">
                    <DialogHeader>
                        <DialogTitle>배송정보 수정</DialogTitle>
                        <DialogDescription>수령인 배송정보와 개인통관부호를 함께 수정합니다.</DialogDescription>
                    </DialogHeader>
                    <div className="grid gap-3">
                        <div className="grid grid-cols-2 gap-2">
                            <Input value={name} onChange={(event) => setName(event.target.value)} placeholder="수령인명" />
                            <Input value={phone} onChange={(event) => setPhone(event.target.value)} placeholder="수령인 연락처" />
                        </div>
                        <Input value={zipCode} onChange={(event) => setZipCode(event.target.value)} placeholder="우편번호" />
                        <Input value={address} onChange={(event) => setAddress(event.target.value)} placeholder="주소" />
                        <Input value={detailAddress} onChange={(event) => setDetailAddress(event.target.value)} placeholder="상세주소" />
                        <Input value={deliveryMessage} onChange={(event) => setDeliveryMessage(event.target.value)} placeholder="배송메시지" />
                        <Input
                            value={customsCode}
                            onChange={(event) => setCustomsCode(event.target.value.toUpperCase())}
                            placeholder="개인통관부호 P123456789012"
                            className="font-mono"
                        />
                        <div className="flex items-center justify-between rounded-md border border-border bg-muted px-3 py-2">
                            <div className="text-xs text-muted-foreground">개인통관부호 상태</div>
                            <Badge variant="outline" className="border-border bg-muted text-xs text-foreground">
                                {editorCustoms}
                            </Badge>
                        </div>
                    </div>
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setOpen(false)}>취소</Button>
                        <Button disabled={!canSave} onClick={save}>저장</Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </>
    );
}
