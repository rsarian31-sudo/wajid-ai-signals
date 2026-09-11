import { useCallback, useMemo, useState } from "react";
import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from "react-native";
import { useFocusEffect } from "expo-router";
import { AppHeader } from "@/components/AppHeader";
import { MetricCard } from "@/components/MetricCard";
import { HistoryRecordCard } from "@/components/HistoryRecordCard";
import { EmptyState } from "@/components/EmptyState";
import { LoadingState } from "@/components/LoadingState";
import { ErrorState } from "@/components/ErrorState";
import { colors, spacing } from "@/constants/theme";
import { useCanonicalHistory } from "@/hooks/useCanonicalHistory";
import type { StrategyId, SignalStatus } from "@/types/canonical";

type Filter = "ALL" | StrategyId | "WIN" | "LOSS" | "AMBIGUOUS" | "PENDING" | "ACTIVE";
const filters: Array<{ label: string; value: Filter }> = [{ label: "All", value: "ALL" }, { label: "Strong SD Magnet", value: "strong_sd_magnet" }, { label: "Swing Liquidity", value: "swing_liquidity" }, { label: "Swing Forecast", value: "swing_forecast" }, { label: "WIN", value: "WIN" }, { label: "LOSS", value: "LOSS" }, { label: "AMBIGUOUS", value: "AMBIGUOUS" }, { label: "PENDING", value: "PENDING" }, { label: "ACTIVE", value: "ACTIVE" }];

export default function HistoryScreen() {
  const [filter, setFilter] = useState<Filter>("ALL");
  const backendResult = filter === "WIN" || filter === "LOSS" || filter === "AMBIGUOUS" ? filter : undefined;
  const backendStrategy = filter === "strong_sd_magnet" || filter === "swing_liquidity" || filter === "swing_forecast" ? filter : undefined;
  const query = useCanonicalHistory({ result: backendResult, strategy: backendStrategy });
  useFocusEffect(useCallback(() => { void query.refetch(); }, [query.refetch]));
  const summary = query.data?.summary;
  const records = useMemo(() => { const source = query.data?.records ?? []; if (filter === "PENDING" || filter === "ACTIVE") return source.filter((record) => record.status === filter as SignalStatus); return source; }, [filter, query.data?.records]);
  return <ScrollView contentContainerStyle={styles.content} refreshControl={<RefreshControl tintColor={colors.accent} refreshing={query.isFetching} onRefresh={() => void query.refetch()} />}>
    <AppHeader eyebrow="AUDIT TRAIL" title="History" subtitle="Persisted canonical records" />
    {query.isLoading && <LoadingState label="Loading history…" />}
    {query.isError && <ErrorState message={query.error instanceof Error ? query.error.message : "Unable to load history."} onRetry={() => void query.refetch()} />}
    {!query.isLoading && !query.isError && <><View style={styles.grid}><MetricCard label="Total Signals" value={String(summary?.totalSignals ?? 0)} /><MetricCard label="Wins" value={String(summary?.wins ?? 0)} tone="positive" /><MetricCard label="Losses" value={String(summary?.losses ?? 0)} tone="negative" /><MetricCard label="Win Rate" value={`${(summary?.winRate ?? 0).toFixed(2)}%`} /></View><ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filters}>{filters.map(({ label, value }) => <Pressable key={value} onPress={() => setFilter(value)} style={[styles.filter, filter === value && styles.filterActive]}><Text style={[styles.filterText, filter === value && styles.filterTextActive]}>{label}</Text></Pressable>)}</ScrollView><View style={styles.records}>{records.length ? records.map((record) => <HistoryRecordCard key={record.id} record={record} />) : <EmptyState title="No matching records" message="The canonical server returned no records for this filter." />}</View></>}
  </ScrollView>;
}
const styles = StyleSheet.create({ content: { padding: spacing.lg, paddingBottom: 40 }, grid: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm }, filters: { gap: spacing.sm, paddingVertical: spacing.lg }, filter: { paddingVertical: 8, paddingHorizontal: 12, borderRadius: 999, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface }, filterActive: { borderColor: colors.accent, backgroundColor: colors.surfaceRaised }, filterText: { color: colors.muted, fontSize: 10, fontWeight: "800" }, filterTextActive: { color: colors.text }, records: { marginTop: spacing.sm } });
