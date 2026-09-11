import { useCallback } from "react";
import { RefreshControl, ScrollView, StyleSheet, View, Text } from "react-native";
import { useFocusEffect } from "expo-router";
import { AppHeader } from "@/components/AppHeader";
import { MetricCard } from "@/components/MetricCard";
import { SectionTitle } from "@/components/SectionTitle";
import { StatusPill } from "@/components/StatusPill";
import { SignalCard } from "@/components/SignalCard";
import { EmptyState } from "@/components/EmptyState";
import { LoadingState } from "@/components/LoadingState";
import { ErrorState } from "@/components/ErrorState";
import { useCanonicalPerformance } from "@/hooks/useCanonicalPerformance";
import { useStrategySignal } from "@/hooks/useStrategySignal";
import { colors, spacing } from "@/constants/theme";

export default function HomeScreen() {
  const live = useStrategySignal("strong_sd_magnet");
  const performance = useCanonicalPerformance();
  const refresh = useCallback(() => Promise.all([live.refresh(), performance.refetch()]), [live.refresh, performance.refetch]);
  useFocusEffect(useCallback(() => { void refresh(); }, [refresh]));
  const loading = live.state.kind === "loading" || performance.isLoading;
  const error = live.state.kind === "error" || performance.isError;
  const signal = live.state.kind === "ready" ? live.state.data : null;
  const response = live.state.kind === "ready" || live.state.kind === "empty" ? live.state.response : undefined;
  const symbol = response?.symbol ?? signal?.symbol ?? "—";
  const timeframe = response?.interval ?? signal?.timeframe ?? "—";
  const lastUpdate = signal?.updatedAt ?? signal?.signalTime;
  return <ScrollView contentContainerStyle={styles.content} refreshControl={<RefreshControl tintColor={colors.accent} refreshing={live.state.kind === "loading" || performance.isFetching} onRefresh={() => void refresh()} />}>
    <AppHeader eyebrow="OWAJID AI" title="Wajid AI Signals" subtitle="Canonical server signal source" />
    <View style={styles.marketRow}><Text style={styles.marketText}>{symbol} · {timeframe}</Text><StatusPill label="Market API" value={error ? "OFFLINE" : loading ? "CONNECTING" : "LIVE"} tone={error ? "loss" : loading ? "neutral" : "active"} /></View>
    {error && <ErrorState message={live.state.kind === "error" ? live.state.message : performance.error instanceof Error ? performance.error.message : "Unable to load server data."} onRetry={() => void refresh()} />}
    {loading && !error && <LoadingState label="Loading live canonical data…" />}
    {!loading && !error && <>
      <SectionTitle title="Overview" /><View style={styles.grid}><MetricCard label="Signal" value={signal?.direction ?? "WAIT"} tone={signal?.direction === "BUY" ? "positive" : signal?.direction === "SELL" ? "negative" : "neutral"} /><MetricCard label="Status" value={signal?.status ?? "WAIT"} /><MetricCard label="Win Rate" value={`${(performance.data?.summary.winRate ?? 0).toFixed(2)}%`} /><MetricCard label="Signals" value={String(performance.data?.summary.totalSignals ?? 0)} /></View>
      <SectionTitle title="Active Signal" />{signal ? <SignalCard signal={signal} /> : <EmptyState title="WAITING FOR SIGNAL" message="No PENDING or ACTIVE canonical signal is currently returned by the server." />}
      {lastUpdate && <Text style={styles.updated}>Last update {new Date(lastUpdate).toLocaleString()}</Text>}
    </>}
  </ScrollView>;
}
const styles = StyleSheet.create({ content: { padding: spacing.lg, paddingBottom: 40 }, marketRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: spacing.sm, marginBottom: spacing.md }, marketText: { color: colors.muted, fontSize: 11, fontWeight: "800", flex: 1 }, grid: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm }, updated: { color: colors.subtle, fontSize: 10, marginTop: spacing.sm } });
