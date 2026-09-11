import { useCallback } from "react";
import { RefreshControl, ScrollView, StyleSheet } from "react-native";
import { useLocalSearchParams, useFocusEffect } from "expo-router";
import { AppHeader } from "@/components/AppHeader";
import { EmptyState } from "@/components/EmptyState";
import { LoadingState } from "@/components/LoadingState";
import { ErrorState } from "@/components/ErrorState";
import { SignalCard } from "@/components/SignalCard";
import { useStrategySignal } from "@/hooks/useStrategySignal";
import { getStrategyById } from "@/constants/strategies";
import { spacing } from "@/constants/theme";

export default function StrategySignalScreen() {
  const { strategy } = useLocalSearchParams<{ strategy: string }>();
  const strategyConfig = getStrategyById(strategy ?? "");
  const { state, refresh } = useStrategySignal(strategyConfig?.id);
  useFocusEffect(useCallback(() => { void refresh(); }, [refresh]));
  return <ScrollView contentContainerStyle={styles.content} refreshControl={<RefreshControl refreshing={state.kind === "loading"} onRefresh={() => void refresh()} />}>
    <AppHeader eyebrow="STRATEGY" title={strategyConfig?.name ?? "Signal"} subtitle="Canonical server source of truth" />
    {state.kind === "loading" && <LoadingState label="Loading signal…" />}
    {state.kind === "error" && <ErrorState message={state.message} onRetry={() => void refresh()} />}
    {state.kind === "empty" && <EmptyState title="WAITING FOR SIGNAL" message="No PENDING or ACTIVE canonical signal is persisted for this strategy." />}
    {state.kind === "ready" && <SignalCard signal={state.data} />}
  </ScrollView>;
}
const styles = StyleSheet.create({ content: { padding: spacing.lg, paddingBottom: 40 } });
