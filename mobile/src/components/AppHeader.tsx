import { StyleSheet, Text, View } from "react-native";
import { colors, spacing } from "@/constants/theme";
export function AppHeader({ eyebrow, title, subtitle }: { eyebrow: string; title: string; subtitle: string }) { return <View style={styles.container}><Text style={styles.eyebrow}>{eyebrow}</Text><Text style={styles.title}>{title}</Text><Text style={styles.subtitle}>{subtitle}</Text></View>; }
const styles = StyleSheet.create({ container: { marginBottom: spacing.xl }, eyebrow: { color: colors.accent, fontSize: 10, fontWeight: "900", letterSpacing: 1.4 }, title: { color: colors.text, fontSize: 28, fontWeight: "900", marginTop: 5 }, subtitle: { color: colors.muted, fontSize: 13, marginTop: 6 } });
