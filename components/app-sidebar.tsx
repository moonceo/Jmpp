"use client";

import * as React from "react";
import { Suspense } from "react";
import {
    BellRing,
    DatabaseBackup,
    Inbox,
    LayoutDashboard,
    LogOut,
    MessageSquareText,
    ReceiptText,
    RotateCcw,
    Route,
    Store,
} from "lucide-react";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import {
    Sidebar,
    SidebarContent,
    SidebarFooter,
    SidebarGroup,
    SidebarGroupContent,
    SidebarGroupLabel,
    SidebarHeader,
    SidebarMenu,
    SidebarMenuButton,
    SidebarMenuItem,
    useSidebar,
} from "@/components/ui/sidebar";
import { withBrowserSecurity } from "@/lib/client/http";

interface NavigationItem {
    title: string;
    description: string;
    href: string;
    icon: React.ComponentType<{ className?: string }>;
    isActive: (pathname: string, view: string | null) => boolean;
}

const overviewItems: NavigationItem[] = [
    {
        title: "대시보드",
        description: "통계와 남은 작업",
        href: "/dashboard",
        icon: LayoutDashboard,
        isActive: (pathname) => pathname === "/dashboard" || pathname === "/",
    },
    {
        title: "주문현황",
        description: "전체 흐름과 처리 이슈",
        href: "/journey",
        icon: Route,
        isActive: (pathname) => pathname === "/journey",
    },
];

const operationItems: NavigationItem[] = [
    {
        title: "주문수집",
        description: "판매처 주문 통합 처리",
        href: "/orders",
        icon: Inbox,
        isActive: (pathname, view) => pathname === "/orders" && view !== "claims",
    },
    {
        title: "취소·반품·교환",
        description: "구매자 클레임 처리",
        href: "/orders?view=claims",
        icon: RotateCcw,
        isActive: (pathname, view) => pathname === "/orders" && view === "claims",
    },
    {
        title: "문의관리",
        description: "판매처 문의 통합 응대",
        href: "/inquiries",
        icon: MessageSquareText,
        isActive: (pathname) => pathname === "/inquiries",
    },
];

const settingsItems: NavigationItem[] = [
    {
        title: "마켓연동",
        description: "판매처 계정과 수집 설정",
        href: "/me/markets",
        icon: Store,
        isActive: (pathname) => pathname === "/me/markets",
    },
    {
        title: "알림 설정",
        description: "고객·판매자 알림 정책",
        href: "/me/notifications",
        icon: BellRing,
        isActive: (pathname) => pathname === "/me/notifications",
    },
    {
        title: "장부 다운로드",
        description: "매출·비용·실제 마진",
        href: "/ledger",
        icon: ReceiptText,
        isActive: (pathname) => pathname === "/ledger" || pathname === "/me/ledger",
    },
];

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
    const { isMobile, setOpenMobile } = useSidebar();
    const view = searchParams.get("view");
    const closeMobileSidebar = () => {
        if (isMobile) setOpenMobile(false);
    };
    const resetDemoData = () => {
        window.localStorage.removeItem("jumunpangpang.syncedInvoices");
        window.localStorage.removeItem("jumunpangpang.sourcingMatches");
        window.localStorage.removeItem("jumunpangpang.sourcingPayments");
        window.location.reload();
    };
    const logout = async () => {
        try {
            await fetch("/api/auth/logout", withBrowserSecurity({ method: "POST" }));
        } finally {
            window.location.assign("/login");
        }
    };

    return (
        <Sidebar variant="sidebar" collapsible="icon" className="border-r border-sidebar-border" {...props}>
            <SidebarHeader className="border-b border-sidebar-border p-2">
                <SidebarMenu>
                    <SidebarMenuItem>
                        <SidebarMenuButton asChild size="lg" className="h-14 rounded-md px-2 hover:bg-sidebar-accent">
                            <Link href="/dashboard" onClick={closeMobileSidebar}>
                                <span className="grid size-9 shrink-0 place-items-center rounded-md bg-sidebar-primary text-xs font-black tracking-tight text-sidebar-primary-foreground">
                                    CL
                                </span>
                                <span className="grid min-w-0 flex-1 text-left leading-tight">
                                    <span className="truncate text-sm font-black tracking-tight">커머스라이프</span>
                                    <span className="truncate text-xs text-sidebar-foreground/60">ORDER OPERATIONS</span>
                                </span>
                            </Link>
                        </SidebarMenuButton>
                    </SidebarMenuItem>
                </SidebarMenu>
            </SidebarHeader>

            <SidebarContent className="py-2">
                <NavigationGroup
                    label="운영 개요"
                    items={overviewItems}
                    pathname={pathname}
                    view={view}
                    onNavigate={closeMobileSidebar}
                />
                <NavigationGroup
                    label="주문 운영"
                    items={operationItems}
                    pathname={pathname}
                    view={view}
                    onNavigate={closeMobileSidebar}
                />
                <NavigationGroup
                    label="데이터·설정"
                    items={settingsItems}
                    pathname={pathname}
                    view={view}
                    onNavigate={closeMobileSidebar}
                />
            </SidebarContent>

            <SidebarFooter className="border-t border-sidebar-border p-2">
                <SidebarMenu>
                    <SidebarMenuItem>
                        <SidebarMenuButton tooltip="데모 데이터 초기화" onClick={resetDemoData}>
                            <DatabaseBackup />
                            <span>데모 데이터 초기화</span>
                        </SidebarMenuButton>
                    </SidebarMenuItem>
                    <SidebarMenuItem>
                        <SidebarMenuButton tooltip="로그아웃" onClick={logout}>
                            <LogOut />
                            <span>로그아웃</span>
                        </SidebarMenuButton>
                    </SidebarMenuItem>
                </SidebarMenu>
            </SidebarFooter>
        </Sidebar>
    );
}

function NavigationGroup({
    label,
    items,
    pathname,
    view,
    onNavigate,
}: {
    label: string;
    items: NavigationItem[];
    pathname: string;
    view: string | null;
    onNavigate: () => void;
}) {
    return (
        <SidebarGroup>
            <SidebarGroupLabel className="text-xs font-bold uppercase tracking-[0.14em]">
                {label}
            </SidebarGroupLabel>
            <SidebarGroupContent>
                <SidebarMenu>
                    {items.map((item) => {
                        const active = item.isActive(pathname, view);
                        const Icon = item.icon;

                        return (
                            <SidebarMenuItem key={item.href}>
                                <SidebarMenuButton
                                    asChild
                                    tooltip={item.title}
                                    isActive={active}
                                    className="h-11 rounded-md data-[active=true]:font-bold"
                                >
                                    <Link href={item.href} onClick={onNavigate}>
                                        <Icon />
                                        <span className="grid min-w-0 flex-1 leading-tight">
                                            <span className="truncate text-sm">{item.title}</span>
                                            <span className="truncate text-xs font-normal text-sidebar-foreground/55 group-data-[collapsible=icon]:hidden">
                                                {item.description}
                                            </span>
                                        </span>
                                    </Link>
                                </SidebarMenuButton>
                            </SidebarMenuItem>
                        );
                    })}
                </SidebarMenu>
            </SidebarGroupContent>
        </SidebarGroup>
    );
}
