import { StyleSheet, Text, View } from "react-native";
import { colors, radius, spacing } from "@/constants/theme";
export function EmptyState({ title, message }: { title: string; message: string }) { return <View style={styles.container}><Text style={styles.title}>{title}</Text><Text style={styles.message}>{message}</Text></View>; }
const styles = StyleSheet.create({ container: { padding: spacing.xl, backgroundColor: colors.surface, borderColor: colors.border, borderWidth: 1, borderRadius: radius.md, alignItems: "center" }, title: { color: colors.text, fontSize: 14, fontWeight: "900", textAlign: "center" }, message: { color: colors.muted, fontSize: 11, lineHeight: 17, textAlign: "center", marginTop: spacing.sm } });
