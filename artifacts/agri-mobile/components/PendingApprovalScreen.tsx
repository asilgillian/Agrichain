import { Feather } from "@expo/vector-icons";
import { useAuth, useUser } from "@clerk/expo";
import React from "react";
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useColors } from "@/hooks/useColors";

type Props = {
  onRefresh: () => void;
  refreshing?: boolean;
};

// Shown to authenticated users whose role is still "Pending" (i.e. an admin hasn't
// granted them a real role yet). All gated API calls will 403, so we surface a clear
// status screen instead of showing the action launcher.
export function PendingApprovalScreen({ onRefresh, refreshing }: Props) {
  const colors = useColors();
  const insets = useSafeAreaInsets();
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
        { paddingTop: insets.top + 24, paddingBottom: insets.bottom + 32 },
      ]}
    >
      <View style={[styles.iconWrap, { backgroundColor: colors.accent }]}>
        <Feather name="clock" size={36} color={colors.primary} />
      </View>

      <Text style={[styles.title, { color: colors.foreground }]}>Awaiting approval</Text>
      <Text style={[styles.subtitle, { color: colors.mutedForeground }]}>
        {"Your account was created, but a system administrator still needs to assign you a role before you can pre-register farmers or capture data in the field."}
      </Text>

      {userEmail && (
        <View style={[styles.emailPill, { borderColor: colors.border, backgroundColor: colors.card }]}>
          <Feather name="mail" size={14} color={colors.mutedForeground} />
          <Text style={[styles.emailText, { color: colors.foreground }]} numberOfLines={1}>
            {userEmail}
          </Text>
        </View>
      )}

      <View style={[styles.steps, { borderColor: colors.border, backgroundColor: colors.card }]}>
        <Text style={[styles.stepsTitle, { color: colors.foreground }]}>What happens next</Text>
        <Step
          n={1}
          text={"Ask your supervisor or the MTANDEO system administrator to grant your account a role (e.g. Field Officer or Procurement Clerk) from the AgriChain web console."}
          colors={colors}
        />
        <Step
          n={2}
          text={"Once they save your new role, tap \"Check again\" below to refresh your status."}
          colors={colors}
        />
        <Step
          n={3}
          text={"Sign out and back in if the screen doesn't update after the role is assigned."}
          colors={colors}
        />
      </View>

      <Pressable
        onPress={onRefresh}
        disabled={refreshing}
        style={({ pressed }) => [
          styles.primaryBtn,
          {
            backgroundColor: colors.primary,
            opacity: refreshing ? 0.6 : pressed ? 0.85 : 1,
          },
        ]}
        testID="pending-refresh"
      >
        {refreshing ? (
          <ActivityIndicator color={colors.primaryForeground} />
        ) : (
          <>
            <Feather name="refresh-cw" size={18} color={colors.primaryForeground} />
            <Text style={[styles.primaryBtnText, { color: colors.primaryForeground }]}>
              Check again
            </Text>
          </>
        )}
      </Pressable>

      <Pressable
        onPress={handleSignOut}
        style={({ pressed }) => [
          styles.secondaryBtn,
          { borderColor: colors.border, opacity: pressed ? 0.6 : 1 },
        ]}
        testID="pending-sign-out"
      >
        <Text style={[styles.secondaryBtnText, { color: colors.foreground }]}>Sign out</Text>
      </Pressable>
    </ScrollView>
  );
}

function Step({
  n,
  text,
  colors,
}: {
  n: number;
  text: string;
  colors: ReturnType<typeof useColors>;
}) {
  return (
    <View style={styles.step}>
      <View style={[styles.stepNumber, { backgroundColor: colors.accent }]}>
        <Text style={[styles.stepNumberText, { color: colors.primary }]}>{n}</Text>
      </View>
      <Text style={[styles.stepText, { color: colors.foreground }]}>{text}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    paddingHorizontal: 24,
    gap: 14,
    alignItems: "stretch",
  },
  iconWrap: {
    alignSelf: "center",
    width: 76,
    height: 76,
    borderRadius: 38,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 4,
  },
  title: {
    fontSize: 24,
    fontWeight: "700",
    textAlign: "center",
  },
  subtitle: {
    fontSize: 14,
    lineHeight: 20,
    textAlign: "center",
  },
  emailPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    alignSelf: "center",
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 6,
    maxWidth: "100%",
  },
  emailText: {
    fontSize: 12,
    fontWeight: "500",
    flexShrink: 1,
  },
  steps: {
    borderWidth: 1,
    borderRadius: 12,
    padding: 16,
    gap: 12,
    marginTop: 8,
  },
  stepsTitle: {
    fontSize: 14,
    fontWeight: "700",
    marginBottom: 4,
  },
  step: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 10,
  },
  stepNumber: {
    width: 22,
    height: 22,
    borderRadius: 11,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 1,
  },
  stepNumberText: {
    fontSize: 11,
    fontWeight: "700",
  },
  stepText: {
    flex: 1,
    fontSize: 13,
    lineHeight: 18,
  },
  primaryBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    borderRadius: 10,
    paddingVertical: 14,
    marginTop: 8,
  },
  primaryBtnText: {
    fontSize: 15,
    fontWeight: "600",
  },
  secondaryBtn: {
    borderWidth: 1,
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: "center",
  },
  secondaryBtnText: {
    fontSize: 14,
    fontWeight: "500",
  },
});
