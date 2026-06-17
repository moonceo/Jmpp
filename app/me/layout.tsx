"use client";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import Link from "next/link";
import { usePathname } from "next/navigation";

export default function MyInfoLayout({
    children,
}: {
    children: React.ReactNode;
}) {
    const pathname = usePathname();

    const items = [
        { title: "마켓 설정", href: "/me/markets" },
        { title: "계정 설정", href: "/me/profile" },
    ];

    return (
        <div className="flex h-full flex-col">
            <div className="flex items-center gap-6 border-b bg-background px-6 py-4">
                <h2 className="shrink-0 text-2xl font-bold tracking-tight">내정보</h2>
                <div className="no-scrollbar flex space-x-2 overflow-x-auto pb-0">
                    {items.map((item) => (
                        <Button
                            key={item.href}
                            variant={pathname === item.href ? "secondary" : "ghost"}
                            className={cn(
                                "h-9 rounded-full px-4 text-sm font-medium transition-colors",
                                pathname === item.href
                                    ? "bg-primary/10 text-primary hover:bg-primary/20"
                                    : "text-muted-foreground hover:text-foreground",
                            )}
                            asChild
                        >
                            <Link href={item.href}>{item.title}</Link>
                        </Button>
                    ))}
                </div>
            </div>

            <div className="mx-auto w-full max-w-7xl flex-1 overflow-y-auto p-6 lg:p-10">{children}</div>
        </div>
    );
}
