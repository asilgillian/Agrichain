import { Feather } from "@expo/vector-icons";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "expo-router";
import { useMemo, useState } from "react";
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useApi } from "@/lib/api";
import { useColors } from "@/hooks/useColors";

// Per-farmer DELIVERY CAPTURE screen.
//
// The agent picks a farmer, picks a crop from the master commodity catalog,
// enters the captured weight, and submits. The server assigns the delivery
// number and creates the row with status='captured' (unbatched).
//
// Crop is currently sourced from the FULL /commodities catalog. Per the spec
// we'll switch to a curated subset later; the dropdown shape stays the same.

type Farmer = { id: string; firstName: string; lastName: string; nationalId?: string | null };
type Commodity = { id: string; name: string; code: string; status?: string };

export default function CaptureDeliveryScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const api = useApi();
  const qc = useQueryClient();

  // --- Farmer search ---------------------------------------------------
  const [search, setSearch] = useState("");
  const { data: farmerHits } = useQuery<Farmer[]>({
    queryKey: ["farmers-search", search],
    enabled: search.trim().length >= 2,
    queryFn: () => api<Farmer[]>(`/api/farmers?search=${encodeURIComponent(search.trim())}&limit=10`),
  });

  // --- Crop dropdown (master commodity catalog) ------------------------
  const { data: commodities } = useQuery<Commodity[]>({
    queryKey: ["commodities-active"],
    queryFn: () => api<Commodity[]>("/api/commodities?status=active"),
  });
  const cropOptions = useMemo(() => (commodities ?? []).map(c => c.name), [commodities]);

  const [farmer, setFarmer] = useState<Farmer | null>(null);
  const [crop, setCrop] = useState<string>("");
  const [kg, setKg] = useState("");
  const [cropOpen, setCropOpen] = useState(false);

  const submit = useMutation({
    mutationFn: () => api<{ id: string; deliveryNumber: string }>("/api/procurement/deliveries", {
      method: "POST",
      body: { farmerId: farmer!.id, cropType: crop, weightKg: Number(kg) },
    }),
    onSuccess: (d) => {
      qc.invalidateQueries({ queryKey: ["captured-deliveries"] });
      Alert.alert("Delivery captured", `${d.deliveryNumber} recorded.`);
      router.replace("/procurement");
    },
    onError: (e: any) => Alert.alert("Could not capture delivery", e?.message ?? "Failed"),
  });

  const w = Number(kg);
  const canSubmit = !!farmer && !!crop && Number.isFinite(w) && w > 0 && !submit.isPending;

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: colors.background }}
      contentContainerStyle={[styles.container, { paddingBottom: insets.bottom + 40 }]}
      keyboardShouldPersistTaps="handled"
    >
      <Text style={[styles.h1, { color: colors.foreground }]}>New delivery</Text>
      <Text style={[styles.sub, { color: colors.mutedForeground }]}>
        Capture a single farmer's drop-off. The delivery number is generated automatically.
      </Text>

      {/* FARMER */}
      <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
        <Text style={[styles.label, { color: colors.foreground }]}>Farmer</Text>
        {farmer ? (
          <View style={[styles.pickedRow, { backgroundColor: colors.accent }]}>
            <Feather name="user" size={16} color={colors.primary} />
            <Text style={[styles.pickedName, { color: colors.foreground }]} numberOfLines={1}>{farmer.firstName} {farmer.lastName}</Text>
            <Pressable onPress={() => setFarmer(null)} hitSlop={10} testID="clear-farmer">
              <Feather name="x" size={16} color={colors.mutedForeground} />
            </Pressable>
          </View>
        ) : (
          <>
            <TextInput
              value={search}
              onChangeText={setSearch}
              placeholder="Search by name or national ID"
              placeholderTextColor={colors.mutedForeground}
              style={[styles.input, { color: colors.foreground, borderColor: colors.border, backgroundColor: colors.background }]}
              autoCapitalize="none"
              testID="farmer-search"
            />
            {(farmerHits ?? []).slice(0, 6).map(f => (
              <Pressable
                key={f.id}
                onPress={() => { setFarmer(f); setSearch(""); }}
                style={({ pressed }) => [styles.hitRow, { borderColor: colors.border, opacity: pressed ? 0.7 : 1 }]}
                testID={`farmer-hit-${f.id}`}
              >
                <Text style={{ color: colors.foreground, fontWeight: "500" }}>{f.firstName} {f.lastName}</Text>
                {f.nationalId ? <Text style={{ color: colors.mutedForeground, fontSize: 12 }}>NID {f.nationalId}</Text> : null}
              </Pressable>
            ))}
          </>
        )}
      </View>

      {/* CROP */}
      <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
        <Text style={[styles.label, { color: colors.foreground }]}>Crop</Text>
        <Pressable
          onPress={() => setCropOpen(o => !o)}
          style={({ pressed }) => [styles.input, styles.dropdownToggle, { borderColor: colors.border, backgroundColor: colors.background, opacity: pressed ? 0.85 : 1 }]}
          testID="crop-dropdown-toggle"
        >
          <Text style={{ color: crop ? colors.foreground : colors.mutedForeground, flex: 1 }}>
            {crop || "Select a crop"}
          </Text>
          <Feather name={cropOpen ? "chevron-up" : "chevron-down"} size={16} color={colors.mutedForeground} />
        </Pressable>
        {cropOpen && (
          <View style={[styles.dropdownList, { borderColor: colors.border, backgroundColor: colors.background }]}>
            {cropOptions.length === 0 ? (
              <View style={{ padding: 10, alignItems: "center" }}><ActivityIndicator color={colors.primary} /></View>
            ) : cropOptions.map(name => (
              <Pressable
                key={name}
                onPress={() => { setCrop(name); setCropOpen(false); }}
                style={({ pressed }) => [styles.dropdownItem, { backgroundColor: pressed ? colors.accent : "transparent" }]}
                testID={`crop-option-${name}`}
              >
                <Text style={{ color: colors.foreground }}>{name}</Text>
              </Pressable>
            ))}
          </View>
        )}
      </View>

      {/* WEIGHT */}
      <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
        <Text style={[styles.label, { color: colors.foreground }]}>Weight (kg)</Text>
        <TextInput
          value={kg}
          onChangeText={setKg}
          placeholder="e.g. 38.5"
          placeholderTextColor={colors.mutedForeground}
          keyboardType="decimal-pad"
          style={[styles.input, { color: colors.foreground, borderColor: colors.border, backgroundColor: colors.background }]}
          testID="weight-input"
        />
      </View>

      <Pressable
        onPress={() => submit.mutate()}
        disabled={!canSubmit}
        style={({ pressed }) => [styles.btnPrimary, { backgroundColor: colors.primary, opacity: !canSubmit ? 0.5 : pressed ? 0.85 : 1 }]}
        testID="submit-delivery"
      >
        <Text style={[styles.btnPrimaryText, { color: colors.primaryForeground }]}>{submit.isPending ? "Capturing…" : "Capture delivery"}</Text>
      </Pressable>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { paddingHorizontal: 16, paddingTop: 12, gap: 12 },
  h1: { fontSize: 22, fontWeight: "700" },
  sub: { fontSize: 12, marginTop: 2, marginBottom: 4 },
  card: { borderWidth: 1, borderRadius: 12, padding: 14, gap: 10 },
  label: { fontSize: 13, fontWeight: "600" },
  input: { borderWidth: 1, borderRadius: 8, paddingHorizontal: 12, paddingVertical: 10, fontSize: 14 },
  dropdownToggle: { flexDirection: "row", alignItems: "center" },
  dropdownList: { borderWidth: 1, borderRadius: 8, maxHeight: 240 },
  dropdownItem: { paddingHorizontal: 12, paddingVertical: 10 },
  pickedRow: { flexDirection: "row", alignItems: "center", gap: 8, padding: 10, borderRadius: 8 },
  pickedName: { flex: 1, fontWeight: "500" },
  hitRow: { borderWidth: 1, borderRadius: 8, padding: 10, gap: 2 },
  btnPrimary: { borderRadius: 10, alignItems: "center", justifyContent: "center", paddingVertical: 14, marginTop: 8 },
  btnPrimaryText: { fontWeight: "600", fontSize: 14 },
});
