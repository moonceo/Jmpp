"use client";

import { ReactNode, useMemo, useState } from "react";
import { Settings, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { MARKET_LABELS } from "@/lib/constants/orders";

type MarketKey = "naver" | "coupang" | "11st" | "gmarket" | "auction";

type MarketAccount = {
    id: string;
    market: MarketKey;
    storeName: string;
    sellerAccount: string;
    authStatus: "connected" | "pending";
    active: boolean;
    lastCollectedAt: string;
    lastResult: "success" | "failed" | "-";
    feeRate: number;
};

type AddForm = {
    storeName: string;
    businessNumber: string;
    naverSellerId: string;
    naverClientId: string;
    naverClientSecret: string;
    coupangVendorId: string;
    coupangAccessKey: string;
    coupangSecretKey: string;
    coupangWingLoginId: string;
    elevenApiKey: string;
    gmarketMasterId: string;
    gmarketSellerId: string;
    auctionMasterId: string;
    auctionSellerId: string;
};

const initialAccounts: MarketAccount[] = [
    { id: "acct-01", market: "naver", storeName: "리빙온마켓", sellerAccount: "naver_living_01", authStatus: "connected", active: true, lastCollectedAt: "2026-06-15 09:42", lastResult: "success", feeRate: 3.6 },
    { id: "acct-02", market: "naver", storeName: "홈데코랩", sellerAccount: "naver_home_02", authStatus: "connected", active: true, lastCollectedAt: "2026-06-15 09:39", lastResult: "success", feeRate: 3.8 },
    { id: "acct-03", market: "coupang", storeName: "쿠팡라이프샵", sellerAccount: "coupang_wing_01", authStatus: "connected", active: true, lastCollectedAt: "2026-06-15 09:36", lastResult: "success", feeRate: 10.8 },
    { id: "acct-04", market: "coupang", storeName: "스마트홈셀러", sellerAccount: "coupang_wing_02", authStatus: "connected", active: true, lastCollectedAt: "2026-06-15 09:10", lastResult: "success", feeRate: 10.8 },
    { id: "acct-05", market: "11st", storeName: "글로벌픽스토어", sellerAccount: "11st_global_01", authStatus: "connected", active: true, lastCollectedAt: "2026-06-15 09:32", lastResult: "success", feeRate: 13 },
    { id: "acct-06", market: "11st", storeName: "홈앤키친11", sellerAccount: "11st_home_02", authStatus: "connected", active: true, lastCollectedAt: "2026-06-15 09:28", lastResult: "success", feeRate: 13 },
    { id: "acct-07", market: "gmarket", storeName: "지마켓리빙박스", sellerAccount: "gmarket_living_01", authStatus: "connected", active: true, lastCollectedAt: "2026-06-15 09:24", lastResult: "success", feeRate: 12 },
    { id: "acct-08", market: "gmarket", storeName: "데일리홈마켓", sellerAccount: "gmarket_home_02", authStatus: "connected", active: true, lastCollectedAt: "2026-06-15 09:21", lastResult: "success", feeRate: 12 },
    { id: "acct-09", market: "auction", storeName: "옥션리빙셀렉트", sellerAccount: "auction_living_01", authStatus: "connected", active: true, lastCollectedAt: "2026-06-15 09:18", lastResult: "success", feeRate: 12 },
    { id: "acct-10", market: "auction", storeName: "하우스웨어옥션", sellerAccount: "auction_home_02", authStatus: "connected", active: true, lastCollectedAt: "2026-06-15 09:15", lastResult: "success", feeRate: 12 },
];

const emptyForm: AddForm = {
    storeName: "",
    businessNumber: "",
    naverSellerId: "",
    naverClientId: "",
    naverClientSecret: "",
    coupangVendorId: "",
    coupangAccessKey: "",
    coupangSecretKey: "",
    coupangWingLoginId: "",
    elevenApiKey: "",
    gmarketMasterId: "",
    gmarketSellerId: "",
    auctionMasterId: "",
    auctionSellerId: "",
};

const authLabel = {
    connected: "연동 완료",
    pending: "확인 대기",
};

const defaultFeeRate: Record<MarketKey, number> = {
    naver: 3.6,
    coupang: 10.8,
    "11st": 13,
    gmarket: 12,
    auction: 12,
};

export default function MarketsPage() {
    const [accounts, setAccounts] = useState(initialAccounts);
    const [selectedMarket, setSelectedMarket] = useState<MarketKey>("naver");
    const [form, setForm] = useState<AddForm>(emptyForm);
    const [addDialogOpen, setAddDialogOpen] = useState(false);
    const [editingAccount, setEditingAccount] = useState<MarketAccount | null>(null);
    const [editForm, setEditForm] = useState<AddForm>(emptyForm);
    const [deletingAccount, setDeletingAccount] = useState<MarketAccount | null>(null);

    const canSubmit = useMemo(() => {
        return canSubmitMarketForm(selectedMarket, form);
    }, [form, selectedMarket]);

    const canSubmitEdit = useMemo(() => {
        if (!editingAccount) return false;
        return canSubmitMarketForm(editingAccount.market, editForm);
    }, [editForm, editingAccount]);

    const updateForm = (key: keyof AddForm, value: string) => {
        setForm((current) => ({ ...current, [key]: value }));
    };

    const updateEditForm = (key: keyof AddForm, value: string) => {
        setEditForm((current) => ({ ...current, [key]: value }));
    };

    const toggleActive = (id: string, active: boolean) => {
        setAccounts((current) => current.map((account) => account.id === id ? { ...account, active } : account));
    };

    const testConnection = () => {
        if (!canSubmit) {
            toast.info("필수 인증값을 먼저 입력하세요.");
            return;
        }
        toast.success(`${MARKET_LABELS[selectedMarket]} 연동 확인 요청을 준비했습니다.`);
    };

    const testEditConnection = () => {
        if (!editingAccount || !canSubmitEdit) {
            toast.info("필수 인증값을 먼저 입력하세요.");
            return;
        }
        toast.success(`${MARKET_LABELS[editingAccount.market]} 연동 확인 요청을 준비했습니다.`);
    };

    const openEditDialog = (account: MarketAccount) => {
        setEditingAccount(account);
        setEditForm(createEditForm(account));
    };

    const addAccount = () => {
        if (!canSubmit) {
            toast.info("필수 인증값을 먼저 입력하세요.");
            return;
        }

        const now = new Date().toISOString().slice(0, 16).replace("T", " ");
        setAccounts((current) => [
            {
                id: `acct-${String(current.length + 1).padStart(2, "0")}`,
                market: selectedMarket,
                storeName: form.storeName.trim(),
                sellerAccount: getFormAccountId(selectedMarket, form),
                authStatus: "pending",
                active: true,
                lastCollectedAt: now,
                lastResult: "-",
                feeRate: defaultFeeRate[selectedMarket],
            },
            ...current,
        ]);
        setForm(emptyForm);
        setAddDialogOpen(false);
        toast.success(`${MARKET_LABELS[selectedMarket]} 계정을 추가했습니다.`);
    };

    const saveEditingAccount = () => {
        if (!editingAccount) return;
        if (!canSubmitEdit) {
            toast.info("필수 인증값을 먼저 입력하세요.");
            return;
        }
        setAccounts((current) => current.map((account) => account.id === editingAccount.id ? {
            ...account,
            storeName: editForm.storeName.trim(),
            sellerAccount: getFormAccountId(editingAccount.market, editForm),
        } : account));
        setEditingAccount(null);
        setEditForm(emptyForm);
        toast.success("계정 정보를 수정했습니다.");
    };

    const deleteAccount = () => {
        if (!deletingAccount) return;
        setAccounts((current) => current.filter((account) => account.id !== deletingAccount.id));
        toast.success(`${deletingAccount.storeName} 계정을 삭제했습니다.`);
        setDeletingAccount(null);
    };

    return (
        <div className="min-h-svh bg-white px-6 py-5 xl:px-8">
            <div className="mb-5 flex items-center justify-between gap-3">
                <h1 className="text-[24px] font-extrabold tracking-tight text-slate-950">마켓연동</h1>
                <Button onClick={() => setAddDialogOpen(true)}>마켓 추가</Button>
            </div>

            <Dialog open={addDialogOpen} onOpenChange={setAddDialogOpen}>
                <DialogContent className="max-h-[90vh] max-w-[620px] overflow-y-auto p-0">
                    <DialogHeader className="border-b px-5 py-4">
                        <DialogTitle>마켓 추가</DialogTitle>
                    </DialogHeader>

                    <div className="space-y-5 px-5 py-4">
                        <div className="grid gap-3">
                            <h3 className="text-sm font-bold text-slate-800">기본 정보</h3>
                            <Field label="마켓플레이스" required>
                                <Select value={selectedMarket} onValueChange={(value) => setSelectedMarket(value as MarketKey)}>
                                    <SelectTrigger className="h-10 w-full border-slate-300 bg-white">
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
                                    <Input value={form.storeName} onChange={(event) => updateForm("storeName", event.target.value)} placeholder="스토어 이름을 입력하세요" />
                                </Field>
                                <Field label="사업자번호" required>
                                    <Input value={form.businessNumber} onChange={(event) => updateForm("businessNumber", event.target.value)} placeholder="000-00-00000" />
                                </Field>
                            </div>
                        </div>

                        <Separator />

                        <div className="grid gap-3">
                            <h3 className="text-sm font-bold text-slate-800">인증 정보</h3>
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
                                <Field label="API Key" required>
                                    <Input value={form.elevenApiKey} onChange={(event) => updateForm("elevenApiKey", event.target.value)} placeholder="11번가 Open API Key" />
                                </Field>
                            ) : null}
                            {selectedMarket === "gmarket" ? (
                                <div className="grid gap-3 md:grid-cols-2">
                                    <Field label="Master ID" required>
                                        <Input value={form.gmarketMasterId} onChange={(event) => updateForm("gmarketMasterId", event.target.value)} placeholder="ESM+ 마스터 ID" />
                                    </Field>
                                    <Field label="Seller ID" required>
                                        <Input value={form.gmarketSellerId} onChange={(event) => updateForm("gmarketSellerId", event.target.value)} placeholder="G마켓 판매자 ID" />
                                    </Field>
                                </div>
                            ) : null}
                            {selectedMarket === "auction" ? (
                                <div className="grid gap-3 md:grid-cols-2">
                                    <Field label="Master ID" required>
                                        <Input value={form.auctionMasterId} onChange={(event) => updateForm("auctionMasterId", event.target.value)} placeholder="ESM+ 마스터 ID" />
                                    </Field>
                                    <Field label="Seller ID" required>
                                        <Input value={form.auctionSellerId} onChange={(event) => updateForm("auctionSellerId", event.target.value)} placeholder="옥션 판매자 ID" />
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
                            <Button disabled={!canSubmit} onClick={addAccount}>
                                추가
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
                                    <h3 className="text-sm font-bold text-slate-800">기본 정보</h3>
                                    <Field label="마켓플레이스" required>
                                        <Select value={editingAccount.market} disabled>
                                            <SelectTrigger className="h-10 w-full border-slate-300 bg-slate-50">
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
                                    <h3 className="text-sm font-bold text-slate-800">인증 정보</h3>
                                    {editingAccount.market === "naver" ? (
                                        <div className="grid gap-3">
                                            <Field label="연동용 판매자 ID" required>
                                                <Input value={editForm.naverSellerId} onChange={(event) => updateEditForm("naverSellerId", event.target.value)} placeholder="스마트스토어 연동용 판매자 ID" />
                                            </Field>
                                            <div className="grid gap-3 md:grid-cols-2">
                                                <Field label="클라이언트 아이디" required>
                                                    <Input value={editForm.naverClientId} onChange={(event) => updateEditForm("naverClientId", event.target.value)} placeholder="네이버 Commerce API Client ID" />
                                                </Field>
                                                <Field label="클라이언트 시크릿" required>
                                                    <Input type="password" value={editForm.naverClientSecret} onChange={(event) => updateEditForm("naverClientSecret", event.target.value)} placeholder="네이버 Commerce API Client Secret" />
                                                </Field>
                                            </div>
                                        </div>
                                    ) : null}
                                    {editingAccount.market === "coupang" ? (
                                        <div className="grid gap-3">
                                            <Field label="쿠팡 업체코드(Vendor ID)" required>
                                                <Input value={editForm.coupangVendorId} onChange={(event) => updateEditForm("coupangVendorId", event.target.value)} placeholder="예: A00012345" />
                                            </Field>
                                            <Field label="Access Key" required>
                                                <Input value={editForm.coupangAccessKey} onChange={(event) => updateEditForm("coupangAccessKey", event.target.value)} placeholder="쿠팡 Open API Access Key" />
                                            </Field>
                                            <Field label="Secret Key" required>
                                                <Input type="password" value={editForm.coupangSecretKey} onChange={(event) => updateEditForm("coupangSecretKey", event.target.value)} placeholder="쿠팡 Open API Secret Key" />
                                            </Field>
                                            <Field label="쿠팡 윙 로그인 ID" required>
                                                <Input value={editForm.coupangWingLoginId} onChange={(event) => updateEditForm("coupangWingLoginId", event.target.value)} placeholder="쿠팡 윙 로그인 ID" />
                                            </Field>
                                        </div>
                                    ) : null}
                                    {editingAccount.market === "11st" ? (
                                        <Field label="API Key" required>
                                            <Input value={editForm.elevenApiKey} onChange={(event) => updateEditForm("elevenApiKey", event.target.value)} placeholder="11번가 Open API Key" />
                                        </Field>
                                    ) : null}
                                    {editingAccount.market === "gmarket" ? (
                                        <div className="grid gap-3 md:grid-cols-2">
                                            <Field label="Master ID" required>
                                                <Input value={editForm.gmarketMasterId} onChange={(event) => updateEditForm("gmarketMasterId", event.target.value)} placeholder="ESM+ 마스터 ID" />
                                            </Field>
                                            <Field label="Seller ID" required>
                                                <Input value={editForm.gmarketSellerId} onChange={(event) => updateEditForm("gmarketSellerId", event.target.value)} placeholder="G마켓 판매자 ID" />
                                            </Field>
                                        </div>
                                    ) : null}
                                    {editingAccount.market === "auction" ? (
                                        <div className="grid gap-3 md:grid-cols-2">
                                            <Field label="Master ID" required>
                                                <Input value={editForm.auctionMasterId} onChange={(event) => updateEditForm("auctionMasterId", event.target.value)} placeholder="ESM+ 마스터 ID" />
                                            </Field>
                                            <Field label="Seller ID" required>
                                                <Input value={editForm.auctionSellerId} onChange={(event) => updateEditForm("auctionSellerId", event.target.value)} placeholder="옥션 판매자 ID" />
                                            </Field>
                                        </div>
                                    ) : null}
                                </div>
                            </div>

                            <div className="flex items-center justify-between gap-3 border-t px-5 py-4">
                                <Button variant="secondary" onClick={testEditConnection}>
                                    테스트
                                </Button>
                                <div className="flex gap-2">
                                    <Button variant="outline" onClick={() => setEditingAccount(null)}>
                                        취소
                                    </Button>
                                    <Button disabled={!canSubmitEdit} onClick={saveEditingAccount}>
                                        저장
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
                    <div className="px-5 py-4 text-sm leading-6 text-slate-700">
                        <p className="font-semibold text-slate-950">{deletingAccount?.storeName}</p>
                        <p>이 마켓 연동 계정을 삭제할까요?</p>
                    </div>
                    <div className="flex justify-end gap-2 border-t px-5 py-4">
                        <Button variant="outline" onClick={() => setDeletingAccount(null)}>
                            취소
                        </Button>
                        <Button variant="destructive" onClick={deleteAccount}>
                            삭제
                        </Button>
                    </div>
                </DialogContent>
            </Dialog>

            <div>
                <section className="rounded-md border border-slate-200 bg-white shadow-sm">
                    <div className="flex items-center justify-between border-b bg-slate-50 px-4 py-3">
                        <h2 className="text-base font-bold text-slate-950">연동 계정</h2>
                        <div className="text-xs text-slate-500">
                            활성 {accounts.filter((account) => account.active).length}개 / 전체 {accounts.length}개
                        </div>
                    </div>
                    <div className="overflow-x-auto">
                        <Table>
                            <TableHeader>
                                <TableRow className="bg-muted/50">
                                    <TableHead>마켓</TableHead>
                                    <TableHead>스토어명</TableHead>
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
                                            <Badge variant="outline" className={account.authStatus === "connected" ? "border-emerald-200 bg-emerald-50 text-emerald-700" : "border-amber-200 bg-amber-50 text-amber-700"}>
                                                {authLabel[account.authStatus]}
                                            </Badge>
                                        </TableCell>
                                        <TableCell>
                                            <Switch checked={account.active} onCheckedChange={(checked) => toggleActive(account.id, checked)} />
                                        </TableCell>
                                        <TableCell className="text-right">
                                            <Button variant="ghost" size="icon" onClick={() => openEditDialog(account)}>
                                                <Settings className="h-4 w-4" />
                                                <span className="sr-only">설정</span>
                                            </Button>
                                            <Button variant="ghost" size="icon" onClick={() => setDeletingAccount(account)}>
                                                <Trash2 className="h-4 w-4" />
                                                <span className="sr-only">삭제</span>
                                            </Button>
                                        </TableCell>
                                    </TableRow>
                                ))}
                            </TableBody>
                        </Table>
                    </div>
                </section>
            </div>
        </div>
    );
}

