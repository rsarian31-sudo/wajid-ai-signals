import { ActivityIndicator, StyleSheet, Text, View } from "react-native";
import { colors, spacing } from "@/constants/theme";
export function LoadingState({ label = "Loading…" }: { label?: string }) { return <View style={styles.container}><ActivityIndicator color={colors.accent} /><Text style={styles.label}>{label}</Text></View>; }
const styles = StyleSheet.create({ container: { padding: spacing.xl, alignItems: "center", gap: spacing.sm }, label: { color: colors.muted, fontSize: 11 } });
