import { Feather } from "@expo/vector-icons";
import { StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useColors } from "@/hooks/useColors";

export default function HomeScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();

  return (
    <View
      style={[
        styles.container,
        {
          backgroundColor: colors.background,
          paddingTop: insets.top + 24,
          paddingBottom: insets.bottom + 24,
        },
      ]}
    >
      <View style={[styles.badge, { backgroundColor: colors.primary }]}>
        <Feather name="package" size={28} color={colors.primaryForeground} />
      </View>

      <Text style={[styles.title, { color: colors.foreground }]}>
        AgriChain Field
      </Text>
      <Text style={[styles.subtitle, { color: colors.mutedForeground }]}>
        Mobile companion for MTANDEO buyers and field officers
      </Text>

      <View
        style={[
          styles.card,
          { backgroundColor: colors.card, borderColor: colors.border },
        ]}
      >
        <View style={styles.row}>
          <Feather name="clipboard" size={18} color={colors.primary} />
          <Text style={[styles.rowText, { color: colors.foreground }]}>
            Field sample capture
          </Text>
        </View>
        <View style={styles.row}>
          <Feather name="map-pin" size={18} color={colors.primary} />
          <Text style={[styles.rowText, { color: colors.foreground }]}>
            GPS-tagged collection points
          </Text>
        </View>
        <View style={styles.row}>
          <Feather name="wifi-off" size={18} color={colors.primary} />
          <Text style={[styles.rowText, { color: colors.foreground }]}>
            Offline-first sync queue
          </Text>
        </View>
      </View>

      <Text style={[styles.footer, { color: colors.mutedForeground }]}>
        Coming soon — for now use the web console at /procurement
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 24,
    gap: 12,
  },
  badge: {
    width: 64,
    height: 64,
    borderRadius: 32,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 8,
  },
  title: {
    fontSize: 26,
    fontWeight: "700",
    textAlign: "center",
  },
  subtitle: {
    fontSize: 15,
    textAlign: "center",
    paddingHorizontal: 12,
    marginBottom: 16,
  },
  card: {
    width: "100%",
    maxWidth: 360,
    borderWidth: 1,
    borderRadius: 12,
    padding: 16,
    gap: 12,
    marginBottom: 16,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  rowText: {
    fontSize: 15,
    fontWeight: "500",
  },
  footer: {
    fontSize: 12,
    textAlign: "center",
  },
});
