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

type Step = "request" | "reset";

export default function ForgotPasswordScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { signIn, errors, fetchStatus } = useSignIn();

  const [step, setStep] = useState<Step>("request");
  const [emailAddress, setEmailAddress] = useState("");
  const [code, setCode] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [info, setInfo] = useState<string | null>(null);

  const isFetching = fetchStatus === "fetching";

  const requestCode = async () => {
    if (!emailAddress.trim()) return;
    setInfo(null);
    // Clerk Future API: first establish the identifier on the SignIn resource,
    // then trigger the reset-password email-code flow. The legacy
    // `signIn.create({ strategy: "reset_password_email_code" })` shape isn't
    // available on SignInFutureResource.
    const created = await signIn.create({ identifier: emailAddress.trim() });
    if (created.error) return;
    const sent = await signIn.resetPasswordEmailCode.sendCode();
    if (sent.error) return;
    setStep("reset");
    setInfo("We emailed you a 6-digit code. Enter it below with your new password.");
  };

  const resetPassword = async () => {
    if (!code.trim() || newPassword.length < 8) return;
    setInfo(null);
    // Two-step in the Future API: verify the code (advances signIn.status to
    // 'needs_new_password'), then submit the new password (advances to
    // 'complete').
    const verified = await signIn.resetPasswordEmailCode.verifyCode({ code: code.trim() });
    if (verified.error) return;
    const submitted = await signIn.resetPasswordEmailCode.submitPassword({ password: newPassword });
    if (submitted.error) return;

    if (signIn.status === "complete") {
      await signIn.finalize({
        navigate: ({ decorateUrl }) => {
          const url = decorateUrl("/(tabs)");
          router.replace(url as Href);
        },
      });
    } else {
      setInfo("Password reset. Please sign in with your new password.");
      router.replace("/(auth)/sign-in");
    }
  };

  const requestDisabled = !emailAddress.trim() || isFetching;
  const resetDisabled = !code.trim() || newPassword.length < 8 || isFetching;

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
          <Feather name="lock" size={26} color={colors.primaryForeground} />
        </View>
        <Text style={[styles.title, { color: colors.foreground }]}>
          Reset your password
        </Text>
        <Text style={[styles.subtitle, { color: colors.mutedForeground }]}>
          {step === "request"
            ? "We'll email you a code to reset your password."
            : "Enter the code from your email and choose a new password."}
        </Text>

        {step === "request" ? (
          <>
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
              testID="forgot-email"
            />
            {errors.fields.identifier && (
              <Text style={[styles.error, { color: colors.destructive }]}>
                {errors.fields.identifier.message}
              </Text>
            )}
            {errors.global && errors.global.length > 0 && (
              <Text style={[styles.error, { color: colors.destructive }]}>
                {errors.global.map((e) => e.message).join(", ")}
              </Text>
            )}

            <Pressable
              onPress={requestCode}
              disabled={requestDisabled}
              style={({ pressed }) => [
                styles.button,
                {
                  backgroundColor: colors.primary,
                  opacity: requestDisabled ? 0.5 : pressed ? 0.85 : 1,
                },
              ]}
              testID="forgot-send"
            >
              {isFetching ? (
                <ActivityIndicator color={colors.primaryForeground} />
              ) : (
                <Text style={[styles.buttonText, { color: colors.primaryForeground }]}>
                  Send reset code
                </Text>
              )}
            </Pressable>
          </>
        ) : (
          <>
            <Text style={[styles.label, { color: colors.mutedForeground }]}>
              Verification code
            </Text>
            <TextInput
              style={[
                styles.input,
                { borderColor: colors.border, backgroundColor: colors.card, color: colors.foreground },
              ]}
              autoCapitalize="none"
              keyboardType="number-pad"
              placeholder="123456"
              placeholderTextColor={colors.mutedForeground}
              value={code}
              onChangeText={setCode}
              testID="forgot-code"
            />
            {errors.fields.code && (
              <Text style={[styles.error, { color: colors.destructive }]}>
                {errors.fields.code.message}
              </Text>
            )}

            <Text style={[styles.label, { color: colors.mutedForeground }]}>
              New password
            </Text>
            <TextInput
              style={[
                styles.input,
                { borderColor: colors.border, backgroundColor: colors.card, color: colors.foreground },
              ]}
              secureTextEntry
              placeholder="At least 8 characters"
              placeholderTextColor={colors.mutedForeground}
              value={newPassword}
              onChangeText={setNewPassword}
              testID="forgot-new-password"
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
              onPress={resetPassword}
              disabled={resetDisabled}
              style={({ pressed }) => [
                styles.button,
                {
                  backgroundColor: colors.primary,
                  opacity: resetDisabled ? 0.5 : pressed ? 0.85 : 1,
                },
              ]}
              testID="forgot-submit"
            >
              {isFetching ? (
                <ActivityIndicator color={colors.primaryForeground} />
              ) : (
                <Text style={[styles.buttonText, { color: colors.primaryForeground }]}>
                  Set new password
                </Text>
              )}
            </Pressable>

            <Pressable onPress={() => setStep("request")} style={styles.linkRow}>
              <Text style={[styles.link, { color: colors.primary }]}>
                Resend code to a different email
              </Text>
            </Pressable>
          </>
        )}

        {info && (
          <Text style={[styles.info, { color: colors.mutedForeground }]}>{info}</Text>
        )}

        <View style={styles.linkRow}>
          <Text style={{ color: colors.mutedForeground }}>{"Remembered it? "}</Text>
          <Link href="/(auth)/sign-in" replace>
            <Text style={[styles.link, { color: colors.primary }]}>Back to sign in</Text>
          </Link>
        </View>
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
  info: { fontSize: 13, textAlign: "center", marginTop: 12 },
  button: {
    marginTop: 18,
    borderRadius: 10,
    paddingVertical: 14,
    alignItems: "center",
    justifyContent: "center",
  },
  buttonText: { fontSize: 16, fontWeight: "600" },
  linkRow: { flexDirection: "row", justifyContent: "center", marginTop: 16 },
  link: { fontWeight: "600" },
});
