import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api, ApiResponse } from "@/lib/api";

// ────────────────────────────────────────────────
// Query Keys
// ────────────────────────────────────────────────
export const queryKeys = {
  dredgers: ["dredgers"] as const,
  transporters: ["transporters"] as const,
  trips: ["trips"] as const,
  payments: ["payments"] as const,
};

// ────────────────────────────────────────────────
// Read Hooks
// ────────────────────────────────────────────────

export function useDredgers() {
  return useQuery({
    queryKey: queryKeys.dredgers,
    queryFn: async () => {
      const res = await api.getDredgers();
      if (!res.success) throw new Error(res.error || "Failed to load dredgers");
      return res.data || [];
    },
    staleTime: 1000 * 60 * 5, // 5 minutes
  });
}

export function useTransporters() {
  return useQuery({
    queryKey: queryKeys.transporters,
    queryFn: async () => {
      const res = await api.getTransporters();
      if (!res.success) throw new Error(res.error || "Failed to load transporters");
      return res.data || [];
    },
    staleTime: 1000 * 60 * 5,
  });
}

export function useTrips() {
  return useQuery({
    queryKey: queryKeys.trips,
    queryFn: async () => {
      const res = await api.getTrips();
      if (!res.success) throw new Error(res.error || "Failed to load trips");
      return res.data || [];
    },
    staleTime: 1000 * 60 * 1, // shorter for trips since more dynamic
  });
}

export function usePayments() {
  return useQuery({
    queryKey: queryKeys.payments,
    queryFn: async () => {
      const res = await api.getPayments();
      if (!res.success) throw new Error(res.error || "Failed to load payments");
      return res.data || [];
    },
    staleTime: 1000 * 60 * 1,
  });
}

// ────────────────────────────────────────────────
// Mutation Hook (create/update/delete)
// ────────────────────────────────────────────────

export function useSaveEntity() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ action, data }: { action: string; data: any }) => {
      // For now we use the generic request – later we can use specific methods
      const res = await api.request(action as any, data);
      if (!res.success) throw new Error(res.error || "Operation failed");
      return res;
    },
    onSuccess: (_, variables) => {
      // Invalidate relevant queries to trigger refetch
      if (variables.action.includes("Dredger")) {
        queryClient.invalidateQueries({ queryKey: queryKeys.dredgers });
      }
      if (variables.action.includes("Transporter") || variables.action === "deleteTruck") {
        queryClient.invalidateQueries({ queryKey: queryKeys.transporters });
      }
      if (variables.action.includes("Trip")) {
        queryClient.invalidateQueries({ queryKey: queryKeys.trips });
      }
      if (variables.action.includes("Payment")) {
        queryClient.invalidateQueries({ queryKey: queryKeys.payments });
      }
    },
    onError: (error) => {
      console.error("Save/Delete failed:", error);
      // Later: show toast notification
    },
  });
}