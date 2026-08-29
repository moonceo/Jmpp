"use client";

import { usePathname } from "next/navigation";
import {
    Breadcrumb,
    BreadcrumbItem,
    BreadcrumbLink,
    BreadcrumbList,
    BreadcrumbPage,
    BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";

const routeNameMap: Record<string, string> = {
    "/": "대시보드",
    "/dashboard": "대시보드",
    "/journey": "주문현황",
    "/orders": "주문수집",
    "/inquiries": "문의관리",
    "/ledger": "장부다운로드",
    "/me/markets": "마켓연동",
    "/me/notifications": "알림 설정",
    "/me/ledger": "장부다운로드",
};

export function DynamicBreadcrumb() {
    const pathname = usePathname();
    const currentName = routeNameMap[pathname] || "대시보드";

    return (
        <Breadcrumb>
            <BreadcrumbList>
                <BreadcrumbItem className="hidden md:block">
                    <BreadcrumbLink href="/">커머스라이프</BreadcrumbLink>
                </BreadcrumbItem>
                <BreadcrumbSeparator className="hidden md:block" />
                <BreadcrumbItem>
                    <BreadcrumbPage>{currentName}</BreadcrumbPage>
                </BreadcrumbItem>
            </BreadcrumbList>
        </Breadcrumb>
    );
}
