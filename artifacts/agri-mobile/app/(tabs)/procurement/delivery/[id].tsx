import { Feather } from "@expo/vector-icons";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useLocalSearchParams } from "expo-router";
import { useState } from "react";
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useApi } from "@/lib/api";
import { useColors } from "@/hooks/useColors";
import { useMe } from "@/hooks/useMe";

type Delivery = {
  id: string;
  lotTag: string;
  status: string;
  netWeightKg: number | null;
  grossWeightKg: number | null;
  tareWeightKg: number | null;
  totalValue: number | null;
  pricePerKg: number | null;
  farmerId: string | null;
  supplierId: string | null;
  sellerName: string | null;
  sellerType: "farmer" | "supplier" | null;
  weightApproved: boolean;
  qcApproved: boolean;
};

const STATUS_LABEL: Record<string, string> = {
  pending_weight_submit: "Awaiting weight",
  pending_weight_approve: "Awaiting weight approval",
  pending_qc_submit: "Awaiting QC",
  pending_qc_approve: "Awaiting QC approval",
  pending_pricing_propose: "Awaiting price",
  pending_pricing_approve: "Awaiting price approval",
  approved: "Approved — ready to pay",
};

// Field-side delivery view. Permission gates are mirrored on the server, but
// we hide actions the user cannot perform so the UI doesn't tease them with
// buttons that 403.
export default function DeliveryDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const api = useApi();
  const qc = useQueryClient();
  const { me } = useMe();
  const perms = me?.permissions ?? [];
  const has = (k: string) => perms.includes("*") || perms.includes(k);

  const { data: d, isLoading, refetch } = useQuery<Delivery>({
    queryKey: ["delivery", id],
    enabled: !!id,
    queryFn: () => api<Delivery>(`/api/procurement/deliveries/${id}`),
  });

  const [gross, setGross] = useState("");
  const [tare, setTare] = useState("");
  const [moisture, setMoisture] = useState("");
  const [defects, setDefects] = useState("");

  const submitWeight = useMutation({
    mutationFn: () => api(`/api/procurement/deliveries/${id}/weight/submit`, { method: "POST", body: { grossWeightKg: Number(gross), tareWeightKg: Number(tare) } }),
    onSuccess: () => { setGross(""); setTare(""); qc.invalidateQueries({ queryKey: ["delivery", id] }); },
    onError: (e: any) => Alert.alert("Failed", e?.message ?? "Could not submit weight"),
  });
  const submitQc = useMutation({
    mutationFn: () => api(`/api/procurement/deliveries/${id}/qc/submit`, { method: "POST", body: { moistureContent: Number(moisture), defectCount: Number(defects) } }),
    onSuccess: () => { setMoisture(""); setDefects(""); qc.invalidateQueries({ queryKey: ["delivery", id] }); },
    onError: (e: any) => Alert.alert("Failed", e?.message ?? "Could not submit QC"),
  });

  // Pay-farmer mini flow. Cash is the field default — agents rarely have
  // an MSISDN handy on a paper-trail delivery — but we let them flip to MoMo.
  const [payMethod, setPayMethod] = useState<"cash" | "mobile_money">("cash");
  const [provider, setProvider] = useState<"mtn_momo" | "airtel_money">("mtn_momo");
  const [msisdn, setMsisdn] = useState("");
  const payMut = useMutation({
    mutationFn: () => {
      if ((!d?.farmerId && !d?.supplierId) || d?.totalValue == null) throw new Error("Missing seller or amount");
      const body: Record<string, unknown> = {
        ...(d.farmerId ? { farmerId: d.farmerId } : { supplierId: d.supplierId }),
        deliveryId: d.id,
        amountDue: Number(d.totalValue),
        currency: "UGX",
        paymentMethod: payMethod,
      };
      if (payMethod === "mobile_money") { body.provider = provider; body.msisdn = msisdn.trim(); }
      return api("/api/payments", { method: "POST", body });
    },
    onSuccess: () => { setMsisdn(""); qc.invalidateQueries({ queryKey: ["delivery", id] }); Alert.alert("Payment recorded"); },
    onError: (e: any) => Alert.alert("Payment failed", e?.message ?? "Failed"),
  });

  if (isLoading || !d) {
    return <View style={{ flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: colors.background }}><ActivityIndicator color={colors.primary} /></View>;
  }

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: colors.background }}
      contentContainerStyle={[styles.container, { paddingBottom: insets.bottom + 40 }]}
    >
      <Text style={[styles.h1, { color: colors.foreground }]}>{d.lotTag}</Text>
      <View style={[styles.statusPill, { backgroundColor: colors.accent }]}>
        <Text style={{ color: colors.primary, fontSize: 12, fontWeight: "700" }}>{STATUS_LABEL[d.status] ?? d.status}</Text>
      </View>

      <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
        <Text style={[styles.cardTitle, { color: colors.foreground }]}>Summary</Text>
        {d.sellerName ? (
          <Stat label={d.sellerType === "supplier" ? "Supplier" : "Farmer"} value={d.sellerName} colors={colors} />
        ) : null}
        <Stat label="Gross" value={d.grossWeightKg != null ? `${Number(d.grossWeightKg).toLocaleString()} kg` : "—"} colors={colors} />
        <Stat label="Tare" value={d.tareWeightKg != null ? `${Number(d.tareWeightKg).toLocaleString()} kg` : "—"} colors={colors} />
        <Stat label="Net" value={d.netWeightKg != null ? `${Number(d.netWeightKg).toLocaleString()} kg` : "—"} colors={colors} bold />
        <Stat label="Price/kg" value={d.pricePerKg != null ? `UGX ${Number(d.pricePerKg).toLocaleString()}` : "—"} colors={colors} />
        <Stat label="Total" value={d.totalValue != null ? `UGX ${Number(d.totalValue).toLocaleString()}` : "—"} colors={colors} bold />
      </View>

      {d.status === "pending_weight_submit" && has("procurement.weight.submit") && (
        <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <Text style={[styles.cardTitle, { color: colors.foreground }]}>Submit weight</Text>
          <Row>
            <NumInput value={gross} onChangeText={setGross} placeholder="Gross (kg)" colors={colors} testID="m-gross" />
            <NumInput value={tare} onChangeText={setTare} placeholder="Tare (kg)" colors={colors} testID="m-tare" />
          </Row>
          <Pressable
            onPress={() => submitWeight.mutate()}
            disabled={!gross || !tare || submitWeight.isPending}
            style={({ pressed }) => [styles.btnPrimary, { backgroundColor: colors.primary, opacity: !gross || !tare || submitWeight.isPending ? 0.5 : pressed ? 0.85 : 1 }]}
            testID="m-submit-weight"
          >
            <Text style={[styles.btnPrimaryText, { color: colors.primaryForeground }]}>{submitWeight.isPending ? "Submitting…" : "Submit weight"}</Text>
          </Pressable>
        </View>
      )}

      {d.status === "pending_qc_submit" && has("procurement.qc.submit") && (
        <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <Text style={[styles.cardTitle, { color: colors.foreground }]}>Submit QC</Text>
          <Row>
            <NumInput value={moisture} onChangeText={setMoisture} placeholder="Moisture %" colors={colors} testID="m-moisture" />
            <NumInput value={defects} onChangeText={setDefects} placeholder="Defects" colors={colors} testID="m-defects" />
          </Row>
          <Pressable
            onPress={() => submitQc.mutate()}
            disabled={!moisture || !defects || submitQc.isPending}
            style={({ pressed }) => [styles.btnPrimary, { backgroundColor: colors.primary, opacity: !moisture || !defects || submitQc.isPending ? 0.5 : pressed ? 0.85 : 1 }]}
            testID="m-submit-qc"
          >
            <Text style={[styles.btnPrimaryText, { color: colors.primaryForeground }]}>{submitQc.isPending ? "Submitting…" : "Submit QC"}</Text>
          </Pressable>
        </View>
      )}

      {d.status === "approved" && d.totalValue != null && (d.farmerId || d.supplierId) && (
        <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <Text style={[styles.cardTitle, { color: colors.foreground }]}>Pay {d.sellerType === "supplier" ? "supplier" : "farmer"}</Text>
          <Text style={[styles.cardSub, { color: colors.mutedForeground }]}>Amount: UGX {Number(d.totalValue).toLocaleString()}</Text>
          <Row>
            <Chip label="Cash" active={payMethod === "cash"} disabled={!has("payments.disburse.cash")} onPress={() => setPayMethod("cash")} colors={colors} />
            <Chip label="Mobile Money" active={payMethod === "mobile_money"} disabled={!has("payments.disburse.momo")} onPress={() => setPayMethod("mobile_money")} colors={colors} />
          </Row>
          {payMethod === "mobile_money" && (
            <>
              <Row>
                <Chip label="MTN" active={provider === "mtn_momo"} onPress={() => setProvider("mtn_momo")} colors={colors} />
                <Chip label="Airtel" active={provider === "airtel_money"} onPress={() => setProvider("airtel_money")} colors={colors} />
              </Row>
              <TextInput
                value={msisdn}
                onChangeText={setMsisdn}
                placeholder="+256 7XX XXX XXX"
                placeholderTextColor={colors.mutedForeground}
                keyboardType="phone-pad"
                style={[styles.input, { color: colors.foreground, borderColor: colors.border, backgroundColor: colors.background }]}
                testID="m-pay-msisdn"
              />
            </>
          )}
          <Pressable
            onPress={() => payMut.mutate()}
            disabled={payMut.isPending || (payMethod === "mobile_money" && !msisdn.trim()) || (payMethod === "cash" && !has("payments.disburse.cash")) || (payMethod === "mobile_money" && !has("payments.disburse.momo"))}
            style={({ pressed }) => [styles.btnPrimary, { backgroundColor: colors.primary, opacity: payMut.isPending ? 0.5 : pressed ? 0.85 : 1 }]}
            testID="m-confirm-pay"
          >
            <Text style={[styles.btnPrimaryText, { color: colors.primaryForeground }]}>{payMut.isPending ? "Processing…" : "Confirm payment"}</Text>
          </Pressable>
        </View>
      )}

      <Pressable onPress={() => refetch()} hitSlop={10} style={{ alignSelf: "center", padding: 8 }}>
        <Feather name="refresh-cw" size={14} color={colors.mutedForeground} />
      </Pressable>
    </ScrollView>
  );
}

