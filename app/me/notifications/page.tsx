"use client";

import { useMemo, useState } from "react";
import { BellRing, MessageSquareText, Save, Store } from "lucide-react";
import { toast } from "sonner";
import { PageHeader } from "@/components/shared/page-header";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

type NotificationRuleId =
    | "CUSTOMS_KAKAO"
    | "CUSTOMS_SMS"
    | "CHINA_SHIPPING"
    | "FORWARDER_DISPATCH"
    | "REVIEW_REQUEST"
    | "NEW_ORDER"
    | "FORWARDER_PAYMENT"
    | "RECEIVING_ERROR";

interface NotificationRule {
    id: NotificationRuleId;
    audience: "CUSTOMER" | "SELLER";
    title: string;
    description: string;
}

const NOTIFICATION_RULES: readonly NotificationRule[] = [
    {
        id: "CUSTOMS_KAKAO",
        audience: "CUSTOMER",
        title: "통관부호 수집(알림톡)",
        description: "발주 확인 후 통관부호 제출 링크를 고객에게 안내합니다.",
    },
    {
        id: "CUSTOMS_SMS",
        audience: "CUSTOMER",
        title: "통관부호 수집(SMS)",
        description: "알림톡 미도달 고객에게 문자로 다시 안내합니다.",
    },
    {
        id: "CHINA_SHIPPING",
        audience: "CUSTOMER",
        title: "중국 현지배송 시작",
        description: "소싱 상품의 중국 내 배송이 시작되면 고객에게 알립니다.",
    },
    {
        id: "FORWARDER_DISPATCH",
        audience: "CUSTOMER",
        title: "배대지 출고",
        description: "외부 배대지 출고 수신 시 국내 배송 시작을 안내합니다.",
    },
    {
        id: "REVIEW_REQUEST",
        audience: "CUSTOMER",
        title: "리뷰 요청",
        description: "배송완료 뒤 설정한 시점에 구매후기 작성을 안내합니다.",
    },
    {
        id: "NEW_ORDER",
        audience: "SELLER",
        title: "신규주문",
        description: "수집된 신규주문이 생기면 판매자에게 알립니다.",
    },
    {
        id: "FORWARDER_PAYMENT",
        audience: "SELLER",
        title: "배송비 결제대기",
        description: "외부 배대지 견적 완료 후 결제할 주문을 알립니다.",
    },
    {
        id: "RECEIVING_ERROR",
        audience: "SELLER",
        title: "오류입고",
        description: "외부 배대지에서 수량·옵션·파손 오류를 수신하면 알립니다.",
    },
] as const;

const DEFAULT_ENABLED: Record<NotificationRuleId, boolean> = {
    CUSTOMS_KAKAO: true,
    CUSTOMS_SMS: false,
    CHINA_SHIPPING: false,
    FORWARDER_DISPATCH: false,
    REVIEW_REQUEST: false,
    NEW_ORDER: true,
    FORWARDER_PAYMENT: true,
    RECEIVING_ERROR: true,
};

