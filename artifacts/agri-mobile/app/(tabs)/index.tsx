import { Feather } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useColors } from "@/hooks/useColors";

type FeatherIcon = React.ComponentProps<typeof Feather>["name"];

type ActionCardProps = {
  icon: FeatherIcon;
  title: string;
  subtitle: string;
  onPress?: () => void;
  disabled?: boolean;
  badge?: string;
  testID?: string;
};

export default function HomeScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: colors.background }}
      contentContainerStyle={[
        styles.container,
        {
          paddingTop: insets.top + 16,
          paddingBottom: insets.bottom + 32,
        },
      ]}
    >
      <View style={styles.header}>
        <View style={[styles.badge, { backgroundColor: colors.primary }]}>
          <Feather name="package" size={26} color={colors.primaryForeground} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={[styles.title, { color: colors.foreground }]}>AgriChain Field</Text>
          <Text style={[styles.subtitle, { color: colors.mutedForeground }]}>
            MTANDEO field officer companion
          </Text>
        </View>
      </View>

      {/* Auth gap notice — keep parity with the Pre-register screen so field officers know
          submissions are blocked until Clerk auth is wired into the mobile build. */}
      <View
        style={[
          styles.warning,
          { borderColor: "#f59e0b", backgroundColor: "rgba(245, 158, 11, 0.1)" },
        ]}
      >
        <Feather name="alert-triangle" size={18} color="#b45309" />
        <Text style={[styles.warningText, { color: colors.foreground }]}>
          {"Mobile sign-in isn't wired up yet — anything that talks to the server will fail with 401 until that lands. The screens below are ready for it."}
        </Text>
      </View>

      <Text style={[styles.sectionLabel, { color: colors.mutedForeground }]}>Available now</Text>

      <ActionCard
        icon="user-plus"
        title="Pre-register a farmer"
        subtitle="Capture name, group, region and an optional GPS pin in the field."
        onPress={() => router.push("/preregister")}
        testID="home-preregister"
      />

      <ActionCard
        icon="map-pin"
        title="Drop a GPS plot pin"
        subtitle="Use your device GPS to attach a single-point plot to a new farmer."
        onPress={() => router.push("/preregister")}
        testID="home-gps-pin"
      />

      <Text style={[styles.sectionLabel, { color: colors.mutedForeground }]}>Coming soon</Text>

      <ActionCard
        icon="clipboard"
        title="Procurement intake"
        subtitle="Weigh, grade and price deliveries at the buying station."
        disabled
        badge="Web"
      />
      <ActionCard
        icon="dollar-sign"
        title="Mobile money payments"
        subtitle="Trigger MTN / Airtel Money payouts to farmers."
        disabled
        badge="Web"
      />
      <ActionCard
        icon="wifi-off"
        title="Offline sync queue"
        subtitle="Queue field captures while offline and sync when back online."
        disabled
        badge="Soon"
      />
      <ActionCard
        icon="shield"
        title="EUDR & GAP compliance"
        subtitle="Attach certifications and traceability records to plots."
        disabled
        badge="Web"
      />

      <Text style={[styles.footer, { color: colors.mutedForeground }]}>
        {"Need procurement, payments or compliance? Open the AgriChain web console at /procurement."}
      </Text>
    </ScrollView>
  );
}

function ActionCard({ icon, title, subtitle, onPress, disabled, badge, testID }: ActionCardProps) {
  const colors = useColors();
  const interactive = !disabled && !!onPress;

  return (
    <Pressable
      onPress={interactive ? onPress : undefined}
      disabled={!interactive}
      style={({ pressed }) => [
        styles.card,
        {
          backgroundColor: colors.card,
          borderColor: colors.border,
          opacity: disabled ? 0.6 : pressed ? 0.85 : 1,
        },
      ]}
      testID={testID}
    >
      <View style={[styles.cardIcon, { backgroundColor: colors.accent }]}>
        <Feather name={icon} size={20} color={colors.primary} />
      </View>
      <View style={{ flex: 1 }}>
        <View style={styles.cardTitleRow}>
          <Text style={[styles.cardTitle, { color: colors.foreground }]}>{title}</Text>
          {badge && (
            <View style={[styles.badgePill, { backgroundColor: colors.muted }]}>
              <Text style={[styles.badgeText, { color: colors.mutedForeground }]}>{badge}</Text>
            </View>
          )}
        </View>
        <Text style={[styles.cardSubtitle, { color: colors.mutedForeground }]}>{subtitle}</Text>
      </View>
      {interactive && <Feather name="chevron-right" size={20} color={colors.mutedForeground} />}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: {
    paddingHorizontal: 20,
    gap: 12,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
    marginBottom: 8,
  },
  badge: {
    width: 52,
    height: 52,
    borderRadius: 26,
    alignItems: "center",
    justifyContent: "center",
  },
  title: {
    fontSize: 22,
    fontWeight: "700",
  },
  subtitle: {
    fontSize: 13,
    marginTop: 2,
  },
  warning: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 10,
    padding: 12,
    borderRadius: 8,
    borderWidth: 1,
    marginBottom: 4,
  },
  warningText: {
    flex: 1,
    fontSize: 12,
    lineHeight: 17,
  },
  sectionLabel: {
    fontSize: 11,
    fontWeight: "700",
    textTransform: "uppercase",
    letterSpacing: 0.6,
    marginTop: 12,
    marginBottom: 2,
  },
  card: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    borderWidth: 1,
    borderRadius: 12,
    padding: 14,
  },
  cardIcon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: "center",
    justifyContent: "center",
  },
  cardTitleRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  cardTitle: {
    fontSize: 15,
    fontWeight: "600",
    flexShrink: 1,
  },
  cardSubtitle: {
    fontSize: 12,
    lineHeight: 17,
    marginTop: 2,
  },
  badgePill: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 999,
  },
  badgeText: {
    fontSize: 10,
    fontWeight: "700",
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  footer: {
    fontSize: 12,
    textAlign: "center",
    marginTop: 18,
  },
});
