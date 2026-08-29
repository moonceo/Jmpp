"use client";

import { ReactNode, useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { LockKeyhole, RefreshCw, Settings, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { PageHeader } from "@/components/shared/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { MARKET_LABELS } from "@/lib/constants/orders";
import { withBrowserSecurity } from "@/lib/client/http";

type MarketKey = "naver" | "coupang" | "11st" | "gmarket" | "auction";
type ShippingProcessPreference = "DELIVERY" | "DIRECT_DELIVERY" | "OVERSEAS_OTHER_DELIVERY";

type MarketAccount = {
    id: string;
    market: MarketKey;
    storeName: string;
    sellerAccount: string;
    authStatus: "connected" | "pending" | "error" | "reauth";
    active: boolean;
    lastCollectedAt: string;
    lastResult: "success" | "failed" | "-";
    feeRate: number;
    version?: string;
    businessNumber?: string;
    source?: "api" | "demo";
    shippingProcessPreference: ShippingProcessPreference;
};

type AddForm = {
    storeName: string;
    businessNumber: string;
    shippingProcessPreference: ShippingProcessPreference;
    naverSellerId: string;
    naverClientId: string;
    naverClientSecret: string;
    coupangVendorId: string;
    coupangAccessKey: string;
    coupangSecretKey: string;
    coupangWingLoginId: string;
    elevenSellerId: string;
    elevenApiKey: string;
    gmarketMasterId: string;
    gmarketSellerId: string;
    gmarketSecretKey: string;
    auctionMasterId: string;
    auctionSellerId: string;
    auctionSecretKey: string;
};

type ApiMarketAccount = {
    id: string;
    marketCode: "NAVER" | "COUPANG" | "ELEVEN_STREET" | "GMARKET" | "AUCTION";
    storeName: string;
    sellerId: string;
    externalAccountId: string | null;
    authStatus: "PENDING" | "CONNECTED" | "EXPIRED" | "REAUTH_REQUIRED" | "ERROR" | "DISCONNECTED";
    isActive: boolean;
    settings: Record<string, unknown>;
    lastSuccessfulSyncAt: string | null;
    lastErrorCode: string | null;
    version: string;
};

type ApiEnvelope<T> = { data: T };

const initialAccounts: MarketAccount[] = [
    { id: "acct-01", market: "naver", storeName: "리빙온마켓", sellerAccount: "naver_living_01", authStatus: "connected", active: true, lastCollectedAt: "2026-06-15 09:42", lastResult: "success", feeRate: 3.6, shippingProcessPreference: "DIRECT_DELIVERY" },
    { id: "acct-02", market: "naver", storeName: "홈데코랩", sellerAccount: "naver_home_02", authStatus: "connected", active: true, lastCollectedAt: "2026-06-15 09:39", lastResult: "success", feeRate: 3.8, shippingProcessPreference: "OVERSEAS_OTHER_DELIVERY" },
    { id: "acct-03", market: "coupang", storeName: "쿠팡라이프샵", sellerAccount: "coupang_wing_01", authStatus: "connected", active: true, lastCollectedAt: "2026-06-15 09:36", lastResult: "success", feeRate: 10.8, shippingProcessPreference: "DELIVERY" },
    { id: "acct-04", market: "coupang", storeName: "스마트홈셀러", sellerAccount: "coupang_wing_02", authStatus: "connected", active: true, lastCollectedAt: "2026-06-15 09:10", lastResult: "success", feeRate: 10.8, shippingProcessPreference: "DELIVERY" },
    { id: "acct-05", market: "11st", storeName: "글로벌픽스토어", sellerAccount: "11st_global_01", authStatus: "connected", active: true, lastCollectedAt: "2026-06-15 09:32", lastResult: "success", feeRate: 13, shippingProcessPreference: "DIRECT_DELIVERY" },
    { id: "acct-06", market: "11st", storeName: "홈앤키친11", sellerAccount: "11st_home_02", authStatus: "connected", active: true, lastCollectedAt: "2026-06-15 09:28", lastResult: "success", feeRate: 13, shippingProcessPreference: "DELIVERY" },
    { id: "acct-07", market: "gmarket", storeName: "지마켓리빙박스", sellerAccount: "gmarket_living_01", authStatus: "connected", active: true, lastCollectedAt: "2026-06-15 09:24", lastResult: "success", feeRate: 12, shippingProcessPreference: "DELIVERY" },
    { id: "acct-08", market: "gmarket", storeName: "데일리홈마켓", sellerAccount: "gmarket_home_02", authStatus: "connected", active: true, lastCollectedAt: "2026-06-15 09:21", lastResult: "success", feeRate: 12, shippingProcessPreference: "DELIVERY" },
    { id: "acct-09", market: "auction", storeName: "옥션리빙셀렉트", sellerAccount: "auction_living_01", authStatus: "connected", active: true, lastCollectedAt: "2026-06-15 09:18", lastResult: "success", feeRate: 12, shippingProcessPreference: "DELIVERY" },
    { id: "acct-10", market: "auction", storeName: "하우스웨어옥션", sellerAccount: "auction_home_02", authStatus: "connected", active: true, lastCollectedAt: "2026-06-15 09:15", lastResult: "success", feeRate: 12, shippingProcessPreference: "DELIVERY" },
];

const emptyForm: AddForm = {
    storeName: "",
    businessNumber: "",
    shippingProcessPreference: "DELIVERY",
    naverSellerId: "",
    naverClientId: "",
    naverClientSecret: "",
    coupangVendorId: "",
    coupangAccessKey: "",
    coupangSecretKey: "",
    coupangWingLoginId: "",
    elevenSellerId: "",
    elevenApiKey: "",
    gmarketMasterId: "",
    gmarketSellerId: "",
    gmarketSecretKey: "",
    auctionMasterId: "",
    auctionSellerId: "",
    auctionSecretKey: "",
};

const authLabel = {
    connected: "연동 완료",
    pending: "확인 대기",
    error: "연동 오류",
    reauth: "재인증 필요",
};

const defaultFeeRate: Record<MarketKey, number> = {
    naver: 3.6,
    coupang: 10.8,
    "11st": 13,
    gmarket: 12,
    auction: 12,
};

const CREATABLE_MARKETS: readonly MarketKey[] = ["naver", "coupang", "11st", "gmarket", "auction"];

export default function MarketsPage() {
    const [accounts, setAccounts] = useState(initialAccounts);
    const [selectedMarket, setSelectedMarket] = useState<MarketKey>("naver");
    const [form, setForm] = useState<AddForm>(emptyForm);
    const [addDialogOpen, setAddDialogOpen] = useState(false);
    const [editingAccount, setEditingAccount] = useState<MarketAccount | null>(null);
    const [editForm, setEditForm] = useState<AddForm>(emptyForm);
    const [deletingAccount, setDeletingAccount] = useState<MarketAccount | null>(null);
    const [pendingAction, setPendingAction] = useState<string | null>(null);
    const accountsQuery = useQuery({
        queryKey: ["market-accounts"],
        queryFn: () => apiRequest<ApiMarketAccount[]>("/api/market-accounts"),
        retry: false,
    });

    useEffect(() => {
        if (accountsQuery.data) {
            setAccounts(accountsQuery.data.map(toUiMarketAccount));
        }
    }, [accountsQuery.data]);

    const canSubmit = useMemo(() => {
        return canSubmitMarketForm(selectedMarket, form);
    }, [form, selectedMarket]);

    const canSubmitEdit = useMemo(() => {
        if (!editingAccount) return false;
        return Boolean(editForm.storeName.trim() && editForm.businessNumber.trim());
    }, [editForm, editingAccount]);
    const canRotateCredentials = Boolean(
        editingAccount?.source === "api"
        && editingAccount.market === "naver"
        && editingAccount.version
        && editForm.naverClientId.trim()
        && editForm.naverClientSecret.trim(),
    );

    const updateForm = (key: keyof AddForm, value: string) => {
        setForm((current) => ({ ...current, [key]: value }));
    };

    const updateEditForm = (key: keyof AddForm, value: string) => {
        setEditForm((current) => ({ ...current, [key]: value }));
    };

    const toggleActive = async (account: MarketAccount, active: boolean) => {
        if (account.source !== "api" || !account.version) {
            setAccounts((current) => current.map((item) => item.id === account.id ? { ...item, active } : item));
            toast.info("데모 계정의 활성 상태만 화면에서 변경했습니다.");
            return;
        }

        setPendingAction(`toggle:${account.id}`);
        try {
            const updated = await apiRequest<ApiMarketAccount>(`/api/market-accounts/${account.id}`, {
                method: "PATCH",
                headers: { "content-type": "application/json" },
                body: JSON.stringify({ expectedVersion: account.version, isActive: active }),
            });
            setAccounts((current) => current.map((item) => item.id === account.id ? toUiMarketAccount(updated) : item));
            toast.success(`${account.storeName} 계정을 ${active ? "활성화" : "일시정지"}했습니다.`);
        } catch (error) {
            toast.error(errorMessage(error));
        } finally {
            setPendingAction(null);
        }
    };

    const testConnection = () => {
        if (!canSubmit) {
            toast.info("필수 인증값을 먼저 입력하세요.");
            return;
        }
        toast.info("계정을 추가하면 자격증명을 암호화해 저장한 뒤 서버 워커가 실제 API 연결을 확인합니다.");
    };

    const testEditConnection = async () => {
        if (!editingAccount || !canSubmitEdit) {
            toast.info("필수 계정 정보를 먼저 입력하세요.");
            return;
        }
        if (editingAccount.source !== "api") {
            toast.info("데모 계정은 실제 API 연결 확인을 실행하지 않습니다.");
            return;
        }

        setPendingAction(`verify:${editingAccount.id}`);
        try {
            await apiRequest(`/api/market-accounts/${editingAccount.id}/verify`, { method: "POST" });
            toast.success(`${MARKET_LABELS[editingAccount.market]} 연결 확인 작업을 접수했습니다.`);
            setEditingAccount(null);
        } catch (error) {
            toast.error(errorMessage(error));
        } finally {
            setPendingAction(null);
        }
    };

    const rotateEditingCredentials = async () => {
        if (!editingAccount || editingAccount.source !== "api" || editingAccount.market !== "naver" || !editingAccount.version) {
            toast.info("현재 네이버 실계정만 자격증명을 교체할 수 있습니다.");
            return;
        }
        if (!canRotateCredentials) {
            toast.info("새 Client ID와 Client Secret을 모두 입력하세요.");
            return;
        }

        setPendingAction(`credentials:${editingAccount.id}`);
        try {
            const result = await apiRequest<{ account: ApiMarketAccount }>(
                `/api/market-accounts/${editingAccount.id}/credentials`,
                {
                    method: "PUT",
                    headers: { "content-type": "application/json" },
                    body: JSON.stringify({
                        expectedVersion: editingAccount.version,
                        credentials: {
                            clientId: editForm.naverClientId.trim(),
                            clientSecret: editForm.naverClientSecret,
                            type: "SELF",
                        },
                    }),
                },
            );
            setAccounts((current) => current.map((account) => (
                account.id === editingAccount.id ? toUiMarketAccount(result.account) : account
            )));
            setEditingAccount(null);
            setEditForm(emptyForm);
            toast.success("자격증명을 교체하고 실제 연결 재확인 작업을 접수했습니다.");
        } catch (error) {
            toast.error(errorMessage(error));
        } finally {
            setPendingAction(null);
        }
    };

    const openEditDialog = (account: MarketAccount) => {
        setEditingAccount(account);
        setEditForm(createEditForm(account));
    };

    const addAccount = async () => {
        if (!canSubmit) {
            toast.info("필수 인증값을 먼저 입력하세요.");
            return;
        }

        setPendingAction("add");
        try {
            const created = await apiRequest<ApiMarketAccount>("/api/market-accounts", {
                method: "POST",
                headers: { "content-type": "application/json" },
                body: JSON.stringify(createAccountPayload(selectedMarket, form)),
            });
            setAccounts((current) => [toUiMarketAccount(created), ...current.filter((item) => item.source === "api")]);

            if (selectedMarket === "naver") {
                await apiRequest(`/api/market-accounts/${created.id}/verify`, { method: "POST" });
                toast.success("스마트스토어 계정을 저장하고 실제 연결 확인 작업을 접수했습니다.");
            } else {
                toast.info(`${MARKET_LABELS[selectedMarket]} 계정을 암호화해 저장했습니다. 해당 마켓 워커가 배포되기 전까지 확인 대기로 유지됩니다.`);
            }

            setForm(emptyForm);
            setAddDialogOpen(false);
        } catch (error) {
            toast.error(errorMessage(error));
        } finally {
            setPendingAction(null);
        }
    };

    const saveEditingAccount = async () => {
        if (!editingAccount) return;
        if (!canSubmitEdit) {
            toast.info("필수 인증값을 먼저 입력하세요.");
            return;
        }
        if (editingAccount.source !== "api" || !editingAccount.version) {
            setAccounts((current) => current.map((account) => account.id === editingAccount.id ? {
                ...account,
                storeName: editForm.storeName.trim(),
                businessNumber: editForm.businessNumber.trim(),
                shippingProcessPreference: editingAccount.shippingProcessPreference,
            } : account));
            setEditingAccount(null);
            toast.info("데모 계정 정보만 화면에서 수정했습니다.");
            return;
        }

        setPendingAction(`edit:${editingAccount.id}`);
        try {
            const updated = await apiRequest<ApiMarketAccount>(`/api/market-accounts/${editingAccount.id}`, {
                method: "PATCH",
                headers: { "content-type": "application/json" },
                body: JSON.stringify({
                    expectedVersion: editingAccount.version,
                    storeName: editForm.storeName.trim(),
                    settings: {
                        businessNumber: editForm.businessNumber.trim(),
                        feeRate: editingAccount.feeRate,
                        directDeliveryEnabled: editingAccount.shippingProcessPreference === "DIRECT_DELIVERY",
                        shippingProcessPreference: editingAccount.shippingProcessPreference,
                    },
                }),
            });
            setAccounts((current) => current.map((account) => account.id === editingAccount.id ? toUiMarketAccount(updated) : account));
            setEditingAccount(null);
            setEditForm(emptyForm);
            toast.success("계정 기본 정보를 수정했습니다.");
        } catch (error) {
            toast.error(errorMessage(error));
        } finally {
            setPendingAction(null);
        }
    };

    const deleteAccount = async () => {
        if (!deletingAccount) return;
        if (deletingAccount.source !== "api" || !deletingAccount.version) {
            setAccounts((current) => current.filter((account) => account.id !== deletingAccount.id));
            toast.info(`${deletingAccount.storeName} 데모 계정을 화면에서 제거했습니다.`);
            setDeletingAccount(null);
            return;
        }

        setPendingAction(`delete:${deletingAccount.id}`);
        try {
            await apiRequest(`/api/market-accounts/${deletingAccount.id}?expectedVersion=${deletingAccount.version}`, {
                method: "DELETE",
            });
            setAccounts((current) => current.filter((account) => account.id !== deletingAccount.id));
            toast.success(`${deletingAccount.storeName} 계정을 삭제했습니다.`);
            setDeletingAccount(null);
        } catch (error) {
            toast.error(errorMessage(error));
        } finally {
            setPendingAction(null);
        }
    };

    const triggerSync = async (account: MarketAccount) => {
        if (account.source !== "api") {
            toast.info("데모 계정은 실제 주문수집을 실행하지 않습니다.");
            return;
        }

        setPendingAction(`sync:${account.id}`);
        try {
            await apiRequest(`/api/market-accounts/${account.id}/sync`, { method: "POST" });
            toast.success(`${account.storeName} 주문수집 작업을 접수했습니다.`);
        } catch (error) {
            toast.error(errorMessage(error));
        } finally {
            setPendingAction(null);
        }
    };

    return (
        <div className="min-h-full p-4 sm:p-6 lg:p-8">
            <PageHeader
                title="마켓연동"
                eyebrow="COMMERCE LIFE · CONNECTIONS"
                description="판매처 계정의 인증 상태와 주문수집 연결을 한 곳에서 점검하고 관리합니다."
                actions={<Button onClick={() => setAddDialogOpen(true)}>마켓 추가</Button>}
            />

            <Dialog open={addDialogOpen} onOpenChange={setAddDialogOpen}>
                <DialogContent className="max-h-[90vh] max-w-[620px] overflow-y-auto p-0">
                    <DialogHeader className="border-b px-5 py-4">
                        <DialogTitle>마켓 추가</DialogTitle>
                    </DialogHeader>

                    <div className="space-y-5 px-5 py-4">
                        <div className="grid gap-3">
                            <h3 className="text-sm font-bold text-foreground">기본 정보</h3>
                            <Field label="마켓플레이스" required>
                                <Select value={selectedMarket} onValueChange={(value) => {
                                    const market = value as MarketKey;
                                    setSelectedMarket(market);
                                    if (!supportsShippingProcessPreference(market, form.shippingProcessPreference)) {
                                        updateForm("shippingProcessPreference", "DELIVERY");
                                    }
                                }}>
                                    <SelectTrigger className="h-10 w-full border-border bg-card">
                                        <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent>
                                        {CREATABLE_MARKETS.map((market) => (
                                            <SelectItem key={market} value={market}>
                                                {MARKET_LABELS[market]}
                                            </SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                            </Field>
                        </div>

                        <div className="grid gap-3">
                            <div className="grid gap-3 md:grid-cols-2">
                                <Field label="스토어명" required>
                                    <Input value={form.storeName} onChange={(event) => updateForm("storeName", event.target.value)} placeholder="스토어 이름을 입력하세요" />
                                </Field>
                                <Field label="사업자번호" required>
                                    <Input value={form.businessNumber} onChange={(event) => updateForm("businessNumber", event.target.value)} placeholder="000-00-00000" />
                                </Field>
                            </div>
                        </div>

                        <Separator />

                        <ShippingPreferenceField
                            market={selectedMarket}
                            value={form.shippingProcessPreference}
                            onValueChange={(value) => updateForm("shippingProcessPreference", value)}
                        />

                        <Separator />

                        <div className="grid gap-3">
                            <h3 className="text-sm font-bold text-foreground">인증 정보</h3>
                            {selectedMarket === "naver" ? (
                                <div className="grid gap-3">
                                    <Field label="연동용 판매자 ID" required>
                                        <Input value={form.naverSellerId} onChange={(event) => updateForm("naverSellerId", event.target.value)} placeholder="스마트스토어 연동용 판매자 ID" />
                                    </Field>
                                    <div className="grid gap-3 md:grid-cols-2">
                                        <Field label="클라이언트 아이디" required>
                                            <Input value={form.naverClientId} onChange={(event) => updateForm("naverClientId", event.target.value)} placeholder="네이버 Commerce API Client ID" />
                                        </Field>
                                        <Field label="클라이언트 시크릿" required>
                                            <Input type="password" value={form.naverClientSecret} onChange={(event) => updateForm("naverClientSecret", event.target.value)} placeholder="네이버 Commerce API Client Secret" />
                                        </Field>
                                    </div>
                                </div>
                            ) : null}
                            {selectedMarket === "coupang" ? (
                                <div className="grid gap-3">
                                    <Field label="쿠팡 업체코드(Vendor ID)" required>
                                        <Input value={form.coupangVendorId} onChange={(event) => updateForm("coupangVendorId", event.target.value)} placeholder="예: A00012345" />
                                    </Field>
                                    <Field label="Access Key" required>
                                        <Input value={form.coupangAccessKey} onChange={(event) => updateForm("coupangAccessKey", event.target.value)} placeholder="쿠팡 Open API Access Key" />
                                    </Field>
                                    <Field label="Secret Key" required>
                                        <Input type="password" value={form.coupangSecretKey} onChange={(event) => updateForm("coupangSecretKey", event.target.value)} placeholder="쿠팡 Open API Secret Key" />
                                    </Field>
                                    <Field label="쿠팡 윙 로그인 ID" required>
                                        <Input value={form.coupangWingLoginId} onChange={(event) => updateForm("coupangWingLoginId", event.target.value)} placeholder="쿠팡 윙 로그인 ID" />
                                    </Field>
                                </div>
                            ) : null}
                            {selectedMarket === "11st" ? (
                                <div className="grid gap-3 md:grid-cols-2">
                                    <Field label="판매자 ID" required>
                                        <Input value={form.elevenSellerId} onChange={(event) => updateForm("elevenSellerId", event.target.value)} placeholder="11번가 판매자 ID" />
                                    </Field>
                                    <Field label="API Key" required>
                                        <Input type="password" value={form.elevenApiKey} onChange={(event) => updateForm("elevenApiKey", event.target.value)} placeholder="11번가 Open API Key" />
                                    </Field>
                                </div>
                            ) : null}
                            {selectedMarket === "gmarket" ? (
                                <div className="grid gap-3">
                                    <div className="grid gap-3 md:grid-cols-2">
                                        <Field label="Master ID" required>
                                            <Input value={form.gmarketMasterId} onChange={(event) => updateForm("gmarketMasterId", event.target.value)} placeholder="ESM+ 마스터 ID" />
                                        </Field>
                                        <Field label="Seller ID" required>
                                            <Input value={form.gmarketSellerId} onChange={(event) => updateForm("gmarketSellerId", event.target.value)} placeholder="G마켓 판매자 ID" />
                                        </Field>
                                    </div>
                                    <Field label="Secret Key" required>
                                        <Input type="password" value={form.gmarketSecretKey} onChange={(event) => updateForm("gmarketSecretKey", event.target.value)} placeholder="ESM Trading API Secret Key" />
                                    </Field>
                                </div>
                            ) : null}
                            {selectedMarket === "auction" ? (
                                <div className="grid gap-3">
                                    <div className="grid gap-3 md:grid-cols-2">
                                        <Field label="Master ID" required>
                                            <Input value={form.auctionMasterId} onChange={(event) => updateForm("auctionMasterId", event.target.value)} placeholder="ESM+ 마스터 ID" />
                                        </Field>
                                        <Field label="Seller ID" required>
                                            <Input value={form.auctionSellerId} onChange={(event) => updateForm("auctionSellerId", event.target.value)} placeholder="옥션 판매자 ID" />
                                        </Field>
                                    </div>
                                    <Field label="Secret Key" required>
                                        <Input type="password" value={form.auctionSecretKey} onChange={(event) => updateForm("auctionSecretKey", event.target.value)} placeholder="ESM Trading API Secret Key" />
                                    </Field>
                                </div>
                            ) : null}
                        </div>
                    </div>

                    <div className="flex items-center justify-between gap-3 border-t px-5 py-4">
                        <Button variant="secondary" onClick={testConnection}>
                            테스트
                        </Button>
                        <div className="flex gap-2">
                            <Button variant="outline" onClick={() => setAddDialogOpen(false)}>
                                취소
                            </Button>
                            <Button disabled={!canSubmit || pendingAction === "add"} onClick={addAccount}>
                                {pendingAction === "add" ? "저장 중..." : "추가"}
                            </Button>
                        </div>
                    </div>
                </DialogContent>
            </Dialog>

            <Dialog open={Boolean(editingAccount)} onOpenChange={(open) => !open && setEditingAccount(null)}>
                <DialogContent className="max-h-[90vh] max-w-[620px] overflow-y-auto p-0">
                    <DialogHeader className="border-b px-5 py-4">
                        <DialogTitle>계정 수정</DialogTitle>
                    </DialogHeader>
                    {editingAccount ? (
                        <>
                            <div className="space-y-5 px-5 py-4">
                                <div className="grid gap-3">
                                    <h3 className="text-sm font-bold text-foreground">기본 정보</h3>
                                    <Field label="마켓플레이스" required>
                                        <Select value={editingAccount.market} disabled>
                                            <SelectTrigger className="h-10 w-full border-border bg-muted">
                                                <SelectValue />
                                            </SelectTrigger>
                                            <SelectContent>
                                                {(Object.keys(MARKET_LABELS) as MarketKey[]).map((market) => (
                                                    <SelectItem key={market} value={market}>
                                                        {MARKET_LABELS[market]}
                                                    </SelectItem>
                                                ))}
                                            </SelectContent>
                                        </Select>
                                    </Field>
                                </div>

                                <div className="grid gap-3">
                                    <div className="grid gap-3 md:grid-cols-2">
                                        <Field label="스토어명" required>
                                            <Input value={editForm.storeName} onChange={(event) => updateEditForm("storeName", event.target.value)} placeholder="스토어 이름을 입력하세요" />
                                        </Field>
                                        <Field label="사업자번호" required>
                                            <Input value={editForm.businessNumber} onChange={(event) => updateEditForm("businessNumber", event.target.value)} placeholder="000-00-00000" />
                                        </Field>
                                    </div>
                                </div>

                                <Separator />

                                <div className="grid gap-3">
                                    <div>
                                        <h3 className="text-sm font-bold text-foreground">배송중 처리 기본값</h3>
                                        <p className="mt-1 text-xs leading-5 text-muted-foreground">
                                            주문의 개별·일괄·자동 배송중 처리에서 이 값을 기본으로 사용합니다. 주문에서 다른 방식을 선택하면 주문 선택값을 우선합니다.
                                        </p>
                                    </div>
                                    <Select
                                        value={editingAccount.shippingProcessPreference}
                                        onValueChange={(value) => setEditingAccount((current) => current ? {
                                            ...current,
                                            shippingProcessPreference: value as ShippingProcessPreference,
                                        } : current)}
                                    >
                                        <SelectTrigger className="h-10 w-full border-border bg-card">
                                            <SelectValue />
                                        </SelectTrigger>
                                        <SelectContent>
                                            <SelectItem value="DELIVERY">송장입력으로 처리</SelectItem>
                                            {supportsConfigurableShippingMethod(editingAccount.market) ? (
                                                <SelectItem value="DIRECT_DELIVERY">직접전달로 처리</SelectItem>
                                            ) : null}
                                            {editingAccount.market === "naver" ? (
                                                <SelectItem value="OVERSEAS_OTHER_DELIVERY">해외기타배송으로 처리</SelectItem>
                                            ) : null}
                                        </SelectContent>
                                    </Select>
                                    {supportsConfigurableShippingMethod(editingAccount.market) ? (
                                        <div className="flex gap-2 rounded-md border border-border bg-muted/60 px-3 py-2 text-xs leading-5 text-muted-foreground">
                                            <LockKeyhole className="mt-0.5 size-4 shrink-0" />
                                            <span>전송된 주문의 처리 방식은 API로 바꿀 수 없습니다. 변경이 필요하면 마켓 관리자에서 직접 수정한 뒤 주문을 다시 수집해야 합니다.</span>
                                        </div>
                                    ) : (
                                        <div className="rounded-md border border-border bg-muted/60 px-3 py-2 text-xs leading-5 text-muted-foreground">
                                            {MARKET_LABELS[editingAccount.market]}는 송장입력 방식으로 고정됩니다.
                                        </div>
                                    )}
                                </div>

                                <Separator />

                                <div className="rounded-md border border-border bg-muted px-3 py-2 text-xs leading-5 text-muted-foreground">
                                    저장된 API 비밀키는 화면에 다시 표시하지 않습니다. 키를 교체하려면 별도의 재인증 절차를 사용해야 합니다.
                                </div>
                                {editingAccount.market === "naver" && editingAccount.source === "api" ? (
                                    <div className="grid gap-3 rounded-md border border-border bg-muted/60 p-3">
                                        <div>
                                            <h3 className="text-sm font-bold text-foreground">자격증명 교체 및 재인증</h3>
                                            <p className="mt-1 text-xs leading-5 text-muted-foreground">
                                                새 키를 저장하면 기존 키는 즉시 폐기되고 API 쓰기 기능은 연결 확인이 끝날 때까지 비활성화됩니다.
                                            </p>
                                        </div>
                                        <div className="grid gap-3 md:grid-cols-2">
                                            <Field label="새 Client ID">
                                                <Input value={editForm.naverClientId} onChange={(event) => updateEditForm("naverClientId", event.target.value)} autoComplete="off" />
                                            </Field>
                                            <Field label="새 Client Secret">
                                                <Input type="password" value={editForm.naverClientSecret} onChange={(event) => updateEditForm("naverClientSecret", event.target.value)} autoComplete="new-password" />
                                            </Field>
                                        </div>
                                        <Button
                                            type="button"
                                            variant="secondary"
                                            disabled={!canRotateCredentials || pendingAction === `credentials:${editingAccount.id}`}
                                            onClick={rotateEditingCredentials}
                                        >
                                            {pendingAction === `credentials:${editingAccount.id}` ? "교체 중..." : "자격증명 교체 후 재확인"}
                                        </Button>
                                    </div>
                                ) : null}
                            </div>

                            <div className="flex items-center justify-between gap-3 border-t px-5 py-4">
                                <Button variant="secondary" disabled={pendingAction === `verify:${editingAccount.id}`} onClick={testEditConnection}>
                                    {pendingAction === `verify:${editingAccount.id}` ? "확인 접수 중..." : "연결 다시 확인"}
                                </Button>
                                <div className="flex gap-2">
                                    <Button variant="outline" onClick={() => setEditingAccount(null)}>
                                        취소
                                    </Button>
                                    <Button disabled={!canSubmitEdit || pendingAction === `edit:${editingAccount.id}`} onClick={saveEditingAccount}>
                                        {pendingAction === `edit:${editingAccount.id}` ? "저장 중..." : "저장"}
                                    </Button>
                                </div>
                            </div>
                        </>
                    ) : null}
                </DialogContent>
            </Dialog>

            <Dialog open={Boolean(deletingAccount)} onOpenChange={(open) => !open && setDeletingAccount(null)}>
                <DialogContent className="max-w-[420px] p-0">
                    <DialogHeader className="border-b px-5 py-4">
                        <DialogTitle>계정 삭제</DialogTitle>
                    </DialogHeader>
                    <div className="px-5 py-4 text-sm leading-6 text-foreground">
                        <p className="font-semibold text-foreground">{deletingAccount?.storeName}</p>
                        <p>이 마켓 연동 계정을 삭제할까요?</p>
                    </div>
                    <div className="flex justify-end gap-2 border-t px-5 py-4">
                        <Button variant="outline" onClick={() => setDeletingAccount(null)}>
                            취소
                        </Button>
                        <Button variant="destructive" disabled={Boolean(deletingAccount && pendingAction === `delete:${deletingAccount.id}`)} onClick={deleteAccount}>
                            {deletingAccount && pendingAction === `delete:${deletingAccount.id}` ? "삭제 중..." : "삭제"}
                        </Button>
                    </div>
                </DialogContent>
            </Dialog>

            <Card className="mt-6 overflow-hidden rounded-xl shadow-sm">
                    <div className="flex items-center justify-between border-b bg-muted px-4 py-3">
                        <h2 className="text-base font-bold text-foreground">연동 계정</h2>
                        <div className="text-xs text-muted-foreground">
                            활성 {accounts.filter((account) => account.active).length}개 / 전체 {accounts.length}개
                        </div>
                    </div>
                    {accountsQuery.isError ? (
                        <div className="border-b border-border bg-muted px-4 py-2 text-xs text-foreground">
                            실서비스 DB에 연결하지 못해 데모 계정을 표시합니다. PostgreSQL·마이그레이션·개발 인증 설정을 확인하세요.
                        </div>
                    ) : null}
                    <div className="overflow-x-auto">
                        <Table>
                            <TableHeader>
                                <TableRow className="bg-muted/50">
                                    <TableHead>마켓</TableHead>
                                    <TableHead>스토어명</TableHead>
                                    <TableHead>기본 배송중 처리</TableHead>
                                    <TableHead>연동상태</TableHead>
                                    <TableHead>활성</TableHead>
                                    <TableHead className="text-right">관리</TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {accounts.map((account) => (
                                    <TableRow key={account.id}>
                                        <TableCell className="whitespace-nowrap font-medium">{MARKET_LABELS[account.market]}</TableCell>
                                        <TableCell className="whitespace-nowrap text-xs font-semibold">{account.storeName}</TableCell>
                                        <TableCell>
                                            <Badge variant="outline" className="whitespace-nowrap border-border bg-muted text-foreground">
                                                {shippingPreferenceLabel(account.shippingProcessPreference)}
                                            </Badge>
                                        </TableCell>
                                        <TableCell>
                                            <Badge variant="outline" className={authBadgeClass(account.authStatus)}>
                                                {authLabel[account.authStatus]}
                                            </Badge>
                                        </TableCell>
                                        <TableCell>
                                            <Switch
                                                checked={account.active}
                                                disabled={pendingAction === `toggle:${account.id}`}
                                                onCheckedChange={(checked) => toggleActive(account, checked)}
                                            />
                                        </TableCell>
                                        <TableCell className="text-right">
                                            <Button
                                                variant="ghost"
                                                size="icon"
                                                disabled={account.authStatus !== "connected" || pendingAction === `sync:${account.id}`}
                                                onClick={() => triggerSync(account)}
                                            >
                                                <RefreshCw className={pendingAction === `sync:${account.id}` ? "h-4 w-4 animate-spin" : "h-4 w-4"} />
                                                <span className="sr-only">주문수집</span>
                                            </Button>
                                            <Button variant="ghost" size="icon" onClick={() => openEditDialog(account)}>
                                                <Settings className="h-4 w-4" />
                                                <span className="sr-only">설정</span>
                                            </Button>
                                            <Button variant="ghost" size="icon" disabled={pendingAction === `delete:${account.id}`} onClick={() => setDeletingAccount(account)}>
                                                <Trash2 className="h-4 w-4" />
                                                <span className="sr-only">삭제</span>
                                            </Button>
                                        </TableCell>
                                    </TableRow>
                                ))}
                            </TableBody>
                        </Table>
                    </div>
            </Card>
        </div>
    );
}

function canSubmitMarketForm(market: MarketKey, form: AddForm) {
    const hasCommonFields = Boolean(form.storeName.trim() && form.businessNumber.trim());
    if (!hasCommonFields) return false;
    if (market === "naver") return Boolean(form.naverSellerId.trim() && form.naverClientId.trim() && form.naverClientSecret.trim());
    if (market === "coupang") return Boolean(form.coupangVendorId.trim() && form.coupangAccessKey.trim() && form.coupangSecretKey.trim() && form.coupangWingLoginId.trim());
    if (market === "11st") return Boolean(form.elevenSellerId.trim() && form.elevenApiKey.trim());
    if (market === "gmarket") return Boolean(form.gmarketMasterId.trim() && form.gmarketSellerId.trim() && form.gmarketSecretKey.trim());
    return Boolean(form.auctionMasterId.trim() && form.auctionSellerId.trim() && form.auctionSecretKey.trim());
}

function createEditForm(account: MarketAccount): AddForm {
    return {
        ...emptyForm,
        storeName: account.storeName,
        businessNumber: account.businessNumber ?? "",
        shippingProcessPreference: account.shippingProcessPreference,
    };
}

function createAccountPayload(market: MarketKey, form: AddForm): Record<string, unknown> {
    const common = {
        storeName: form.storeName.trim(),
        settings: {
            businessNumber: form.businessNumber.trim(),
            feeRate: defaultFeeRate[market],
            directDeliveryEnabled: supportsConfigurableShippingMethod(market)
                && form.shippingProcessPreference === "DIRECT_DELIVERY",
            shippingProcessPreference: supportsShippingProcessPreference(market, form.shippingProcessPreference)
                ? form.shippingProcessPreference
                : "DELIVERY",
        },
    };

    if (market === "naver") {
        return {
            ...common,
            marketCode: "NAVER",
            sellerId: form.naverSellerId.trim(),
            credentials: {
                clientId: form.naverClientId.trim(),
                clientSecret: form.naverClientSecret,
                type: "SELF",
            },
        };
    }

    if (market === "coupang") {
        return {
            ...common,
            marketCode: "COUPANG",
            sellerId: form.coupangVendorId.trim(),
            externalAccountId: form.coupangWingLoginId.trim(),
            credentials: {
                vendorId: form.coupangVendorId.trim(),
                accessKey: form.coupangAccessKey.trim(),
                secretKey: form.coupangSecretKey,
            },
        };
    }

    if (market === "11st") {
        return {
            ...common,
            marketCode: "ELEVEN_STREET",
            sellerId: form.elevenSellerId.trim(),
            credentials: { apiKey: form.elevenApiKey.trim() },
        };
    }

    const isGmarket = market === "gmarket";
    return {
        ...common,
        marketCode: isGmarket ? "GMARKET" : "AUCTION",
        sellerId: isGmarket ? form.gmarketSellerId.trim() : form.auctionSellerId.trim(),
        credentials: {
            masterId: isGmarket ? form.gmarketMasterId.trim() : form.auctionMasterId.trim(),
            secretKey: isGmarket ? form.gmarketSecretKey : form.auctionSecretKey,
            siteSellerId: isGmarket ? form.gmarketSellerId.trim() : form.auctionSellerId.trim(),
        },
    };
}

function toUiMarketAccount(account: ApiMarketAccount): MarketAccount {
    const marketMap: Record<ApiMarketAccount["marketCode"], MarketKey> = {
        NAVER: "naver",
        COUPANG: "coupang",
        ELEVEN_STREET: "11st",
        GMARKET: "gmarket",
        AUCTION: "auction",
    };
    const market = marketMap[account.marketCode];
    const feeRate = typeof account.settings.feeRate === "number"
        ? account.settings.feeRate
        : defaultFeeRate[market];
    const businessNumber = typeof account.settings.businessNumber === "string"
        ? account.settings.businessNumber
        : "";
    const rawShippingPreference = account.settings.shippingProcessPreference;
    const shippingProcessPreference: ShippingProcessPreference = (
        rawShippingPreference === "DIRECT_DELIVERY"
        || rawShippingPreference === "OVERSEAS_OTHER_DELIVERY"
    ) && supportsShippingProcessPreference(market, rawShippingPreference)
        ? rawShippingPreference
        : "DELIVERY";
    const authStatus: MarketAccount["authStatus"] = account.authStatus === "CONNECTED"
        ? "connected"
        : account.authStatus === "ERROR"
            ? "error"
            : account.authStatus === "EXPIRED" || account.authStatus === "REAUTH_REQUIRED"
                ? "reauth"
                : "pending";

    return {
        id: account.id,
        market,
        storeName: account.storeName,
        sellerAccount: account.sellerId,
        authStatus,
        active: account.isActive,
        lastCollectedAt: account.lastSuccessfulSyncAt
            ? new Date(account.lastSuccessfulSyncAt).toLocaleString("ko-KR")
            : "-",
        lastResult: account.lastErrorCode ? "failed" : account.lastSuccessfulSyncAt ? "success" : "-",
        feeRate,
        version: account.version,
        businessNumber,
        shippingProcessPreference,
        source: "api",
    };
}

async function apiRequest<T = unknown>(url: string, init?: RequestInit): Promise<T> {
    const response = await fetch(url, withBrowserSecurity(init));
    const text = await response.text();
    const payload = text ? JSON.parse(text) as ApiEnvelope<T> & { error?: { message?: string } } : null;

    if (!response.ok) {
        throw new Error(payload?.error?.message ?? `요청을 처리하지 못했습니다. (${response.status})`);
    }

    return payload?.data as T;
}

function errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : "요청을 처리하지 못했습니다.";
}

function authBadgeClass(status: MarketAccount["authStatus"]): string {
    if (status === "connected") return "border-border bg-muted text-foreground";
    if (status === "error") return "border-border bg-muted text-foreground";
    if (status === "reauth") return "border-border bg-muted text-foreground";
    return "border-border bg-muted text-foreground";
}

function supportsConfigurableShippingMethod(market: MarketKey): boolean {
    return market === "naver" || market === "11st";
}

function supportsShippingProcessPreference(
    market: MarketKey,
    preference: ShippingProcessPreference,
): boolean {
    if (preference === "DELIVERY") return true;
    if (preference === "OVERSEAS_OTHER_DELIVERY") return market === "naver";
    return supportsConfigurableShippingMethod(market);
}

function shippingPreferenceLabel(preference: ShippingProcessPreference): string {
    if (preference === "DIRECT_DELIVERY") return "직접전달";
    if (preference === "OVERSEAS_OTHER_DELIVERY") return "해외기타배송";
    return "송장입력";
}

function ShippingPreferenceField({
    market,
    value,
    onValueChange,
}: {
    market: MarketKey;
    value: ShippingProcessPreference;
    onValueChange: (value: ShippingProcessPreference) => void;
}) {
    const configurable = supportsConfigurableShippingMethod(market);

    return (
        <div className="grid gap-3">
            <div>
                <h3 className="text-sm font-bold text-foreground">배송중 처리 기본값</h3>
                <p className="mt-1 text-xs leading-5 text-muted-foreground">
                    {configurable
                        ? "이 스토어 주문의 개별·일괄·자동 배송중 처리에 사용할 기본 방식을 선택하세요. 주문에서는 다른 지원 방식으로 변경할 수 있습니다."
                        : `${MARKET_LABELS[market]}는 송장입력 방식으로 고정됩니다.`}
                </p>
            </div>
            <Select
                value={supportsShippingProcessPreference(market, value) ? value : "DELIVERY"}
                disabled={!configurable}
                onValueChange={(next) => onValueChange(next as ShippingProcessPreference)}
            >
                <SelectTrigger className="h-10 w-full border-border bg-card">
                    <SelectValue />
                </SelectTrigger>
                <SelectContent>
                    <SelectItem value="DELIVERY">송장입력</SelectItem>
                    {configurable ? <SelectItem value="DIRECT_DELIVERY">직접전달</SelectItem> : null}
                    {market === "naver" ? <SelectItem value="OVERSEAS_OTHER_DELIVERY">해외기타배송</SelectItem> : null}
                </SelectContent>
            </Select>
            {configurable ? (
                <div className="flex gap-2 rounded-md border border-border bg-muted/60 px-3 py-2 text-xs leading-5 text-muted-foreground">
                    <LockKeyhole className="mt-0.5 size-4 shrink-0" />
                    <span>마켓 전송 후에는 API로 방식을 변경할 수 없습니다. 오발송 시 마켓 관리자에서 직접 수정해야 합니다.</span>
                </div>
            ) : null}
        </div>
    );
}

function Field({ label, children, required = false }: { label: string; children: ReactNode; required?: boolean }) {
    return (
        <div className="grid gap-1.5">
            <Label className="text-xs font-bold text-muted-foreground">
                {label}
                {required ? <span className="ml-0.5 text-foreground">*</span> : null}
            </Label>
            {children}
        </div>
    );
}
