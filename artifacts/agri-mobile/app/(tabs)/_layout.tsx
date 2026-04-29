import { useAuth } from "@clerk/expo";
import { BlurView } from "expo-blur";
import { isLiquidGlassAvailable } from "expo-glass-effect";
import { Redirect, Tabs } from "expo-router";
import { Icon, Label, NativeTabs } from "expo-router/unstable-native-tabs";
import { SymbolView } from "expo-symbols";
import { Feather } from "@expo/vector-icons";
import { setAuthTokenGetter } from "@workspace/api-client-react";
import React, { useEffect } from "react";
import { ActivityIndicator, Platform, Pressable, StyleSheet, Text, View, useColorScheme } from "react-native";

import { PendingApprovalScreen } from "@/components/PendingApprovalScreen";
import { useColors } from "@/hooks/useColors";
import { useMe } from "@/hooks/useMe";

// IMPORTANT: iOS 26 uses NativeTabs for native tabs with liquid glass support.
// NativeTabs intentionally does NOT use custom design tokens — liquid glass
// is a system-level appearance provided by iOS and cannot be overridden.
// Custom brand colors are applied only on the ClassicTabLayout path (older iOS / Android / web).
const styles = StyleSheet.create({
  loader: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
  },
});

function NativeTabLayout() {
  return (
    <NativeTabs>
      <NativeTabs.Trigger name="index">
        <Icon sf={{ default: "house", selected: "house.fill" }} />
        <Label>Home</Label>
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="preregister">
        <Icon sf={{ default: "person.badge.plus", selected: "person.badge.plus.fill" }} />
        <Label>Pre-register</Label>
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="register">
        <Icon sf={{ default: "person.crop.circle.badge.checkmark", selected: "person.crop.circle.badge.checkmark" }} />
        <Label>Register</Label>
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="complete">
        <Icon sf={{ default: "checkmark.seal", selected: "checkmark.seal.fill" }} />
        <Label>Complete</Label>
      </NativeTabs.Trigger>
    </NativeTabs>
  );
}

function ClassicTabLayout() {
  const colors = useColors();
  const colorScheme = useColorScheme();
  const isDark = colorScheme === "dark";
  const isIOS = Platform.OS === "ios";
  const isWeb = Platform.OS === "web";

  return (
    <Tabs
      screenOptions={{
        tabBarActiveTintColor: colors.primary,
        tabBarInactiveTintColor: colors.mutedForeground,
        headerShown: true,
        tabBarStyle: {
          position: "absolute",
          backgroundColor: isIOS ? "transparent" : colors.background,
          borderTopWidth: isWeb ? 1 : 0,
          borderTopColor: colors.border,
          elevation: 0,
          ...(isWeb ? { height: 84 } : {}),
        },
        tabBarBackground: () =>
          isIOS ? (
            <BlurView
              intensity={100}
              tint={isDark ? "dark" : "light"}
              style={StyleSheet.absoluteFill}
            />
          ) : isWeb ? (
            <View
              style={[
                StyleSheet.absoluteFill,
                { backgroundColor: colors.background },
              ]}
            />
          ) : null,
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: "Home",
          tabBarIcon: ({ color }) =>
            isIOS ? (
              <SymbolView name="house" tintColor={color} size={24} />
            ) : (
              <Feather name="home" size={22} color={color} />
            ),
        }}
      />
      <Tabs.Screen
        name="preregister"
        options={{
          title: "Pre-register",
          tabBarIcon: ({ color }) =>
            isIOS ? (
              <SymbolView name="person.badge.plus" tintColor={color} size={24} />
            ) : (
              <Feather name="user-plus" size={22} color={color} />
            ),
        }}
      />
      <Tabs.Screen
        name="register"
        options={{
          title: "Register",
          tabBarIcon: ({ color }) =>
            isIOS ? (
              <SymbolView name="person.crop.circle.badge.checkmark" tintColor={color} size={24} />
            ) : (
              <Feather name="user-check" size={22} color={color} />
            ),
        }}
      />
      <Tabs.Screen
        name="complete"
        options={{
          title: "Complete",
          tabBarIcon: ({ color }) =>
            isIOS ? (
              <SymbolView name="checkmark.seal" tintColor={color} size={24} />
            ) : (
              <Feather name="check-circle" size={22} color={color} />
            ),
        }}
      />
    </Tabs>
  );
}

function FullScreenLoader() {
  const colors = useColors();
  return (
    <View style={[styles.loader, { backgroundColor: colors.background }]}>
      <ActivityIndicator size="large" color={colors.primary} />
    </View>
  );
}

function FullScreenError({ onRetry, onSignOut }: { onRetry: () => void; onSignOut: () => void }) {
  const colors = useColors();
  return (
    <View style={[styles.loader, { backgroundColor: colors.background, paddingHorizontal: 24 }]}>
      <Feather name="alert-circle" size={42} color={colors.destructive} />
      <View style={{ height: 12 }} />
      <View>
        <Pressable
          onPress={onRetry}
          style={({ pressed }) => [
            { backgroundColor: colors.primary, paddingHorizontal: 18, paddingVertical: 12, borderRadius: 10, opacity: pressed ? 0.8 : 1, marginBottom: 8 },
          ]}
          testID="me-retry"
        >
          <Text style={{ color: colors.primaryForeground, fontWeight: "600", textAlign: "center" }}>
            Try again
          </Text>
        </Pressable>
        <Pressable
          onPress={onSignOut}
          style={({ pressed }) => [
            { borderWidth: 1, borderColor: colors.border, paddingHorizontal: 18, paddingVertical: 12, borderRadius: 10, opacity: pressed ? 0.8 : 1 },
          ]}
          testID="me-signout"
        >
          <Text style={{ color: colors.foreground, fontWeight: "500", textAlign: "center" }}>
            Sign out
          </Text>
        </Pressable>
      </View>
    </View>
  );
}

export default function TabLayout() {
  const { isLoaded, isSignedIn, getToken, signOut } = useAuth();

  // Wire the generated API client's token getter to Clerk so any call routed
  // through @workspace/api-client-react automatically gets a fresh Bearer token.
  useEffect(() => {
    if (!isLoaded) return;
    setAuthTokenGetter(isSignedIn ? () => getToken() : null);
  }, [isLoaded, isSignedIn, getToken]);

  // Resolve the user's server-side role. This is the canonical access gate — Clerk
  // tells us *who* the user is, but the app database tells us *what they're allowed
  // to do*. New sign-ups land in the "Pending" role until an admin grants real access.
  const { me, isLoading: meLoading, isError: meError, refetch } = useMe();

  if (!isLoaded) return null;
  if (!isSignedIn) return <Redirect href="/(auth)/sign-in" />;
  if (meLoading && !me) return <FullScreenLoader />;
  if (meError && !me) {
    return <FullScreenError onRetry={refetch} onSignOut={() => signOut()} />;
  }
  if (me?.role === "Pending") {
    return <PendingApprovalScreen onRefresh={refetch} refreshing={meLoading} />;
  }

  if (isLiquidGlassAvailable()) {
    return <NativeTabLayout />;
  }
  return <ClassicTabLayout />;
}
