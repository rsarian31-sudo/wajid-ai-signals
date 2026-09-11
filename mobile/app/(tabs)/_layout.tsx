import { Tabs } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { colors } from "@/constants/theme";

const iconMap = { index: "home-outline", signals: "pulse-outline", history: "time-outline", performance: "stats-chart-outline", settings: "settings-outline" } as const;

export default function TabsLayout() {
  return <Tabs screenOptions={({ route }) => ({
    headerShown: false,
    tabBarActiveTintColor: colors.accent,
    tabBarInactiveTintColor: colors.muted,
    tabBarStyle: { backgroundColor: colors.surface, borderTopColor: colors.border, height: 64, paddingBottom: 8, paddingTop: 8 },
    tabBarLabelStyle: { fontSize: 11, fontWeight: "700" },
    tabBarIcon: ({ color, size }) => <Ionicons name={iconMap[route.name as keyof typeof iconMap] ?? "ellipse-outline"} color={color} size={size} />,
  })}>
    <Tabs.Screen name="index" options={{ title: "Home" }} />
    <Tabs.Screen name="signals" options={{ title: "Signals" }} />
    <Tabs.Screen name="history" options={{ title: "History" }} />
    <Tabs.Screen name="performance" options={{ title: "Performance" }} />
    <Tabs.Screen name="settings" options={{ title: "Settings" }} />
  </Tabs>;
}
