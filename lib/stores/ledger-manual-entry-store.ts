"use client";

import { useEffect } from "react";
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import {
    isLedgerManualField,
    type LedgerManualEntry,
    type LedgerManualField,
    type LedgerManualValue,
} from "@/lib/ledger-manual-entry";

interface LedgerManualEntryState {
    entries: LedgerManualEntry[];
    saveEntry: (entry: { orderId: string; field: LedgerManualField; value: LedgerManualValue }) => void;
    removeEntry: (orderId: string, field: LedgerManualField) => void;
}

function validPersistedEntries(value: unknown): LedgerManualEntry[] {
    if (!Array.isArray(value)) return [];

    return value.filter((entry): entry is LedgerManualEntry => {
        if (!entry || typeof entry !== "object") return false;
        const candidate = entry as Partial<LedgerManualEntry>;
        return typeof candidate.id === "string"
            && typeof candidate.orderId === "string"
            && isLedgerManualField(candidate.field)
            && typeof candidate.value === "number"
            && typeof candidate.updatedAt === "string";
    });
}

export const useLedgerManualEntryStore = create<LedgerManualEntryState>()(
    persist(
        (set) => ({
            entries: [],
            saveEntry: ({ orderId, field, value }) => set((state) => {
                const nextEntry: LedgerManualEntry = {
                    id: `${orderId}:${field}`,
                    orderId,
                    field,
                    value,
                    updatedAt: new Date().toISOString(),
                };

                return {
                    entries: [
                        ...state.entries.filter((entry) => entry.id !== nextEntry.id),
                        nextEntry,
                    ],
                };
            }),
            removeEntry: (orderId, field) => set((state) => ({
                entries: state.entries.filter((entry) => entry.orderId !== orderId || entry.field !== field),
            })),
        }),
        {
            name: "commerce-life-ledger-manual-entries",
            storage: createJSONStorage(() => localStorage),
            skipHydration: true,
            version: 2,
            migrate: (persistedState) => {
                const state = persistedState as { entries?: unknown } | undefined;
                return { entries: validPersistedEntries(state?.entries) } as LedgerManualEntryState;
            },
        },
    ),
);

export function useLedgerManualEntryHydration(): void {
    useEffect(() => {
        void useLedgerManualEntryStore.persist.rehydrate();
    }, []);
}
