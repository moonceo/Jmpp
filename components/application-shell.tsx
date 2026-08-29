"use client";

import { usePathname } from "next/navigation";
import { AppSidebar } from "@/components/app-sidebar";
import { DynamicBreadcrumb } from "@/components/shared/dynamic-breadcrumb";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { SidebarInset, SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";

export function ApplicationShell({ children }: { children: React.ReactNode }) {
    const pathname = usePathname();

    if (pathname === "/login") {
        return <main className="min-h-svh bg-muted">{children}</main>;
    }

    return (
        <SidebarProvider>
            <AppSidebar />
            <SidebarInset className="min-w-0 bg-muted/30">
                <header className="sticky top-0 z-40 flex h-14 shrink-0 items-center gap-3 border-b border-border bg-background/95 px-4 backdrop-blur supports-[backdrop-filter]:bg-background/85 md:h-16 md:px-6">
                    <SidebarTrigger className="-ml-1" />
                    <Separator orientation="vertical" className="h-4" />
                    <DynamicBreadcrumb />
                    <div className="ml-auto flex items-center gap-2" aria-label="서비스 상태">
                        <Badge variant="outline" className="hidden rounded-sm px-2 py-1 text-xs font-semibold sm:inline-flex">
                            독립 주문관리
                        </Badge>
                        <Badge className="size-2 rounded-full p-0" aria-label="서비스 정상" />
                    </div>
                </header>
                <main className="flex min-h-0 min-w-0 flex-1 flex-col bg-muted/30">{children}</main>
            </SidebarInset>
        </SidebarProvider>
    );
}
