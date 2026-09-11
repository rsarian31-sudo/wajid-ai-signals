import { useCallback } from "react";
import { RefreshControl, ScrollView, StyleSheet, View } from "react-native";
import { useFocusEffect } from "expo-router";
import { AppHeader } from "@/components/AppHeader";
import { MetricCard } from "@/components/MetricCard";
import { LoadingState } from "@/components/LoadingState";
import { ErrorState } from "@/components/ErrorState";
import { SectionTitle } from "@/components/SectionTitle";
import { PerformanceBreakdownCard } from "@/components/PerformanceBreakdownCard";
import { useCanonicalPerformance } from "@/hooks/useCanonicalPerformance";
import { STRATEGIES } from "@/constants/strategies";
import { colors, spacing } from "@/constants/theme";

export default function PerformanceScreen() {
  const query = useCanonicalPerformance();
  useFocusEffect(useCallback(() => { void query.refetch(); }, [query.refetch]));
  const summary = query.data?.summary;
  return <ScrollView contentContainerStyle={styles.content} refreshControl={<RefreshControl tintColor={colors.accent} refreshing={query.isFetching} onRefresh={() => void query.refetch()} />}>
    <AppHeader eyebrow="STATISTICS" title="Performance" subtitle="Server-calculated canonical statistics" />
    {query.isLoading && <LoadingState label="Loading performance…" />}
    {query.isError && <ErrorState message={query.error instanceof Error ? query.error.message : "Unable to load performance."} onRetry={() => void query.refetch()} />}
    {!query.isLoading && !query.isError && summary && <>
      <View style={styles.grid}><MetricCard label="Total Signals" value={String(summary.totalSignals)} /><MetricCard label="Wins" value={String(summary.wins)} tone="positive" /><MetricCard label="Losses" value={String(summary.losses)} tone="negative" /><MetricCard label="Win Rate" value={`${summary.winRate.toFixed(2)}%`} /></View>
      <SectionTitle title="Strategy Performance" />
      <View style={styles.list}>{STRATEGIES.map((strategy) => <PerformanceBreakdownCard key={strategy.id} title={strategy.name} data={query.data.strategyPerformance[strategy.id]} />)}</View>
      <SectionTitle title="BUY vs SELL" />
      <View style={styles.list}><PerformanceBreakdownCard title="BUY" data={query.data.directionPerformance.BUY} /><PerformanceBreakdownCard title="SELL" data={query.data.directionPerformance.SELL} /></View>
    </>}
  </ScrollView>;
}
const styles = StyleSheet.create({ content: { padding: spacing.lg, paddingBottom: 40 }, grid: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm }, list: { gap: spacing.sm, marginBottom: spacing.lg }, });