export default function NotificationSettingsPage() {
    const [enabledRules, setEnabledRules] = useState(DEFAULT_ENABLED);
    const [selectedRuleId, setSelectedRuleId] = useState<NotificationRuleId>("CUSTOMS_KAKAO");
    const [startHour, setStartHour] = useState("10");
    const [endHour, setEndHour] = useState("20");
    const [hideCancelButton, setHideCancelButton] = useState(false);
    const [includeImportCostNotice, setIncludeImportCostNotice] = useState(true);

    const selectedRule = useMemo(
        () => NOTIFICATION_RULES.find((rule) => rule.id === selectedRuleId) ?? NOTIFICATION_RULES[0],
        [selectedRuleId],
    );

    const toggleRule = (id: NotificationRuleId, checked: boolean) => {
        setEnabledRules((current) => ({ ...current, [id]: checked }));
    };

    const save = () => {
        toast.success("알림 설정을 데모 상태에 저장했습니다.");
    };

    return (
        <div className="min-h-full space-y-6 p-4 sm:p-6 lg:p-8">
            <PageHeader
                title="알림 설정"
                eyebrow="COMMERCE LIFE · NOTIFICATIONS"
                description="고객 안내와 판매자 작업 알림을 목적별로 켜고 발송 정책을 검토합니다."
                actions={(
                    <Button onClick={save}>
                        <Save />
                        설정 저장
                    </Button>
                )}
            />

            <Alert>
                <BellRing />
                <AlertTitle className="line-clamp-none">현재 화면은 발송 정책 데모입니다</AlertTitle>
                <AlertDescription>
                    실제 알림톡·SMS 발송은 발신 프로필, 승인 템플릿, 수신동의, 재시도·중복방지 검증을 마친 뒤 활성화됩니다. 설정을 켜도 외부 메시지가 전송되지는 않습니다.
                </AlertDescription>
            </Alert>

            <div className="grid min-w-0 gap-6 xl:grid-cols-[minmax(320px,0.8fr)_minmax(0,1.2fr)]">
                <Card className="gap-0 overflow-hidden py-0">
                    <CardHeader className="border-b p-4 sm:p-5">
                        <CardTitle>알림 종류</CardTitle>
                        <CardDescription>설정할 항목을 선택하고 ON/OFF를 변경합니다.</CardDescription>
                    </CardHeader>
                    <CardContent className="p-4 sm:p-5">
                        <Tabs defaultValue="CUSTOMER">
                            <TabsList className="grid w-full grid-cols-2">
                                <TabsTrigger value="CUSTOMER">
                                    <MessageSquareText /> 고객 알림
                                </TabsTrigger>
                                <TabsTrigger value="SELLER">
                                    <Store /> 판매자 알림
                                </TabsTrigger>
                            </TabsList>
                            {(["CUSTOMER", "SELLER"] as const).map((audience) => (
                                <TabsContent key={audience} value={audience} className="mt-4 space-y-2">
                                    {NOTIFICATION_RULES.filter((rule) => rule.audience === audience).map((rule) => {
                                        const selected = selectedRuleId === rule.id;
                                        return (
                                            <div
                                                key={rule.id}
                                                className={selected ? "rounded-lg border border-foreground bg-muted/40 p-4" : "rounded-lg border p-4"}
                                            >
                                                <div className="flex items-start justify-between gap-4">
                                                    <Button
                                                        type="button"
                                                        variant="ghost"
                                                        className="h-auto min-w-0 flex-1 justify-start whitespace-normal p-0 text-left hover:bg-transparent"
                                                        onClick={() => setSelectedRuleId(rule.id)}
                                                    >
                                                        <span className="block min-w-0">
                                                        <span className="flex flex-wrap items-center gap-2 text-sm font-semibold">
                                                            {rule.title}
                                                            <Badge variant={enabledRules[rule.id] ? "default" : "outline"}>
                                                                {enabledRules[rule.id] ? "ON" : "OFF"}
                                                            </Badge>
                                                        </span>
                                                        <span className="mt-1 block text-xs leading-5 text-muted-foreground">{rule.description}</span>
                                                        </span>
                                                    </Button>
                                                    <Switch
                                                        aria-label={`${rule.title} 사용`}
                                                        checked={enabledRules[rule.id]}
                                                        onCheckedChange={(checked) => toggleRule(rule.id, checked)}
                                                    />
                                                </div>
                                            </div>
                                        );
                                    })}
                                </TabsContent>
                            ))}
                        </Tabs>
                    </CardContent>
                </Card>

                <div className="min-w-0 space-y-6">
                    <Card className="gap-0 overflow-hidden py-0">
                        <CardHeader className="border-b p-4 sm:p-5">
                            <div className="flex flex-wrap items-center justify-between gap-3">
                                <div>
                                    <CardTitle>{selectedRule.title}</CardTitle>
                                    <CardDescription className="mt-1">{selectedRule.description}</CardDescription>
                                </div>
                                <Badge variant={enabledRules[selectedRule.id] ? "default" : "outline"}>
                                    {enabledRules[selectedRule.id] ? "활성" : "비활성"}
                                </Badge>
                            </div>
                        </CardHeader>
                        <CardContent className="space-y-6 p-4 sm:p-5">
                            {selectedRule.audience === "CUSTOMER" ? (
                                <>
                                    <div className="space-y-2">
                                        <Label>발송 가능 시간대 (KST)</Label>
                                        <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2">
                                            <HourSelect value={startHour} onValueChange={setStartHour} />
                                            <span className="text-sm text-muted-foreground">~</span>
                                            <HourSelect value={endHour} onValueChange={setEndHour} />
                                        </div>
                                        <p className="text-xs text-muted-foreground">설정한 시간 밖에 발생한 알림은 다음 발송 가능 시간까지 대기합니다.</p>
                                    </div>

                                    {selectedRule.id === "CUSTOMS_KAKAO" || selectedRule.id === "CUSTOMS_SMS" ? (
                                        <div className="divide-y rounded-lg border">
                                            <SettingSwitch
                                                id="hide-cancel-button"
                                                title="주문 취소 버튼 숨기기"
                                                description="고객 안내에서 주문 취소 바로가기를 제거합니다."
                                                checked={hideCancelButton}
                                                onCheckedChange={setHideCancelButton}
                                            />
                                            <SettingSwitch
                                                id="import-cost-notice"
                                                title="관부가세·추가 택배비 안내"
                                                description="발생 가능 비용을 통관 안내문에 함께 표시합니다."
                                                checked={includeImportCostNotice}
                                                onCheckedChange={setIncludeImportCostNotice}
                                            />
                                        </div>
                                    ) : null}
                                </>
                            ) : (
                                <Alert>
                                    <Store />
                                    <AlertTitle className="line-clamp-none">판매자 알림 수신 채널</AlertTitle>
                                    <AlertDescription>
                                        인앱 알림을 기본으로 사용하며 이메일·모바일 푸시는 계정별 수신 채널이 연결된 뒤 선택할 수 있습니다.
                                    </AlertDescription>
                                </Alert>
                            )}
                        </CardContent>
                    </Card>

                    <Card className="gap-0 overflow-hidden py-0">
                        <CardHeader className="border-b p-4 sm:p-5">
                            <CardTitle>미리보기</CardTitle>
                            <CardDescription>실제 발송 전 승인 템플릿과 치환값을 다시 검증합니다.</CardDescription>
                        </CardHeader>
                        <CardContent className="p-4 sm:p-5">
                            <div className="rounded-xl border bg-muted/30 p-5">
                                <div className="flex items-center justify-between gap-3">
                                    <Badge variant="outline">알림톡 예시</Badge>
                                    <span className="text-xs text-muted-foreground">{startHour}:00~{endHour}:00</span>
                                </div>
                                <h3 className="mt-5 text-base font-bold">해외 통관부호 확인 요청</h3>
                                <div className="mt-3 space-y-3 text-sm leading-6 text-foreground">
                                    <p>안녕하세요, &#123;&#123;고객명&#125;&#125;님. &#123;&#123;스토어명&#125;&#125;입니다.</p>
                                    <p>주문하신 &#123;&#123;상품명&#125;&#125;의 해외배송을 위해 개인통관고유부호 확인이 필요합니다.</p>
                                    {includeImportCostNotice ? <p>상품에 따라 관부가세 또는 추가 택배비가 발생할 수 있습니다.</p> : null}
                                </div>
                                <div className="mt-5 grid gap-2">
                                    <Button variant="outline" disabled>통관부호 제출하기</Button>
                                    {!hideCancelButton ? <Button variant="ghost" disabled>주문 취소하기</Button> : null}
                                </div>
                            </div>
                        </CardContent>
                    </Card>
                </div>
            </div>
        </div>
    );
}

function HourSelect({ value, onValueChange }: { value: string; onValueChange: (value: string) => void }) {
    return (
        <Select value={value} onValueChange={onValueChange}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
                {Array.from({ length: 24 }, (_, hour) => String(hour).padStart(2, "0")).map((hour) => (
                    <SelectItem key={hour} value={String(Number(hour))}>{hour}:00</SelectItem>
                ))}
            </SelectContent>
        </Select>
    );
}

function SettingSwitch({
    id,
    title,
    description,
    checked,
    onCheckedChange,
}: {
    id: string;
    title: string;
    description: string;
    checked: boolean;
    onCheckedChange: (checked: boolean) => void;
}) {
    return (
        <div className="flex items-start justify-between gap-5 p-4">
            <div>
                <Label htmlFor={id} className="font-semibold">{title}</Label>
                <p className="mt-1 text-xs leading-5 text-muted-foreground">{description}</p>
            </div>
            <Switch id={id} checked={checked} onCheckedChange={onCheckedChange} />
        </div>
    );
}