function Row({ children }: { children: React.ReactNode }) {
  return <View style={{ flexDirection: "row", gap: 10 }}>{children}</View>;
}
function NumInput({ value, onChangeText, placeholder, colors, testID }: { value: string; onChangeText: (s: string) => void; placeholder: string; colors: ReturnType<typeof useColors>; testID?: string }) {
  return (
    <TextInput
      value={value}
      onChangeText={onChangeText}
      placeholder={placeholder}
      placeholderTextColor={colors.mutedForeground}
      keyboardType="decimal-pad"
      style={[styles.input, { flex: 1, color: colors.foreground, borderColor: colors.border, backgroundColor: colors.background }]}
      testID={testID}
    />
  );
}
function Chip({ label, active, disabled, onPress, colors }: { label: string; active: boolean; disabled?: boolean; onPress: () => void; colors: ReturnType<typeof useColors> }) {
  return (
    <Pressable
      onPress={disabled ? undefined : onPress}
      disabled={disabled}
      style={({ pressed }) => [
        styles.chip,
        {
          backgroundColor: active ? colors.primary : colors.background,
          borderColor: active ? colors.primary : colors.border,
          opacity: disabled ? 0.4 : pressed ? 0.85 : 1,
        },
      ]}
    >
      <Text style={{ color: active ? colors.primaryForeground : colors.foreground, fontWeight: "600", fontSize: 13 }}>{label}</Text>
    </Pressable>
  );
}
function Stat({ label, value, colors, bold }: { label: string; value: string; colors: ReturnType<typeof useColors>; bold?: boolean }) {
  return (
    <View style={styles.statRow}>
      <Text style={{ color: colors.mutedForeground, fontSize: 13 }}>{label}</Text>
      <Text style={{ color: colors.foreground, fontSize: 13, fontWeight: bold ? "700" : "500" }}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { paddingHorizontal: 16, paddingTop: 12, gap: 10 },
  h1: { fontSize: 22, fontWeight: "700" },
  statusPill: { alignSelf: "flex-start", paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999, marginTop: 4 },
  card: { borderWidth: 1, borderRadius: 12, padding: 14, gap: 10 },
  cardTitle: { fontSize: 15, fontWeight: "700" },
  cardSub: { fontSize: 12, lineHeight: 17 },
  input: { borderWidth: 1, borderRadius: 8, paddingHorizontal: 12, paddingVertical: 10, fontSize: 14 },
  btnPrimary: { borderRadius: 10, alignItems: "center", justifyContent: "center", paddingVertical: 12 },
  btnPrimaryText: { fontWeight: "600" },
  chip: { borderWidth: 1, borderRadius: 999, paddingHorizontal: 14, paddingVertical: 8 },
  statRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
});
