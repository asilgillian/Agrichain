import { Feather } from "@expo/vector-icons";
import { useAuth, useSignUp } from "@clerk/expo";
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

export default function SignUpScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { signUp, errors, fetchStatus } = useSignUp();
  const { isSignedIn } = useAuth();

  const [emailAddress, setEmailAddress] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");

  const submit = async () => {
    if (!emailAddress.trim() || !password) return;
    const { error } = await signUp.password({
      emailAddress: emailAddress.trim(),
      password,
    });
    if (error) return;
    await signUp.verifications.sendEmailCode();
  };

  const verify = async () => {
    if (!code.trim()) return;
    await signUp.verifications.verifyEmailCode({ code: code.trim() });
    if (signUp.status === "complete") {
      await signUp.finalize({
        navigate: ({ decorateUrl }) => {
          const url = decorateUrl("/(tabs)");
          router.replace(url as Href);
        },
      });
    }
  };

  if (signUp.status === "complete" || isSignedIn) return null;

  const isFetching = fetchStatus === "fetching";
  const needsVerification =
    signUp.status === "missing_requirements" &&
    signUp.unverifiedFields.includes("email_address") &&
    signUp.missingFields.length === 0;

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

        {needsVerification ? (
          <>
            <Text style={[styles.title, { color: colors.foreground }]}>Verify your email</Text>
            <Text style={[styles.subtitle, { color: colors.mutedForeground }]}>
              {`We sent a 6-digit code to ${emailAddress}.`}
            </Text>

            <Text style={[styles.label, { color: colors.mutedForeground }]}>Verification code</Text>
            <TextInput
              style={[
                styles.input,
                { borderColor: colors.border, backgroundColor: colors.card, color: colors.foreground },
              ]}
              keyboardType="numeric"
              placeholder="123456"
              placeholderTextColor={colors.mutedForeground}
              value={code}
              onChangeText={setCode}
              testID="signup-code"
            />
            {errors.fields.code && (
              <Text style={[styles.error, { color: colors.destructive }]}>
                {errors.fields.code.message}
              </Text>
            )}

            <Pressable
              onPress={verify}
              disabled={!code.trim() || isFetching}
              style={({ pressed }) => [
                styles.button,
                {
                  backgroundColor: colors.primary,
                  opacity: !code.trim() || isFetching ? 0.5 : pressed ? 0.85 : 1,
                },
              ]}
              testID="signup-verify"
            >
              {isFetching ? (
                <ActivityIndicator color={colors.primaryForeground} />
              ) : (
                <Text style={[styles.buttonText, { color: colors.primaryForeground }]}>
                  Verify and continue
                </Text>
              )}
            </Pressable>

            <Pressable
              onPress={() => signUp.verifications.sendEmailCode()}
              style={styles.linkRow}
            >
              <Text style={[styles.link, { color: colors.primary }]}>Send a new code</Text>
            </Pressable>
          </>
        ) : (
          <>
            <Text style={[styles.title, { color: colors.foreground }]}>Create your account</Text>
            <Text style={[styles.subtitle, { color: colors.mutedForeground }]}>
              Join the MTANDEO field officer team
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
              testID="signup-email"
            />
            {errors.fields.emailAddress && (
              <Text style={[styles.error, { color: colors.destructive }]}>
                {errors.fields.emailAddress.message}
              </Text>
            )}

            <Text style={[styles.label, { color: colors.mutedForeground }]}>Password</Text>
            <TextInput
              style={[
                styles.input,
                { borderColor: colors.border, backgroundColor: colors.card, color: colors.foreground },
              ]}
              secureTextEntry
              placeholder="At least 8 characters"
              placeholderTextColor={colors.mutedForeground}
              value={password}
              onChangeText={setPassword}
              testID="signup-password"
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
              disabled={!emailAddress.trim() || !password || isFetching}
              style={({ pressed }) => [
                styles.button,
                {
                  backgroundColor: colors.primary,
                  opacity:
                    !emailAddress.trim() || !password || isFetching
                      ? 0.5
                      : pressed
                      ? 0.85
                      : 1,
                },
              ]}
              testID="signup-submit"
            >
              {isFetching ? (
                <ActivityIndicator color={colors.primaryForeground} />
              ) : (
                <Text style={[styles.buttonText, { color: colors.primaryForeground }]}>
                  Continue
                </Text>
              )}
            </Pressable>

            <View style={styles.linkRow}>
              <Text style={{ color: colors.mutedForeground }}>Already have an account? </Text>
              <Link href="/(auth)/sign-in" replace>
                <Text style={[styles.link, { color: colors.primary }]}>Sign in</Text>
              </Link>
            </View>
          </>
        )}

        {/* Required for sign-up flows. Clerk's bot sign-up protection is enabled by default. */}
        <View nativeID="clerk-captcha" />
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { paddingHorizontal: 24, gap: 10 },
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
