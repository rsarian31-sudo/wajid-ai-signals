import { StyleSheet, Text, View } from "react-native";
import { colors, spacing } from "@/constants/theme";
export function SettingsRow({ label, value }: { label: string; value: string }) { return <View style={styles.row}><Text style={styles.label}>{label}</Text><Text style={styles.value}>{value}</Text></View>; }
const styles = StyleSheet.create({ row: { minHeight: 52, flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: spacing.md, borderBottomColor: colors.border, borderBottomWidth: 1 }, label: { color: colors.text, fontSize: 12, fontWeight: "700" }, value: { color: colors.muted, fontSize: 11, textAlign: "right" } });
