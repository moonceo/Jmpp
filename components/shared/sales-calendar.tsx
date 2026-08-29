import { useDailySales } from "@/hooks/use-dashboard-data";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useDashboardStore } from "@/lib/stores/dashboard-store";
import {
    startOfMonth,
    endOfMonth,
    eachDayOfInterval,
    format,
    isSameMonth,
    startOfWeek,
    endOfWeek
} from "date-fns";
import { cn } from "@/lib/utils";

export function SalesCalendar() {
    const { selectedMonth } = useDashboardStore();
    const { data: dailySales, isLoading } = useDailySales();

    // Calendar logic
    const monthStart = startOfMonth(selectedMonth);
    const monthEnd = endOfMonth(monthStart);
    const startDate = startOfWeek(monthStart);
    const endDate = endOfWeek(monthEnd);

    const calendarDays = eachDayOfInterval({
        start: startDate,
        end: endDate,
    });

    const weekDays = ['일', '월', '화', '수', '목', '금', '토'];

    // Helper to find sales data for a specific date
    const getSalesForDate = (date: Date) => {
        if (!dailySales) return 0;
        const dateStr = format(date, 'yyyy-MM-dd');
        const dayData = dailySales.find(d => d.date === dateStr);
        return dayData ? dayData.sales : 0;
    };

    // Helper to determine heat map color
    const getHeatmapColor = (sales: number) => {
        if (sales === 0) return "";
        if (sales < 500000) return "bg-muted text-foreground dark:bg-primary/30 dark:text-foreground";
        if (sales < 1000000) return "bg-muted text-foreground dark:bg-primary/40 dark:text-foreground";
        if (sales < 2000000) return "bg-muted text-foreground dark:bg-primary/50 dark:text-foreground";
        return "bg-muted text-foreground dark:bg-primary/60 dark:text-primary-foreground font-semibold";
    };

    if (isLoading) {
        return <CalendarSkeleton />;
    }

    return (
        <Card>
            <CardHeader>
                <CardTitle>일별 매출 현황</CardTitle>
            </CardHeader>
            <CardContent>
                {/* Weekday Headers */}
                <div className="grid grid-cols-7 mb-2">
                    {weekDays.map((day) => (
                        <div key={day} className="text-center text-xs font-semibold text-muted-foreground py-1">
                            {day}
                        </div>
                    ))}
                </div>

                {/* Days Grid */}
                <div className="grid grid-cols-7 gap-1 auto-rows-fr">
                    {calendarDays.map((day) => {
                        const isCurrentMonth = isSameMonth(day, monthStart);
                        const sales = isCurrentMonth ? getSalesForDate(day) : 0;
                        const hasSales = sales > 0;

                        return (
                            <div
                                key={day.toString()}
                                className={cn(
                                    "min-h-[80px] p-2 rounded-md border flex flex-col justify-between transition-colors",
                                    !isCurrentMonth && "bg-muted/20 text-muted-foreground/30 border-transparent",
                                    isCurrentMonth && "bg-card",
                                    getHeatmapColor(sales)
                                )}
                            >
                                <div className={cn(
                                    "text-xs text-right",
                                    !isCurrentMonth && "opacity-30"
                                )}>
                                    {format(day, 'd')}
                                </div>
                                {isCurrentMonth && hasSales && (
                                    <div className="text-xs sm:text-xs font-medium text-center truncate">
                                        {new Intl.NumberFormat('ko-KR', { notation: "compact", maximumFractionDigits: 1 }).format(sales)}
                                    </div>
                                )}
                            </div>
                        );
                    })}
                </div>
            </CardContent>
        </Card>
    );
}

function CalendarSkeleton() {
    return (
        <Card>
            <CardHeader>
                <Skeleton className="h-6 w-32" />
            </CardHeader>
            <CardContent>
                <div className="grid grid-cols-7 gap-1 mb-2">
                    {Array.from({ length: 7 }).map((_, i) => (
                        <Skeleton key={i} className="h-4 w-full" />
                    ))}
                </div>
                <div className="grid grid-cols-7 gap-1">
                    {Array.from({ length: 35 }).map((_, i) => (
                        <Skeleton key={i} className="h-[80px] w-full rounded-md" />
                    ))}
                </div>
            </CardContent>
        </Card>
    );
}
