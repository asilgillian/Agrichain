import { Feather } from "@expo/vector-icons";
import { useAuth, useUser } from "@clerk/expo";
import { useRouter } from "expo-router";
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
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
  const { signOut } = useAuth();
  const { user } = useUser();
  const userEmail =
    user?.primaryEmailAddress?.emailAddress ??
    user?.emailAddresses[0]?.emailAddress ??
    null;

  const handleSignOut = () => {
    Alert.alert("Sign out", "Sign out of AgriChain Field?", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Sign out",
        style: "destructive",
        onPress: async () => {
          await signOut();
        },
      },
    ]);
  };

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

      {/* Signed-in pill: shows the active account and lets the agent sign out. */}
      <View
        style={[
          styles.accountRow,
          { borderColor: colors.border, backgroundColor: colors.card },
        ]}
      >
        <View style={[styles.accountIcon, { backgroundColor: colors.accent }]}>
          <Feather name="user" size={16} color={colors.primary} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={[styles.accountLabel, { color: colors.mutedForeground }]}>Signed in</Text>
          <Text style={[styles.accountEmail, { color: colors.foreground }]} numberOfLines={1}>
            {userEmail ?? "Active session"}
          </Text>
        </View>
        <Pressable
          onPress={handleSignOut}
          style={({ pressed }) => [
            styles.signOutBtn,
            { borderColor: colors.border, opacity: pressed ? 0.6 : 1 },
          ]}
          testID="home-sign-out"
        >
          <Text style={[styles.signOutText, { color: colors.foreground }]}>Sign out</Text>
        </Pressable>
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

      <ActionCard
        icon="shopping-cart"
        title="Procurement intake"
        subtitle="Build a batch from farmer contributions, lock it, and hand off to a buying station."
        onPress={() => router.push("/procurement")}
        testID="home-procurement"
      />

      <Text style={[styles.sectionLabel, { color: colors.mutedForeground }]}>Coming soon</Text>

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
        {"Need exports, certifications or back-office tools? Open the AgriChain web console."}
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
  accountRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    borderWidth: 1,
    borderRadius: 12,
    padding: 12,
    marginBottom: 4,
  },
  accountIcon: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
  },
  accountLabel: {
    fontSize: 10,
    fontWeight: "700",
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  accountEmail: {
    fontSize: 13,
    fontWeight: "500",
    marginTop: 1,
  },
  signOutBtn: {
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  signOutText: {
    fontSize: 12,
    fontWeight: "600",
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
