import { OrdersPageClient, OrdersView } from "@/components/orders/orders-page-client";
import { ClaimsPageClient } from "@/components/claims/claims-page-client";

interface OrdersPageProps {
    searchParams?: Promise<{
        view?: string;
    }>;
}

const ORDER_VIEWS: readonly OrdersView[] = ["all", "new", "preparing", "waiting", "shipping", "delivered", "claims"];

export function resolveOrdersView(view?: string): OrdersView {
    return view && ORDER_VIEWS.includes(view as OrdersView)
        ? view as OrdersView
        : "new";
}

export default async function OrdersPage({ searchParams }: OrdersPageProps) {
    const params = await searchParams;
    const activeView = resolveOrdersView(params?.view);

    if (activeView === "claims") return <ClaimsPageClient />;

    return <OrdersPageClient activeView={activeView} />;
}
