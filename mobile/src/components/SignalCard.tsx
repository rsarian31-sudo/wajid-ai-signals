import { StyleSheet, Text, View } from "react-native";
import type { CanonicalSignal } from "@/types/canonical";
import { colors, radius, spacing } from "@/constants/theme";
import { formatPrice, formatTime } from "@/utils/canonical";
import { StatusPill } from "./StatusPill";
function metadataRecord(signal: CanonicalSignal, key: string) { const value = signal.metadata?.[key]; return value && typeof value === "object" ? value as Record<string, unknown> : undefined; }
function numberValue(value: unknown) { return typeof value === "number" && Number.isFinite(value) ? formatPrice(value) : null; }
export function SignalCard({ signal }: { signal: CanonicalSignal }) {
  const directionStyle = signal.direction === "BUY" ? styles.buy : styles.sell;
  const signalMetadata = metadataRecord(signal, "signal");
  const forecast = metadataRecord(signal, "forecast");
  const tradePlan = metadataRecord(signal, "tradePlan");
  const quality = typeof signalMetadata?.quality === "string" ? signalMetadata.quality : typeof signal.metadata?.quality === "string" ? signal.metadata.quality : null;
  const confidence = numberValue(signalMetadata?.confidence) ?? numberValue(signal.metadata?.confidence);
  const forecastOrigin = numberValue(signalMetadata?.forecastOrigin) ?? numberValue(forecast?.origin);
  const forecastTarget = numberValue(signalMetadata?.forecastTarget) ?? numberValue(forecast?.target);
  const forecastPercent = numberValue(signalMetadata?.forecastPercent) ?? numberValue(forecast?.forecastPercent);
  const forecastBars = numberValue(signalMetadata?.forecastBars) ?? numberValue(forecast?.forecastBars);
  const uncertainty = numberValue(signalMetadata?.uncertaintyPercent) ?? numberValue(forecast?.uncertaintyPercent);
  const atrMultiple = numberValue(signalMetadata?.atrMultiple) ?? numberValue(forecast?.atrMultiple);
  const liquidityEntry = numberValue(tradePlan?.entry);
  return <View style={styles.card}>
    <View style={styles.top}><View style={styles.copy}><Text style={styles.strategy}>{signal.strategy.replaceAll("_", " ")}</Text><Text style={styles.meta}>{signal.symbol} · {signal.timeframe}</Text></View><Text style={[styles.direction, directionStyle]}>{signal.direction}</Text></View>
    <View style={styles.status}><StatusPill label="Status" value={signal.status} tone={signal.status === "ACTIVE" ? "active" : signal.status === "WIN" ? "win" : signal.status === "LOSS" ? "loss" : "neutral"} /></View>
    {(quality || confidence) && <View style={styles.metrics}>{quality && <Text style={styles.metric}>Quality {quality}</Text>}{confidence && <Text style={styles.metric}>Confidence {confidence}</Text>}</View>}
    <View style={styles.grid}><Text style={styles.value}>Entry {formatPrice(signal.entryPrice)}</Text><Text style={styles.value}>SL {formatPrice(signal.stopLoss)}</Text>{signal.takeProfit.map((tp, index) => <Text key={`${signal.id}-tp-${index}`} style={styles.value}>TP{index + 1} {formatPrice(tp)}</Text>)}</View>
    {liquidityEntry && <Text style={styles.meta}>Backend trade-plan entry {liquidityEntry}</Text>}
    {signal.strategy === "swing_forecast" && (forecastOrigin || forecastTarget || forecastPercent || forecastBars || uncertainty || atrMultiple) && <View style={styles.forecastBox}><Text style={styles.section}>Forecast</Text>{forecastOrigin && <Text style={styles.meta}>Origin {forecastOrigin}</Text>}{forecastTarget && <Text style={styles.meta}>Target {forecastTarget}</Text>}{forecastPercent && <Text style={styles.meta}>Move {forecastPercent}%</Text>}{forecastBars && <Text style={styles.meta}>Bars {forecastBars}</Text>}{uncertainty && <Text style={styles.meta}>Uncertainty {uncertainty}%</Text>}{atrMultiple && <Text style={styles.meta}>ATR multiple {atrMultiple}</Text>}</View>}
    <Text style={styles.meta}>Signal {formatTime(signal.signalTime)}</Text>{signal.entryCandleTime && <Text style={styles.meta}>Entry candle {formatTime(signal.entryCandleTime)}</Text>}<Text style={styles.id}>ID {signal.id}</Text>
  </View>;
}
const styles = StyleSheet.create({ card: { backgroundColor: colors.surface, borderColor: colors.border, borderWidth: 1, borderRadius: radius.md, padding: spacing.md, marginBottom: spacing.sm }, top: { flexDirection: "row", alignItems: "center", gap: spacing.md }, copy: { flex: 1 }, strategy: { color: colors.text, fontWeight: "900", fontSize: 14, textTransform: "capitalize" }, direction: { fontWeight: "900", fontSize: 15 }, buy: { color: colors.buy }, sell: { color: colors.sell }, status: { marginTop: spacing.sm, alignSelf: "flex-start" }, metrics: { flexDirection: "row", gap: spacing.md, flexWrap: "wrap", marginTop: spacing.sm }, metric: { color: colors.info, fontSize: 10, fontWeight: "800" }, grid: { gap: 5, marginVertical: spacing.md }, value: { color: colors.text, fontSize: 11, fontWeight: "800" }, forecastBox: { borderTopWidth: 1, borderTopColor: colors.border, marginTop: spacing.sm, paddingTop: spacing.sm }, section: { color: colors.text, fontSize: 11, fontWeight: "900", marginBottom: 4 }, meta: { color: colors.muted, fontSize: 10, marginTop: 4 }, id: { color: colors.subtle, fontSize: 9, marginTop: spacing.sm } });
