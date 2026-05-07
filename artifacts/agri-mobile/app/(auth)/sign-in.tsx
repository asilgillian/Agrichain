import { Feather } from "@expo/vector-icons";
import { useSignIn } from "@clerk/expo";
import { Link, useRouter, type Href } from "expo-router";
import React, { useState } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useColors } from "@/hooks/useColors";

export default function SignInScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { signIn, errors, fetchStatus } = useSignIn();

  const [emailAddress, setEmailAddress] = useState("");
  const [password, setPassword] = useState("");

  const submit = async () => {
    if (!emailAddress.trim() || !password) return;
    const { error } = await signIn.password({
      emailAddress: emailAddress.trim(),
      password,
    });
    if (error) return;

    if (signIn.status === "complete") {
      await signIn.finalize({
        navigate: ({ decorateUrl }) => {
          const url = decorateUrl("/(tabs)");
          router.replace(url as Href);
        },
      });
    }
  };

  const isFetching = fetchStatus === "fetching";
  const disabled = !emailAddress.trim() || !password || isFetching;

  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: colors.background }}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <ScrollView
        contentContainerStyle={[
          styles.container,
          { paddingTop: insets.top + 32, paddingBottom: insets.bottom + 32 },
        ]}
        keyboardShouldPersistTaps="handled"
      >
        <View style={[styles.badge, { backgroundColor: colors.primary }]}>
          <Feather name="package" size={26} color={colors.primaryForeground} />
        </View>
        <Text style={[styles.title, { color: colors.foreground }]}>Welcome back</Text>
        <Text style={[styles.subtitle, { color: colors.mutedForeground }]}>
          Sign in to AgriChain Field
        </Text>

        <Text style={[styles.label, { color: colors.mutedForeground }]}>Email</Text>
        <TextInput
          style={[
            styles.input,
            { borderColor: colors.border, backgroundColor: colors.card, color: colors.foreground },
          ]}
          autoCapitalize="none"
          autoComplete="email"
          keyboardType="email-address"
          placeholder="you@example.com"
          placeholderTextColor={colors.mutedForeground}
          value={emailAddress}
          onChangeText={setEmailAddress}
          testID="signin-email"
        />
        {errors.fields.identifier && (
          <Text style={[styles.error, { color: colors.destructive }]}>
            {errors.fields.identifier.message}
          </Text>
        )}

        <Text style={[styles.label, { color: colors.mutedForeground }]}>Password</Text>
        <TextInput
          style={[
            styles.input,
            { borderColor: colors.border, backgroundColor: colors.card, color: colors.foreground },
          ]}
          secureTextEntry
          placeholder="••••••••"
          placeholderTextColor={colors.mutedForeground}
          value={password}
          onChangeText={setPassword}
          testID="signin-password"
        />
        {errors.fields.password && (
          <Text style={[styles.error, { color: colors.destructive }]}>
            {errors.fields.password.message}
          </Text>
        )}
        {errors.global && errors.global.length > 0 && (
          <Text style={[styles.error, { color: colors.destructive }]}>
            {errors.global.map((e) => e.message).join(", ")}
          </Text>
        )}

        <Pressable
          onPress={submit}
          disabled={disabled}
          style={({ pressed }) => [
            styles.button,
            {
              backgroundColor: colors.primary,
              opacity: disabled ? 0.5 : pressed ? 0.85 : 1,
            },
          ]}
          testID="signin-submit"
        >
          {isFetching ? (
            <ActivityIndicator color={colors.primaryForeground} />
          ) : (
            <Text style={[styles.buttonText, { color: colors.primaryForeground }]}>
              Sign in
            </Text>
          )}
        </Pressable>

        <View style={[styles.linkRow, { marginTop: 12 }]}>
          <Link href="/(auth)/forgot-password">
            <Text style={[styles.link, { color: colors.primary }]}>
              Forgot password?
            </Text>
          </Link>
        </View>

        <View style={styles.linkRow}>
          <Text style={{ color: colors.mutedForeground }}>{"Don't have an account? "}</Text>
          <Link href="/(auth)/sign-up" replace>
            <Text style={[styles.link, { color: colors.primary }]}>Create one</Text>
          </Link>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    paddingHorizontal: 24,
    gap: 10,
  },
  badge: {
    alignSelf: "center",
    width: 56,
    height: 56,
    borderRadius: 28,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 12,
  },
  title: { fontSize: 26, fontWeight: "700", textAlign: "center" },
  subtitle: { fontSize: 14, textAlign: "center", marginBottom: 16 },
  label: {
    fontSize: 12,
    fontWeight: "600",
    textTransform: "uppercase",
    letterSpacing: 0.5,
    marginTop: 6,
  },
  input: {
    borderWidth: 1,
    borderRadius: 8,
    paddingVertical: 12,
    paddingHorizontal: 14,
    fontSize: 15,
  },
  error: { fontSize: 12, marginTop: 2 },
  button: {
    marginTop: 18,
    borderRadius: 10,
    paddingVertical: 14,
    alignItems: "center",
    justifyContent: "center",
  },
  buttonText: { fontSize: 16, fontWeight: "600" },
  linkRow: {
    flexDirection: "row",
    justifyContent: "center",
    marginTop: 20,
  },
  link: { fontWeight: "600" },
});
