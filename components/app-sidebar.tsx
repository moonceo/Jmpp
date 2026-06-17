"use client";

import * as React from "react";
import { Suspense } from "react";
import { ChevronRight, DatabaseBackup, Download, Home, LayoutDashboard, MessageSquare, RefreshCw, ShoppingCart, User } from "lucide-react";
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
    SidebarMenuSub,
    SidebarMenuSubButton,
    SidebarMenuSubItem,
    SidebarGroup,
    SidebarGroupContent,
} from "@/components/ui/sidebar";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";

type NavSubItem = {
    title: string;
    url?: string;
    count?: number;
    priority?: boolean;
};

const orderCounts = {
    all: 4,
    new: 1,
    preparing: 3,
    waiting: 1,
    shipping: 1,
    delivered: 1,
    claims: 3,
};

const navItems = [
    {
        title: "대시보드",
        url: "/",
        icon: LayoutDashboard,
    },
    {
        title: "주문수집",
        url: "/orders",
        icon: ShoppingCart,
        items: [
            { title: "전체", url: "/orders" },
            { title: "신규주문", url: "/orders?view=new" },
            { title: "상품준비", url: "/orders?view=preparing" },
            { title: "발송대기", url: "/orders?view=waiting" },
            { title: "배송중", url: "/orders?view=shipping" },
            { title: "배송완료", url: "/orders?view=delivered" },
        ] satisfies NavSubItem[],
    },
    {
        title: "취소/반품/교환",
        url: "/orders?view=claims",
        icon: RefreshCw,
    },
    {
        title: "문의관리",
        url: "/inquiries",
        icon: MessageSquare,
    },
    {
        title: "장부 다운로드",
        url: "/ledger",
        icon: Download,
    },
    {
        title: "내 정보",
        url: "/me/markets",
        icon: User,
    },
];

function isSubItemActive(url: string | undefined, pathname: string, view: string | null) {
    if (!url) return false;
    const [path, query] = url.split("?");
    if (pathname !== path) return false;

    const itemView = query ? new URLSearchParams(query).get("view") : null;
    return itemView ? view === itemView : !view;
}

function isNavItemActive(url: string, pathname: string, view: string | null) {
    const [path, query] = url.split("?");
    if (pathname !== path && (path === "/" || !pathname.startsWith(path))) return false;

    const itemView = query ? new URLSearchParams(query).get("view") : null;
    if (itemView) return pathname === path && view === itemView;
    if (path === "/orders") return pathname === path && !view;

    return true;
}

export function AppSidebar(props: React.ComponentProps<typeof Sidebar>) {
    return (
        <Suspense fallback={<Sidebar variant="inset" {...props} />}>
            <AppSidebarContent {...props} />
        </Suspense>
    );
}

