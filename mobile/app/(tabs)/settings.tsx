import { ScrollView, StyleSheet, View } from "react-native";
import { AppHeader } from "@/components/AppHeader";
import { SettingsRow } from "@/components/SettingsRow";
import { SectionTitle } from "@/components/SectionTitle";
import { colors, spacing } from "@/constants/theme";

export default function SettingsScreen() {
  return <ScrollView contentContainerStyle={styles.content}>
    <AppHeader eyebrow="APP" title="Settings" subtitle="Read-only connection configuration" />
    <SectionTitle title="Connection" /><View style={styles.card}><SettingsRow label="API source" value="Server API" /><SettingsRow label="Strategy calculations" value="Server only" /></View>
    <SectionTitle title="Notifications" /><View style={styles.card}><SettingsRow label="Push notifications" value="Not configured" /></View>
    <SectionTitle title="Trading" /><View style={styles.card}><SettingsRow label="MT5 integration" value="Not configured" /><SettingsRow label="Client-side execution" value="Disabled" /></View>
  </ScrollView>;
}
const styles = StyleSheet.create({ content: { padding: spacing.lg, paddingBottom: 40 }, card: { borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, borderRadius: 16, paddingHorizontal: spacing.md, marginBottom: spacing.lg } });
