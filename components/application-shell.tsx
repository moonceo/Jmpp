"use client";

import { usePathname } from "next/navigation";
import { AppSidebar } from "@/components/app-sidebar";
import { SidebarInset, SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";

export function ApplicationShell({ children }: { children: React.ReactNode }) {
    const pathname = usePathname();

    if (pathname === "/login") {
        return <main className="min-h-svh bg-[#f4f5f2]">{children}</main>;
    }

    return (
        <SidebarProvider>
            <AppSidebar />
            <SidebarInset className="relative bg-white">
                <SidebarTrigger className="fixed left-3 top-3 z-50 rounded-full border border-slate-200 bg-white shadow-sm md:absolute md:left-0 md:top-10 md:-translate-x-1/2" />
                <main className="flex min-h-svh flex-1 flex-col bg-white pt-12 md:pt-0">{children}</main>
            </SidebarInset>
        </SidebarProvider>
    );
}