function AppSidebarContent({ ...props }: React.ComponentProps<typeof Sidebar>) {
    const pathname = usePathname();
    const searchParams = useSearchParams();
    const view = searchParams.get("view");
    const resetDemoData = () => {
        window.localStorage.removeItem("jumunpangpang.syncedInvoices");
        window.localStorage.removeItem("jumunpangpang.sourcingMatches");
        window.localStorage.removeItem("jumunpangpang.sourcingPayments");
        window.location.reload();
    };

    return (
        <Sidebar variant="inset" {...props}>
            <SidebarHeader>
                <SidebarMenu>
                    <SidebarMenuItem>
                        <SidebarMenuButton size="lg" asChild>
                            <Link href="/">
                                <div className="flex aspect-square size-8 items-center justify-center rounded-lg bg-primary text-primary-foreground">
                                    <Home className="size-4" />
                                </div>
                                <div className="grid flex-1 text-left text-sm leading-tight">
                                    <span className="truncate font-semibold">주문수집소싱라이프</span>
                                    <span className="truncate text-xs">주문수집 · 구매대행 보조</span>
                                </div>
                            </Link>
                        </SidebarMenuButton>
                    </SidebarMenuItem>
                </SidebarMenu>
            </SidebarHeader>
            <SidebarContent>
                <SidebarGroup>
                    <SidebarGroupContent>
                        <SidebarMenu>
                            {navItems.map((item) =>
                                item.items ? (
                                    <Collapsible key={item.title} asChild defaultOpen className="group/collapsible">
                                        <SidebarMenuItem>
                                            <CollapsibleTrigger asChild>
                                                <SidebarMenuButton
                                                    tooltip={item.title}
                                                    isActive={item.items.some((subItem) => isSubItemActive(subItem.url, pathname, view))}
                                                    className="data-[active=true]:rounded-l-none data-[active=true]:border-l-4 data-[active=true]:border-primary data-[active=true]:bg-sidebar-accent data-[active=true]:font-bold data-[active=true]:shadow-sm"
                                                >
                                                    <item.icon />
                                                    <span>{item.title}</span>
                                                    <ChevronRight className="ml-auto transition-transform duration-200 group-data-[state=open]/collapsible:rotate-90" />
                                                </SidebarMenuButton>
                                            </CollapsibleTrigger>
                                            <CollapsibleContent>
                                                <SidebarMenuSub>
                                                    {item.items.map((subItem) => {
                                                        const countKey = subItem.url?.includes("view=")
                                                            ? subItem.url.split("view=")[1] as keyof typeof orderCounts
                                                            : subItem.title === "전체" ? "all" : undefined;
                                                        const count = countKey ? orderCounts[countKey] : undefined;
                                                        const isPriority = countKey ? ["all", "new", "preparing", "waiting", "claims"].includes(countKey) : false;

                                                        return (
                                                        <SidebarMenuSubItem key={subItem.title}>
                                                            <SidebarMenuSubButton
                                                                asChild
                                                                isActive={isSubItemActive(subItem.url, pathname, view)}
                                                                className="data-[active=true]:font-semibold data-[active=true]:text-primary"
                                                            >
                                                                <Link href={subItem.url!}>
                                                                    <span>{subItem.title}</span>
                                                                    {typeof count === "number" && (
                                                                        <span className={`ml-auto rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${isPriority ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"}`}>
                                                                            {count}
                                                                        </span>
                                                                    )}
                                                                </Link>
                                                            </SidebarMenuSubButton>
                                                        </SidebarMenuSubItem>
                                                        );
                                                    })}
                                                </SidebarMenuSub>
                                            </CollapsibleContent>
                                        </SidebarMenuItem>
                                    </Collapsible>
                                ) : (
                                    <SidebarMenuItem key={item.title}>
                                        <SidebarMenuButton
                                            asChild
                                            tooltip={item.title}
                                            isActive={isNavItemActive(item.url, pathname, view)}
                                            className="data-[active=true]:rounded-l-none data-[active=true]:border-l-4 data-[active=true]:border-primary data-[active=true]:bg-sidebar-accent data-[active=true]:font-bold data-[active=true]:shadow-sm"
                                        >
                                            <Link href={item.url}>
                                                <item.icon />
                                                <span>{item.title}</span>
                                            </Link>
                                        </SidebarMenuButton>
                                    </SidebarMenuItem>
                                ),
                            )}
                        </SidebarMenu>
                    </SidebarGroupContent>
                </SidebarGroup>
            </SidebarContent>
            <SidebarFooter>
                <SidebarMenu>
                    <SidebarMenuItem>
                        <SidebarMenuButton onClick={resetDemoData} tooltip="데이터 초기화">
                            <DatabaseBackup />
                            <span>데이터 초기화</span>
                        </SidebarMenuButton>
                    </SidebarMenuItem>
                    <SidebarMenuItem>
                        <SidebarMenuButton size="lg" asChild>
                            <Link href="/me/profile">
                                <div className="flex aspect-square size-8 items-center justify-center rounded-lg border">
                                    <User className="size-4" />
                                </div>
                                <div className="grid flex-1 text-left text-sm leading-tight">
                                    <span className="truncate font-semibold">Moon CEO</span>
                                    <span className="truncate text-xs">moon@jumunpangpang.com</span>
                                </div>
                            </Link>
                        </SidebarMenuButton>
                    </SidebarMenuItem>
                </SidebarMenu>
            </SidebarFooter>
        </Sidebar>
    );
}
