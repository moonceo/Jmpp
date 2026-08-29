import { useQuery } from '@tanstack/react-query';
import { useDashboardStore } from '@/lib/stores/dashboard-store';
import {
    mockMetrics,
    mockDailySales,
    mockAnnouncements,
    mockPendingTasks,
    mockNotifications
} from '@/lib/mock-data/dashboard';

// Simulation delay to mimic network request
const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

export function useDashboardMetrics() {
    const { selectedMonth, marginConfirmedOnly, excludeCancelReturn, includeDirectInputCosts } = useDashboardStore();

    // Create a query key that includes filter dependencies so it refetches when they change
    const queryKey = ['dashboard-metrics', selectedMonth.toISOString(), marginConfirmedOnly, excludeCancelReturn, includeDirectInputCosts];

    return useQuery({
        queryKey,
        queryFn: async () => {
            await delay(500); // Simulate network latency
            // In a real app, we would pass params to the API
            return mockMetrics;
        },
        staleTime: 1000 * 60 * 5, // 5 minutes
    });
}

export function useDailySales() {
    const { selectedMonth } = useDashboardStore();

    return useQuery({
        queryKey: ['daily-sales', selectedMonth.toISOString()],
        queryFn: async () => {
            await delay(600);
            return mockDailySales;
        },
        staleTime: 1000 * 60 * 10, // 10 minutes
    });
}

export function useAnnouncements() {
    return useQuery({
        queryKey: ['announcements'],
        queryFn: async () => {
            await delay(300);
            return mockAnnouncements;
        },
        staleTime: 1000 * 60 * 30, // 30 minutes
    });
}

export function usePendingTasks() {
    return useQuery({
        queryKey: ['pending-tasks'],
        queryFn: async () => {
            // Intentionally shorter delay as this needs to be snappy
            await delay(200);
            return mockPendingTasks;
        },
        refetchInterval: 1000 * 30, // Poll every 30 seconds for real-time updates
    });
}

export function useNotifications() {
    return useQuery({
        queryKey: ['notifications'],
        queryFn: async () => {
            await delay(200);
            return mockNotifications;
        },
        refetchInterval: 1000 * 60, // Poll every 1 minute
    });
}
