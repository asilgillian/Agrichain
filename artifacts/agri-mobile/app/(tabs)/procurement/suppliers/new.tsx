import { Feather } from "@expo/vector-icons";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "expo-router";
import { useState } from "react";
import { Alert, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useApi } from "@/lib/api";
import { useColors } from "@/hooks/useColors";

// Third-party SUPPLIER registration screen.
//
// Suppliers sell coffee through the same delivery -> batch -> payment pipeline
// as farmers, but they are a distinct entity. A supplier is either a business
// (businessName + businessRegNo) or an individual (firstName + nationalId).
// Suppliers are NOT loan-eligible and have no GPS plots.

type SellerType = "business" | "individual";
type PaymentMethod = "cash" | "mobile_money" | "bank_transfer";
type MomoProvider = "mtn_momo" | "airtel_money";

const PHONE_PREFIX = "+256";

export default function SupplierRegisterScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const api = useApi();
  const qc = useQueryClient();

  const [sellerType, setSellerType] = useState<SellerType>("business");
  const [businessName, setBusinessName] = useState("");
  const [businessRegNo, setBusinessRegNo] = useState("");
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [nationalId, setNationalId] = useState("");
  const [phoneNumber, setPhoneNumber] = useState(PHONE_PREFIX);
  const [village, setVillage] = useState("");
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>("cash");
  const [momoProvider, setMomoProvider] = useState<MomoProvider>("mtn_momo");
  const [momoMsisdn, setMomoMsisdn] = useState("");
  const [bankName, setBankName] = useState("");
  const [bankAccountNumber, setBankAccountNumber] = useState("");

  const submit = useMutation({
    mutationFn: () => {
      const body: Record<string, unknown> = {
        sellerType,
        phoneNumber: phoneNumber.trim() || null,
        village: village.trim() || null,
        paymentMethod,
        // Field-registered suppliers are immediately transactable so the agent can
        // capture a delivery from them on the spot (capture only lists active sellers).
        status: "active",
      };
      if (sellerType === "business") {
        body.businessName = businessName.trim();
        body.businessRegNo = businessRegNo.trim() || null;
      } else {
        body.firstName = firstName.trim();
        body.lastName = lastName.trim() || null;
        body.nationalId = nationalId.trim();
      }
      if (paymentMethod === "mobile_money") {
        body.momoProvider = momoProvider;
        body.momoMsisdn = momoMsisdn.trim() || null;
      } else if (paymentMethod === "bank_transfer") {
        body.bankName = bankName.trim() || null;
        body.bankAccountNumber = bankAccountNumber.trim() || null;
      }
      return api<{ id: string; referenceNumber: string }>("/api/suppliers", { method: "POST", body });
    },
    onSuccess: (s) => {
      qc.invalidateQueries({ queryKey: ["suppliers-search"] });
      Alert.alert("Supplier registered", `${s.referenceNumber} created.`);
      router.back();
    },
    onError: (e: any) => Alert.alert("Could not register supplier", e?.message ?? "Failed"),
  });

  const canSubmit =
    (sellerType === "business" ? businessName.trim().length > 0 : firstName.trim().length > 0 && nationalId.trim().length > 0) &&
    !submit.isPending;

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: colors.background }}
      contentContainerStyle={[styles.container, { paddingBottom: insets.bottom + 40 }]}
      keyboardShouldPersistTaps="handled"
    >
      <Text style={[styles.h1, { color: colors.foreground }]}>New supplier</Text>
      <Text style={[styles.sub, { color: colors.mutedForeground }]}>
        Register a third-party seller. A reference number is generated automatically.
      </Text>

      {/* SELLER TYPE */}
      <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
        <Text style={[styles.label, { color: colors.foreground }]}>Seller type</Text>
        <View style={styles.segment}>
          {(["business", "individual"] as const).map(t => {
            const active = sellerType === t;
            return (
              <Pressable
                key={t}
                onPress={() => setSellerType(t)}
                style={[styles.segmentBtn, { borderColor: colors.border, backgroundColor: active ? colors.primary : colors.background }]}
                testID={`supplier-type-${t}`}
              >
                <Text style={{ color: active ? colors.primaryForeground : colors.foreground, fontWeight: "600", fontSize: 13 }}>
                  {t === "business" ? "Business" : "Individual"}
                </Text>
              </Pressable>
            );
          })}
        </View>
      </View>

      {/* IDENTITY */}
      <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
        {sellerType === "business" ? (
          <>
            <Field label="Business name *" value={businessName} onChangeText={setBusinessName} colors={colors} testID="supplier-business-name" />
            <Field label="Business reg. no." value={businessRegNo} onChangeText={setBusinessRegNo} colors={colors} testID="supplier-business-regno" />
          </>
        ) : (
          <>
            <Field label="First name *" value={firstName} onChangeText={setFirstName} colors={colors} testID="supplier-first-name" />
            <Field label="Last name" value={lastName} onChangeText={setLastName} colors={colors} testID="supplier-last-name" />
            <Field label="National ID *" value={nationalId} onChangeText={setNationalId} colors={colors} testID="supplier-national-id" />
          </>
        )}
      </View>

      {/* CONTACT */}
      <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
        <Field label="Phone number" value={phoneNumber} onChangeText={setPhoneNumber} colors={colors} keyboardType="phone-pad" testID="supplier-phone" />
        <Field label="Village" value={village} onChangeText={setVillage} colors={colors} testID="supplier-village" />
      </View>

      {/* PAYOUT */}
      <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
        <Text style={[styles.label, { color: colors.foreground }]}>Payout method</Text>
        <View style={styles.segment}>
          {(["cash", "mobile_money", "bank_transfer"] as const).map(m => {
            const active = paymentMethod === m;
            return (
              <Pressable
                key={m}
                onPress={() => setPaymentMethod(m)}
                style={[styles.segmentBtn, { borderColor: colors.border, backgroundColor: active ? colors.primary : colors.background }]}
                testID={`supplier-pay-${m}`}
              >
                <Text style={{ color: active ? colors.primaryForeground : colors.foreground, fontWeight: "600", fontSize: 12 }}>
                  {m === "cash" ? "Cash" : m === "mobile_money" ? "MoMo" : "Bank"}
                </Text>
              </Pressable>
            );
          })}
        </View>
        {paymentMethod === "mobile_money" && (
          <>
            <View style={styles.segment}>
              {(["mtn_momo", "airtel_money"] as const).map(p => {
                const active = momoProvider === p;
                return (
                  <Pressable
                    key={p}
                    onPress={() => setMomoProvider(p)}
                    style={[styles.segmentBtn, { borderColor: colors.border, backgroundColor: active ? colors.primary : colors.background }]}
                    testID={`supplier-momo-${p}`}
                  >
                    <Text style={{ color: active ? colors.primaryForeground : colors.foreground, fontWeight: "600", fontSize: 12 }}>
                      {p === "mtn_momo" ? "MTN MoMo" : "Airtel Money"}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
            <Field label="MoMo number" value={momoMsisdn} onChangeText={setMomoMsisdn} colors={colors} keyboardType="phone-pad" testID="supplier-momo-msisdn" />
          </>
        )}
        {paymentMethod === "bank_transfer" && (
          <>
            <Field label="Bank name" value={bankName} onChangeText={setBankName} colors={colors} testID="supplier-bank-name" />
            <Field label="Account number" value={bankAccountNumber} onChangeText={setBankAccountNumber} colors={colors} testID="supplier-bank-account" />
          </>
        )}
      </View>

      <Pressable
        onPress={() => submit.mutate()}
        disabled={!canSubmit}
        style={({ pressed }) => [styles.btnPrimary, { backgroundColor: colors.primary, opacity: !canSubmit ? 0.5 : pressed ? 0.85 : 1 }]}
        testID="submit-supplier"
      >
        <Text style={[styles.btnPrimaryText, { color: colors.primaryForeground }]}>{submit.isPending ? "Saving…" : "Register supplier"}</Text>
      </Pressable>
    </ScrollView>
  );
}

function Field({
  label, value, onChangeText, colors, keyboardType, testID,
}: {
  label: string;
  value: string;
  onChangeText: (v: string) => void;
  colors: ReturnType<typeof useColors>;
  keyboardType?: "default" | "phone-pad";
  testID?: string;
}) {
  return (
    <View style={{ gap: 6 }}>
      <Text style={[styles.label, { color: colors.foreground }]}>{label}</Text>
      <TextInput
        value={value}
        onChangeText={onChangeText}
        placeholderTextColor={colors.mutedForeground}
        keyboardType={keyboardType ?? "default"}
        autoCapitalize={keyboardType === "phone-pad" ? "none" : "words"}
        style={[styles.input, { color: colors.foreground, borderColor: colors.border, backgroundColor: colors.background }]}
        testID={testID}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { paddingHorizontal: 16, paddingTop: 12, gap: 12 },
  h1: { fontSize: 22, fontWeight: "700" },
  sub: { fontSize: 12, marginTop: 2, marginBottom: 4 },
  card: { borderWidth: 1, borderRadius: 12, padding: 14, gap: 12 },
  label: { fontSize: 13, fontWeight: "600" },
  input: { borderWidth: 1, borderRadius: 8, paddingHorizontal: 12, paddingVertical: 10, fontSize: 14 },
  segment: { flexDirection: "row", gap: 8 },
  segmentBtn: { flex: 1, borderWidth: 1, borderRadius: 8, paddingVertical: 10, alignItems: "center" },
  btnPrimary: { borderRadius: 10, alignItems: "center", justifyContent: "center", paddingVertical: 14, marginTop: 8 },
  btnPrimaryText: { fontWeight: "600", fontSize: 14 },
});
