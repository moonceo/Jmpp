import { OrdersPageClient, OrdersView } from "@/components/orders/orders-page-client";

interface OrdersPageProps {
    searchParams?: Promise<{
        view?: string;
    }>;
}

export default async function OrdersPage({ searchParams }: OrdersPageProps) {
    const params = await searchParams;
    const view = params?.view;
    const activeView = view && ["new", "preparing", "waiting", "shipping", "delivered", "claims"].includes(view)
        ? (view as OrdersView)
        : "all";

    return <OrdersPageClient activeView={activeView} />;
}
