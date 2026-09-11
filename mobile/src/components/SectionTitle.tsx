import { StyleSheet, Text, View } from "react-native";
import { colors, spacing } from "@/constants/theme";
export function SectionTitle({ title }: { title: string }) { return <View style={styles.container}><Text style={styles.title}>{title}</Text></View>; }
const styles = StyleSheet.create({ container: { marginTop: spacing.sm, marginBottom: spacing.sm }, title: { color: colors.muted, fontSize: 11, fontWeight: "900", letterSpacing: 0.8, textTransform: "uppercase" } });
