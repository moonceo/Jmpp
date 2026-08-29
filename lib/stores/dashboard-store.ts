import { create } from 'zustand';
import { startOfMonth, subMonths, addMonths } from 'date-fns';

interface DashboardState {
    // Filter states
    marginConfirmedOnly: boolean;
    excludeCancelReturn: boolean;
    includeDirectInputCosts: boolean;
    selectedMonth: Date;

    // Actions
    toggleMarginConfirmed: () => void;
    toggleExcludeCancelReturn: () => void;
    toggleDirectInputCosts: () => void;
    prevMonth: () => void;
    nextMonth: () => void;
    setMonth: (date: Date) => void;
}

export const useDashboardStore = create<DashboardState>((set) => ({
    marginConfirmedOnly: false,
    excludeCancelReturn: true, // Default ON based on spec
    includeDirectInputCosts: true,
    selectedMonth: startOfMonth(new Date()),

    toggleMarginConfirmed: () =>
        set((state) => ({ marginConfirmedOnly: !state.marginConfirmedOnly })),

    toggleExcludeCancelReturn: () =>
        set((state) => ({ excludeCancelReturn: !state.excludeCancelReturn })),

    toggleDirectInputCosts: () =>
        set((state) => ({ includeDirectInputCosts: !state.includeDirectInputCosts })),

    prevMonth: () =>
        set((state) => ({ selectedMonth: subMonths(state.selectedMonth, 1) })),

    nextMonth: () =>
        set((state) => ({ selectedMonth: addMonths(state.selectedMonth, 1) })),

    setMonth: (date: Date) =>
        set(() => ({ selectedMonth: startOfMonth(date) })),
}));