function getFormAccountId(market: MarketKey, form: AddForm) {
    if (market === "naver") return form.naverSellerId.trim();
    if (market === "coupang") return form.coupangWingLoginId.trim();
    if (market === "11st") return form.elevenApiKey.trim();
    if (market === "gmarket") return form.gmarketSellerId.trim();
    return form.auctionSellerId.trim();
}

function canSubmitMarketForm(market: MarketKey, form: AddForm) {
    const hasCommonFields = Boolean(form.storeName.trim() && form.businessNumber.trim());
    if (!hasCommonFields) return false;
    if (market === "naver") return Boolean(form.naverSellerId.trim() && form.naverClientId.trim() && form.naverClientSecret.trim());
    if (market === "coupang") return Boolean(form.coupangVendorId.trim() && form.coupangAccessKey.trim() && form.coupangSecretKey.trim() && form.coupangWingLoginId.trim());
    if (market === "11st") return Boolean(form.elevenApiKey.trim());
    if (market === "gmarket") return Boolean(form.gmarketMasterId.trim() && form.gmarketSellerId.trim());
    return Boolean(form.auctionMasterId.trim() && form.auctionSellerId.trim());
}

function createEditForm(account: MarketAccount): AddForm {
    const nextForm = {
        ...emptyForm,
        storeName: account.storeName,
        businessNumber: "000-00-00000",
    };

    if (account.market === "naver") {
        return {
            ...nextForm,
            naverSellerId: account.sellerAccount,
            naverClientId: `${account.sellerAccount}_client`,
            naverClientSecret: "********",
        };
    }

    if (account.market === "coupang") {
        return {
            ...nextForm,
            coupangVendorId: `${account.sellerAccount}_vendor`,
            coupangAccessKey: `${account.sellerAccount}_access`,
            coupangSecretKey: "********",
            coupangWingLoginId: account.sellerAccount,
        };
    }

    if (account.market === "11st") {
        return {
            ...nextForm,
            elevenApiKey: account.sellerAccount,
        };
    }

    if (account.market === "gmarket") {
        return {
            ...nextForm,
            gmarketMasterId: "esm_master",
            gmarketSellerId: account.sellerAccount,
        };
    }

    return {
        ...nextForm,
        auctionMasterId: "esm_master",
        auctionSellerId: account.sellerAccount,
    };
}

function Field({ label, children, required = false }: { label: string; children: ReactNode; required?: boolean }) {
    return (
        <div className="grid gap-1.5">
            <Label className="text-xs font-bold text-slate-600">
                {label}
                {required ? <span className="ml-0.5 text-red-500">*</span> : null}
            </Label>
            {children}
        </div>
    );
}
