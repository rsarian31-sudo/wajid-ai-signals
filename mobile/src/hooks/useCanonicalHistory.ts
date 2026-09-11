import { useQuery } from "@tanstack/react-query";
import { useIsFocused } from "expo-router";
import { fetchHistory, type HistoryFilters } from "@/services/api/canonical";
export function useCanonicalHistory(filters: HistoryFilters = {}, enabled = true) { const focused = useIsFocused(); const query = useQuery({ queryKey: ["canonical-history", filters], queryFn: () => fetchHistory(filters), enabled, staleTime: 10_000, refetchInterval: focused ? 30_000 : false, refetchOnMount: "always", refetchOnReconnect: true, retry: 1 }); return { ...query, refresh: query.refetch }; }
