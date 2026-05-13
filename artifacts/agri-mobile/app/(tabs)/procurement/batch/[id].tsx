import { Feather } from "@expo/vector-icons";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useMemo, useState } from "react";
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useApi } from "@/lib/api";
import { useColors } from "@/hooks/useColors";

type Contribution = { farmerId: string; farmerName?: string; weightKg: number };
type Batch = {
  id: string;
  batchTag: string;
  status: "open" | "locked" | "delivered";
  totalWeightKg: number;
  farmerCount: number;
  commodityType: string | null;
  farmerContributions: Contribution[];
};
type Farmer = { id: string; firstName: string; lastName: string; nationalId?: string | null };
type Station = { id: string; name: string; location?: string | null };

export default function BatchDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const api = useApi();
  const qc = useQueryClient();

  const { data: batch, isLoading, refetch } = useQuery<Batch>({
    queryKey: ["batch", id],
    enabled: !!id,
    queryFn: () => api<Batch>(`/api/batches/${id}`),
  });

  // Farmer search — debounced via the input's local state. Only kicks in once
  // the agent has typed 2+ characters so we don't dump the whole farmer table.
  const [search, setSearch] = useState("");
  const { data: farmerHits } = useQuery<Farmer[]>({
    queryKey: ["farmers-search", search],
    enabled: search.trim().length >= 2,
    queryFn: () => api<Farmer[]>(`/api/farmers?search=${encodeURIComponent(search.trim())}&limit=10`),
  });

  const [picked, setPicked] = useState<Farmer | null>(null);
  const [kg, setKg] = useState("");

  // Contribution updates go via PATCH /api/batches/:id (existing convention is
  // to send the full new contributions array; the server recomputes totals).
  const addMut = useMutation({
    mutationFn: async (next: Contribution[]) => {
      const totalWeight = next.reduce((s, c) => s + Number(c.weightKg || 0), 0);
      return api<Batch>(`/api/batches/${id}`, {
        method: "PATCH",
        body: { farmerContributions: next, farmerCount: new Set(next.map(c => c.farmerId)).size, totalWeightKg: totalWeight },
      });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["batch", id] });
      setPicked(null); setKg(""); setSearch("");
    },
    onError: (e: any) => Alert.alert("Could not add contribution", e?.message ?? "Failed"),
  });

  const lockMut = useMutation({
    mutationFn: () => api(`/api/batches/${id}/lock`, { method: "POST" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["batch", id] }),
    onError: (e: any) => Alert.alert("Could not lock batch", e?.message ?? "Failed"),
  });

  const { data: stations } = useQuery<Station[]>({
    queryKey: ["buying-stations"],
    queryFn: () => api<Station[]>(`/api/buying-stations`),
  });

  const [stationId, setStationId] = useState<string | null>(null);
  const deliverMut = useMutation({
    // Server expects batchTag + stationId, not batchId — see CreateDeliveryBody.
    mutationFn: () => api<{ id: string }>("/api/procurement/deliveries", { method: "POST", body: { batchTag: batch!.batchTag, stationId } }),
    onSuccess: (d) => {
      qc.invalidateQueries({ queryKey: ["batch", id] });
      router.replace(`/procurement/delivery/${d.id}`);
    },
    onError: (e: any) => Alert.alert("Could not create delivery", e?.message ?? "Failed"),
  });

  const contributions = useMemo(() => batch?.farmerContributions ?? [], [batch?.farmerContributions]);

  if (isLoading || !batch) {
    return <View style={{ flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: colors.background }}><ActivityIndicator color={colors.primary} /></View>;
  }

  const isOpen = batch.status === "open";
  const isLocked = batch.status === "locked";

  function add() {
    if (!picked || !kg.trim()) return;
    const w = Number(kg);
    if (!Number.isFinite(w) || w <= 0) { Alert.alert("Weight must be > 0"); return; }
    const existing = contributions.filter(c => c.farmerId !== picked.id);
    addMut.mutate([...existing, { farmerId: picked.id, farmerName: `${picked.firstName} ${picked.lastName}`, weightKg: w }]);
  }
  function remove(farmerId: string) {
    addMut.mutate(contributions.filter(c => c.farmerId !== farmerId));
  }

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: colors.background }}
      contentContainerStyle={[styles.container, { paddingBottom: insets.bottom + 40 }]}
    >
      <Text style={[styles.h1, { color: colors.foreground }]}>{batch.batchTag}</Text>
      <Text style={[styles.sub, { color: colors.mutedForeground }]}>
        {batch.commodityType ?? "—"} · {batch.farmerCount} farmer{batch.farmerCount === 1 ? "" : "s"} · {Number(batch.totalWeightKg ?? 0).toLocaleString()} kg · {batch.status.toUpperCase()}
      </Text>

      {isOpen && (
        <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <Text style={[styles.cardTitle, { color: colors.foreground }]}>Add contribution</Text>
          {picked ? (
            <View style={[styles.pickedRow, { backgroundColor: colors.accent }]}>
              <Feather name="user" size={16} color={colors.primary} />
              <Text style={[styles.pickedName, { color: colors.foreground }]} numberOfLines={1}>{picked.firstName} {picked.lastName}</Text>
              <Pressable onPress={() => setPicked(null)} hitSlop={10} testID="clear-picked-farmer">
                <Feather name="x" size={16} color={colors.mutedForeground} />
              </Pressable>
            </View>
          ) : (
            <>
              <TextInput
                value={search}
                onChangeText={setSearch}
                placeholder="Search farmer by name or national ID"
                placeholderTextColor={colors.mutedForeground}
                style={[styles.input, { color: colors.foreground, borderColor: colors.border, backgroundColor: colors.background }]}
                autoCapitalize="none"
                testID="farmer-search"
              />
              {(farmerHits ?? []).slice(0, 6).map(f => (
                <Pressable
                  key={f.id}
                  onPress={() => setPicked(f)}
                  style={({ pressed }) => [styles.hitRow, { borderColor: colors.border, opacity: pressed ? 0.7 : 1 }]}
                  testID={`farmer-hit-${f.id}`}
                >
                  <Text style={{ color: colors.foreground, fontWeight: "500" }}>{f.firstName} {f.lastName}</Text>
                  {f.nationalId ? <Text style={{ color: colors.mutedForeground, fontSize: 12 }}>NID {f.nationalId}</Text> : null}
                </Pressable>
              ))}
            </>
          )}
          <TextInput
            value={kg}
            onChangeText={setKg}
            placeholder="Weight (kg)"
            placeholderTextColor={colors.mutedForeground}
            keyboardType="decimal-pad"
            style={[styles.input, { color: colors.foreground, borderColor: colors.border, backgroundColor: colors.background }]}
            testID="contribution-kg"
          />
          <Pressable
            onPress={add}
            disabled={!picked || !kg.trim() || addMut.isPending}
            style={({ pressed }) => [styles.btnPrimary, { backgroundColor: colors.primary, opacity: !picked || !kg.trim() || addMut.isPending ? 0.5 : pressed ? 0.85 : 1 }]}
            testID="add-contribution-btn"
          >
            <Text style={[styles.btnPrimaryText, { color: colors.primaryForeground }]}>{addMut.isPending ? "Adding…" : "Add to batch"}</Text>
          </Pressable>
        </View>
      )}

      <Text style={[styles.sectionLabel, { color: colors.mutedForeground }]}>Contributions · {contributions.length}</Text>
      {contributions.length === 0 ? (
        <Text style={[styles.empty, { color: colors.mutedForeground }]}>No farmer contributions yet.</Text>
      ) : contributions.map(c => (
        <View key={c.farmerId} style={[styles.row, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <View style={{ flex: 1 }}>
            <Text style={{ color: colors.foreground, fontWeight: "500" }} numberOfLines={1}>{c.farmerName ?? c.farmerId.slice(0, 8)}</Text>
            <Text style={{ color: colors.mutedForeground, fontSize: 12 }}>{Number(c.weightKg).toLocaleString()} kg</Text>
          </View>
          {isOpen && (
            <Pressable onPress={() => remove(c.farmerId)} hitSlop={10} testID={`remove-contrib-${c.farmerId}`}>
              <Feather name="trash-2" size={16} color={colors.destructive} />
            </Pressable>
          )}
        </View>
      ))}

      {isOpen && contributions.length > 0 && (
        <Pressable
          onPress={() => Alert.alert("Lock batch?", "After locking you cannot edit contributions.", [
            { text: "Cancel", style: "cancel" },
            { text: "Lock", style: "destructive", onPress: () => lockMut.mutate() },
          ])}
          disabled={lockMut.isPending}
          style={({ pressed }) => [styles.btnSecondary, { borderColor: colors.border, opacity: lockMut.isPending ? 0.5 : pressed ? 0.85 : 1 }]}
          testID="lock-batch-btn"
        >
          <Feather name="lock" size={16} color={colors.foreground} />
          <Text style={[styles.btnSecondaryText, { color: colors.foreground }]}>{lockMut.isPending ? "Locking…" : "Lock batch"}</Text>
        </Pressable>
      )}

      {isLocked && (
        <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <Text style={[styles.cardTitle, { color: colors.foreground }]}>Hand off to buying station</Text>
          <Text style={[styles.cardSub, { color: colors.mutedForeground }]}>Choose where this batch is being delivered. We'll create the delivery record and take you to it.</Text>
          {(stations ?? []).map(s => (
            <Pressable
              key={s.id}
              onPress={() => setStationId(s.id)}
              style={({ pressed }) => [styles.hitRow, { borderColor: stationId === s.id ? colors.primary : colors.border, borderWidth: stationId === s.id ? 2 : 1, opacity: pressed ? 0.85 : 1 }]}
              testID={`station-${s.id}`}
            >
              <Text style={{ color: colors.foreground, fontWeight: "500" }}>{s.name}</Text>
              {s.location ? <Text style={{ color: colors.mutedForeground, fontSize: 12 }}>{s.location}</Text> : null}
            </Pressable>
          ))}
          <Pressable
            onPress={() => deliverMut.mutate()}
            disabled={!stationId || deliverMut.isPending}
            style={({ pressed }) => [styles.btnPrimary, { backgroundColor: colors.primary, opacity: !stationId || deliverMut.isPending ? 0.5 : pressed ? 0.85 : 1 }]}
            testID="create-delivery-btn"
          >
            <Text style={[styles.btnPrimaryText, { color: colors.primaryForeground }]}>{deliverMut.isPending ? "Sending…" : "Send to station"}</Text>
          </Pressable>
        </View>
      )}

      <View style={{ height: 8 }} />
      <Pressable onPress={() => refetch()} hitSlop={10} style={{ alignSelf: "center", padding: 8 }}>
        <Text style={{ color: colors.mutedForeground, fontSize: 12 }}>Refresh</Text>
      </Pressable>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { paddingHorizontal: 16, paddingTop: 12, gap: 10 },
  h1: { fontSize: 22, fontWeight: "700" },
  sub: { fontSize: 12, marginTop: 2, marginBottom: 8 },
  card: { borderWidth: 1, borderRadius: 12, padding: 14, gap: 10 },
  cardTitle: { fontSize: 15, fontWeight: "700" },
  cardSub: { fontSize: 12, lineHeight: 17 },
  input: { borderWidth: 1, borderRadius: 8, paddingHorizontal: 12, paddingVertical: 10, fontSize: 14 },
  pickedRow: { flexDirection: "row", alignItems: "center", gap: 8, padding: 10, borderRadius: 8 },
  pickedName: { flex: 1, fontWeight: "500" },
  hitRow: { borderWidth: 1, borderRadius: 8, padding: 10, gap: 2 },
  btnPrimary: { borderRadius: 10, alignItems: "center", justifyContent: "center", paddingVertical: 12 },
  btnPrimaryText: { fontWeight: "600" },
  btnSecondary: { borderWidth: 1, borderRadius: 10, alignItems: "center", justifyContent: "center", paddingVertical: 12, flexDirection: "row", gap: 8 },
  btnSecondaryText: { fontWeight: "600" },
  sectionLabel: { fontSize: 11, fontWeight: "700", textTransform: "uppercase", letterSpacing: 0.6, marginTop: 14, marginBottom: 2 },
  row: { flexDirection: "row", alignItems: "center", gap: 12, borderWidth: 1, borderRadius: 12, padding: 12 },
  empty: { fontSize: 12, paddingVertical: 8, fontStyle: "italic" },
});
