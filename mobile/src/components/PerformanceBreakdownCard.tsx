import { StyleSheet, Text, View } from "react-native";
import type { PerformanceBreakdown } from "@/types/canonical";
import { colors, radius, spacing } from "@/constants/theme";
export function PerformanceBreakdownCard({ title, data }: { title: string; data: PerformanceBreakdown }) { return <View style={styles.card}><Text style={styles.title}>{title}</Text><Text style={styles.meta}>{data.totalSignals} signals · {data.wins} wins · {data.losses} losses · {data.ambiguous} ambiguous · {data.winRate.toFixed(2)}% win rate</Text><Text style={styles.meta}>Pending {data.pending} · Active {data.active}</Text></View>; }
const styles = StyleSheet.create({ card: { backgroundColor: colors.surface, borderColor: colors.border, borderWidth: 1, borderRadius: radius.md, padding: spacing.md }, title: { color: colors.text, fontWeight: "900", fontSize: 13 }, meta: { color: colors.muted, fontSize: 10, marginTop: 6 } });
