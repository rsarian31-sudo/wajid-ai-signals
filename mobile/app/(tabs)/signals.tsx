import { useCallback } from "react";
import { RefreshControl, ScrollView, StyleSheet, View } from "react-native";
import { useFocusEffect } from "expo-router";
import { AppHeader } from "@/components/AppHeader";
import { StrategyCard } from "@/components/StrategyCard";
import { EmptyState } from "@/components/EmptyState";
import { LoadingState } from "@/components/LoadingState";
import { ErrorState } from "@/components/ErrorState";
import { SignalCard } from "@/components/SignalCard";
import { colors, spacing } from "@/constants/theme";
import { STRATEGIES } from "@/constants/strategies";
import { useStrategySignal } from "@/hooks/useStrategySignal";

export default function SignalsScreen() {
  const strong = useStrategySignal("strong_sd_magnet");
  const liquidity = useStrategySignal("swing_liquidity");
  const forecast = useStrategySignal("swing_forecast");
  const items = [strong, liquidity, forecast];
  const refresh = useCallback(() => Promise.all(items.map((item) => item.refresh())), [strong, liquidity, forecast]);
  useFocusEffect(useCallback(() => { void refresh(); }, [refresh]));
  const anyLoading = items.some((item) => item.state.kind === "loading");
  const anyError = items.some((item) => item.state.kind === "error");
  return <ScrollView contentContainerStyle={styles.content} refreshControl={<RefreshControl tintColor={colors.accent} refreshing={anyLoading} onRefresh={() => void refresh()} />}>
    <AppHeader eyebrow="SIGNAL ENGINE" title="Signals" subtitle="Live strategy endpoints + canonical lifecycle" />
    {anyError && <ErrorState message="One or more live strategy endpoints could not be loaded." onRetry={() => void refresh()} />}
    {anyLoading && !anyError && <LoadingState label="Loading live signals…" />}
    {!anyLoading && !anyError && <View style={styles.list}>{STRATEGIES.map((strategy, index) => {
      const item = items[index];
      if (!item) return null;
      return <View key={strategy.id}><StrategyCard title={strategy.name} description={strategy.description} state={item.state.kind === "ready" ? item.state.data.status : "WAITING FOR SIGNAL"} />{item.state.kind === "ready" ? <SignalCard signal={item.state.data} /> : <EmptyState title="WAITING FOR SIGNAL" message="No PENDING or ACTIVE canonical signal was returned by the backend." />}</View>;
    })}</View>}
  </ScrollView>;
}
const styles = StyleSheet.create({ content: { padding: spacing.lg, paddingBottom: 40 }, list: { gap: spacing.sm } });
