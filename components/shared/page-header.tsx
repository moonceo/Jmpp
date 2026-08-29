import type { ReactNode } from "react";

interface PageHeaderProps {
    title: string;
    description: string;
    eyebrow?: string;
    actions?: ReactNode;
}

export function PageHeader({
    title,
    description,
    eyebrow = "ORDER OPERATIONS",
    actions,
}: PageHeaderProps) {
    return (
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
            <div className="min-w-0 flex-1">
                <p className="text-xs font-bold uppercase tracking-[0.18em] text-muted-foreground">
                    {eyebrow}
                </p>
                <h1 className="mt-2 text-2xl font-black tracking-[-0.035em] text-foreground sm:text-3xl">
                    {title}
                </h1>
                <p className="mt-2 text-sm leading-6 text-muted-foreground">
                    {description}
                </p>
            </div>
            {actions ? <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div> : null}
        </div>
    );
}
