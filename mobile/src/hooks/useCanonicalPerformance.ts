import { useQuery } from "@tanstack/react-query";
import { useIsFocused } from "expo-router";
import { fetchPerformance, type HistoryFilters } from "@/services/api/canonical";
export function useCanonicalPerformance(filters: HistoryFilters = {}) { const focused = useIsFocused(); const query = useQuery({ queryKey: ["canonical-performance", filters], queryFn: () => fetchPerformance(filters), staleTime: 10_000, refetchInterval: focused ? 30_000 : false, refetchOnMount: "always", refetchOnReconnect: true, retry: 1 }); return { ...query, refresh: query.refetch }; }
