import { usePendingTasks } from "@/hooks/use-dashboard-data";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import Link from "next/link";
import { ArrowRight, Package, Truck, AlertCircle, RefreshCw } from "lucide-react";

export function PendingTasks() {
    const { data: tasks, isLoading } = usePendingTasks();

    const getIcon = (id: string) => {
        switch (id) {
            case 'new-orders': return <Package className="h-5 w-5 text-foreground" />;
            case 'waiting': return <Truck className="h-5 w-5 text-foreground" />;
            case 'preparing': return <AlertCircle className="h-5 w-5 text-foreground" />;
            case 'claims': return <RefreshCw className="h-5 w-5 text-foreground" />;
            default: return <Package className="h-5 w-5" />;
        }
    };

    if (isLoading) {
        return <TasksSkeleton />;
    }

    return (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {tasks?.map((task) => (
                <Card key={task.id} className="relative overflow-hidden hover:shadow-md transition-shadow">
                    <CardContent className="p-6">
                        <div className="flex items-center justify-between mb-4">
                            <div className="p-2 bg-muted rounded-full">
                                {getIcon(task.id)}
                            </div>
                            <div className="text-2xl font-bold text-foreground">
                                {task.count}
                                <span className="text-sm font-normal text-muted-foreground ml-1">건</span>
                            </div>
                        </div>

                        <div className="flex items-center justify-between">
                            <h3 className="font-medium text-sm">{task.name}</h3>
                            <Button asChild variant="ghost" size="sm">
                                <Link href={task.url}>
                                    처리하기 <ArrowRight className="size-4" />
                                </Link>
                            </Button>
                        </div>
                    </CardContent>
                </Card>
            ))}
        </div>
    );
}

function TasksSkeleton() {
    return (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {Array.from({ length: 4 }).map((_, i) => (
                <Card key={i}>
                    <CardContent className="p-6">
                        <div className="flex items-center justify-between mb-4">
                            <Skeleton className="h-10 w-10 rounded-full" />
                            <Skeleton className="h-8 w-16" />
                        </div>
                        <div className="flex items-center justify-between">
                            <Skeleton className="h-4 w-20" />
                            <Skeleton className="h-4 w-16" />
                        </div>
                    </CardContent>
                </Card>
            ))}
        </div>
    );
}
