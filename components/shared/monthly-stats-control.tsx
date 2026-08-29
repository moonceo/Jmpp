import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { useDashboardStore } from "@/lib/stores/dashboard-store";
import { format } from "date-fns";
import { ko } from "date-fns/locale";

export function MonthlyStatsControl() {
    const {
        marginConfirmedOnly,
        toggleMarginConfirmed,
        excludeCancelReturn,
        toggleExcludeCancelReturn,
        includeDirectInputCosts,
        toggleDirectInputCosts,
        selectedMonth,
        prevMonth,
        nextMonth
    } = useDashboardStore();

    return (
        <div className="flex flex-col lg:flex-row items-start lg:items-center justify-between gap-4 py-4 px-1">
            {/* Month Navigator */}
            <div className="flex items-center gap-4 bg-muted/30 p-2 rounded-lg order-2 lg:order-1 w-full lg:w-auto justify-center">
                <Button variant="ghost" size="icon" onClick={prevMonth} className="h-8 w-8">
                    <ChevronLeft className="h-4 w-4" />
                </Button>
                <div className="font-semibold text-lg w-32 text-center select-none">
                    {format(selectedMonth, 'yyyy년 MM월', { locale: ko })}
                </div>
                <Button variant="ghost" size="icon" onClick={nextMonth} className="h-8 w-8">
                    <ChevronRight className="h-4 w-4" />
                </Button>
            </div>

            {/* Toggles */}
            <div className="order-1 flex flex-wrap items-center gap-4 lg:order-2 lg:justify-end">
                <div className="flex items-center space-x-2">
                    <Switch
                        id="margin-only"
                        checked={marginConfirmedOnly}
                        onCheckedChange={toggleMarginConfirmed}
                    />
                    <Label htmlFor="margin-only" className="cursor-pointer font-normal text-sm">
                        마진 확정만 (정산완료)
                    </Label>
                </div>

                <div className="flex items-center space-x-2">
                    <Switch
                        id="exclude-cancel"
                        checked={excludeCancelReturn}
                        onCheckedChange={toggleExcludeCancelReturn}
                    />
                    <Label htmlFor="exclude-cancel" className="cursor-pointer font-normal text-sm">
                        취소/반품 제거 (순매출)
                    </Label>
                </div>
                <div className="flex items-center space-x-2">
                    <Switch
                        id="direct-input-costs"
                        checked={includeDirectInputCosts}
                        onCheckedChange={toggleDirectInputCosts}
                    />
                    <Label htmlFor="direct-input-costs" className="cursor-pointer text-sm font-normal">
                        직접 입력 비용 반영
                    </Label>
                </div>
            </div>
        </div>
    );
}
