"use client";

import * as React from "react";
import { Suspense } from "react";
import {
    ChevronDown,
    ChevronRight,
    ClipboardList,
    DatabaseBackup,
    Filter,
    Globe2,
    Heart,
    ReceiptText,
    Search,
    ShoppingBag,
    Truck,
} from "lucide-react";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import {
    Sidebar,
    SidebarContent,
    SidebarFooter,
    SidebarHeader,
    SidebarMenu,
    SidebarMenuButton,
    SidebarMenuItem,
} from "@/components/ui/sidebar";
import { cn } from "@/lib/utils";

const orderSubMenus = [
    { title: "주문수집", href: "/orders" },
    { title: "취소/반품/교환", href: "/orders?view=claims" },
    { title: "문의관리", href: "/inquiries" },
    { title: "마켓연동", href: "/me/markets" },
];

function isOrderArea(pathname: string) {
    return pathname === "/orders" || pathname === "/inquiries" || pathname === "/me/markets";
}

function isSubMenuActive(href: string, pathname: string, view: string | null) {
    const [path, query] = href.split("?");
    if (pathname !== path) return false;

    const targetView = query ? new URLSearchParams(query).get("view") : null;
    if (targetView) return view === targetView;

    return path === "/orders" ? view !== "claims" : true;
}

export function AppSidebar(props: React.ComponentProps<typeof Sidebar>) {
    return (
        <Suspense fallback={<Sidebar variant="sidebar" collapsible="icon" {...props} />}>
            <AppSidebarContent {...props} />
        </Suspense>
    );
}

function AppSidebarContent({ ...props }: React.ComponentProps<typeof Sidebar>) {
    const pathname = usePathname();
    const searchParams = useSearchParams();
    const view = searchParams.get("view");
    const orderOpen = isOrderArea(pathname);
    const resetDemoData = () => {
        window.localStorage.removeItem("jumunpangpang.syncedInvoices");
        window.localStorage.removeItem("jumunpangpang.sourcingMatches");
        window.localStorage.removeItem("jumunpangpang.sourcingPayments");
        window.location.reload();
    };

    return (
        <Sidebar variant="sidebar" collapsible="icon" className="border-r border-slate-200 bg-white" {...props}>
            <SidebarHeader className="border-b border-slate-100 px-3 py-3">
                <div className="flex h-9 items-center justify-between">
                    <Link href="/orders" className="text-[22px] font-extrabold tracking-tight text-black">
                        소싱라이프
                    </Link>
                    <button
                        type="button"
                        className="h-8 rounded-md border border-slate-300 bg-white px-3 text-sm font-bold text-slate-900 shadow-sm hover:bg-slate-50"
                    >
                        닫기
                    </button>
                </div>
                <div className="mt-3 grid grid-cols-2 rounded-lg border border-slate-200 bg-slate-50 p-1">
                    <button type="button" className="h-9 rounded-md bg-[#ff321c] text-[15px] font-extrabold text-white shadow-sm">
                        타오바오
                    </button>
                    <button type="button" className="h-9 rounded-md text-[15px] font-extrabold text-slate-600 hover:bg-white">
                        1688
                    </button>
                </div>
            </SidebarHeader>

            <SidebarContent className="px-1.5 py-3">
                <SidebarMenu className="gap-1">
                    <SidebarMenuItem>
                        <SidebarMenuButton asChild tooltip="아이템 검색" className="h-12 rounded-md bg-[#ff321c] px-4 text-[16px] font-extrabold text-white hover:bg-[#ff321c]">
                            <button type="button" disabled className="flex w-full cursor-default items-center gap-3">
                                <Search className="size-5 shrink-0 text-white" />
                                <span>아이템 검색</span>
                            </button>
                        </SidebarMenuButton>
                    </SidebarMenuItem>

                    <SidebarMenuItem>
                        <SidebarMenuButton
                            asChild
                            tooltip="주문관리"
                            isActive={orderOpen}
                            className="h-12 rounded-md px-4 text-[16px] font-extrabold text-slate-900 transition data-[active=true]:bg-red-50 data-[active=true]:text-[#ff321c] hover:bg-slate-50"
                        >
                            <Link href="/orders" className="flex items-center gap-3">
                                <ClipboardList className={cn("size-5 shrink-0", orderOpen ? "text-[#ff321c]" : "text-slate-400")} />
                                <span>주문관리</span>
                                <ChevronRight className={cn("ml-auto size-4 transition", orderOpen && "rotate-90 text-[#ff321c]")} />
                            </Link>
                        </SidebarMenuButton>
                    </SidebarMenuItem>

                    {orderOpen && (
                        <div className="mb-1 ml-7 mt-1 space-y-1 border-l border-slate-200 pl-3">
                            {orderSubMenus.map((item) => {
                                const active = isSubMenuActive(item.href, pathname, view);
                                return (
                                    <Link
                                        key={item.title}
                                        href={item.href}
                                        className={cn(
                                            "flex h-8 items-center rounded-md px-2 text-[13px] font-bold transition",
                                            active ? "bg-red-50 text-[#ff321c]" : "text-slate-600 hover:bg-slate-50 hover:text-slate-900",
                                        )}
                                    >
                                        {item.title}
                                    </Link>
                                );
                            })}
                        </div>
                    )}

                    <StaticMenu icon={Heart} title="찜 리스트" />
                    <StaticMenu icon={ShoppingBag} title="장바구니" />
                    <StaticMenu icon={ReceiptText} title="주문 내역" />
                    <StaticMenu icon={Truck} title="배송 조회" />
                    <StaticMenu icon={Globe2} title="통관고유부호" />
                </SidebarMenu>
            </SidebarContent>

            <SidebarFooter className="gap-3 border-t border-slate-100 px-2 py-3">
                <div className="rounded-lg border border-slate-200 bg-white p-3 shadow-sm">
                    <div className="flex items-center gap-2">
                        <div className="flex h-7 w-10 items-center justify-center rounded-lg bg-red-600 text-[15px] font-black text-yellow-300">
                            ★
                        </div>
                        <div className="min-w-0">
                            <div className="text-sm font-extrabold text-slate-900">CNY 1元 = 223.95원</div>
                            <div className="text-xs font-medium text-slate-500">2026-06-17 18:15 (2분 전)</div>
                        </div>
                    </div>
                </div>
                <button
                    type="button"
                    className="flex h-11 items-center justify-between rounded-lg border border-slate-200 bg-white px-4 text-sm font-extrabold text-slate-900 shadow-sm hover:bg-slate-50"
                >
                    <span className="flex items-center gap-2">
                        <Filter className="size-4 text-[#ff321c]" />
                        검색 필터 상세설정
                    </span>
                    <ChevronDown className="size-4 text-slate-900" />
                </button>
                <button
                    type="button"
                    className="flex h-9 items-center justify-center gap-2 rounded-md border border-slate-200 bg-slate-50 text-xs font-bold text-slate-500 hover:bg-white"
                    onClick={resetDemoData}
                >
                    <DatabaseBackup className="size-3.5" />
                    데이터 초기화
                </button>
            </SidebarFooter>
        </Sidebar>
    );
}

function StaticMenu({ icon: Icon, title }: { icon: React.ComponentType<{ className?: string }>; title: string }) {
    return (
        <SidebarMenuItem>
            <SidebarMenuButton asChild tooltip={title} className="h-12 rounded-md px-4 text-[16px] font-extrabold text-slate-900 hover:bg-slate-50">
                <button type="button" disabled className="flex w-full cursor-default items-center gap-3">
                    <Icon className="size-5 shrink-0 text-slate-400" />
                    <span>{title}</span>
                </button>
            </SidebarMenuButton>
        </SidebarMenuItem>
    );
}
