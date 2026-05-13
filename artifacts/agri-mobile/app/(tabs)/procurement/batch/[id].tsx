import { Feather } from "@expo/vector-icons";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useState } from "react";
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useApi } from "@/lib/api";
import { useColors } from "@/hooks/useColors";

// BATCH DETAIL — delivery-first model.
//
// The batch is a grouping of per-farmer deliveries. While it's open the agent
// can remove deliveries (they return to status='captured' and reappear on the
// landing page). Locking freezes membership; station handover then proceeds
// per-delivery via the existing weight/QC/pricing workflow.

type BatchDelivery = {
  id: string;
  deliveryNumber: string;
  farmerId: string;
  cropType: string;
  capturedWeightKg: number;
  status: string;
};
type Batch = {
  id: string;
  batchTag: string;
  status: "open" | "locked" | "delivered";
  totalWeightKg: number;
  farmerCount: number;
  cropType: string | null;
  deliveries: BatchDelivery[];
};
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

  const removeMut = useMutation({
    mutationFn: (deliveryId: string) =>
      api(`/api/batches/${id}/deliveries/${deliveryId}`, { method: "DELETE" }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["batch", id] });
      qc.invalidateQueries({ queryKey: ["captured-deliveries"] });
    },
    onError: (e: any) => Alert.alert("Could not remove delivery", e?.message ?? "Failed"),
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
  // After locking, the per-delivery weight/QC/pricing workflow takes over.
  // Station selection is informational at this point; we just route the agent
  // to the first delivery for the existing handover flow.
  const goToFirstDelivery = () => {
    const first = batch?.deliveries?.[0];
    if (first) router.push(`/procurement/delivery/${first.id}`);
  };

  if (isLoading || !batch) {
    return <View style={{ flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: colors.background }}><ActivityIndicator color={colors.primary} /></View>;
  }

  const isOpen = batch.status === "open";
  const isLocked = batch.status === "locked";
  const deliveries = batch.deliveries ?? [];

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: colors.background }}
      contentContainerStyle={[styles.container, { paddingBottom: insets.bottom + 40 }]}
    >
      <Text style={[styles.h1, { color: colors.foreground }]}>{batch.batchTag}</Text>
      <Text style={[styles.sub, { color: colors.mutedForeground }]}>
        {batch.cropType ?? "—"} · {batch.farmerCount} farmer{batch.farmerCount === 1 ? "" : "s"} · {Number(batch.totalWeightKg ?? 0).toLocaleString()} kg · {batch.status.toUpperCase()}
      </Text>

      <Text style={[styles.sectionLabel, { color: colors.mutedForeground }]}>Deliveries · {deliveries.length}</Text>
      {deliveries.length === 0 ? (
        <Text style={[styles.empty, { color: colors.mutedForeground }]}>This batch has no deliveries.</Text>
      ) : deliveries.map(d => (
        <View key={d.id} style={[styles.row, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <Pressable onPress={() => router.push(`/procurement/delivery/${d.id}`)} style={{ flex: 1 }} testID={`open-delivery-${d.id}`}>
            <Text style={{ color: colors.foreground, fontWeight: "600" }} numberOfLines={1}>{d.deliveryNumber}</Text>
            <Text style={{ color: colors.mutedForeground, fontSize: 12 }}>
              {Number(d.capturedWeightKg).toLocaleString()} kg · farmer {d.farmerId.slice(0, 8)} · {d.status}
            </Text>
          </Pressable>
          {isOpen && (
            <Pressable
              onPress={() => Alert.alert("Remove delivery?", "It will return to your captured list.", [
                { text: "Cancel", style: "cancel" },
                { text: "Remove", style: "destructive", onPress: () => removeMut.mutate(d.id) },
              ])}
              hitSlop={10}
              testID={`remove-delivery-${d.id}`}
            >
              <Feather name="trash-2" size={16} color={colors.destructive} />
            </Pressable>
          )}
        </View>
      ))}

      {isOpen && deliveries.length > 0 && (
        <Pressable
          onPress={() => Alert.alert("Lock batch?", "After locking you cannot add or remove deliveries.", [
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
          <Text style={[styles.cardTitle, { color: colors.foreground }]}>Hand off at the station</Text>
          <Text style={[styles.cardSub, { color: colors.mutedForeground }]}>
            Pick a buying station for reference, then open any delivery to record gross/tare weight.
          </Text>
          {(stations ?? []).map(s => (
            <Pressable
              key={s.id}
              onPress={() => setStationId(s.id)}
              style={({ pressed }) => [
                styles.hitRow,
                {
                  borderColor: stationId === s.id ? colors.primary : colors.border,
                  borderWidth: stationId === s.id ? 2 : 1,
                  opacity: pressed ? 0.85 : 1,
                },
              ]}
              testID={`station-${s.id}`}
            >
              <Text style={{ color: colors.foreground, fontWeight: "500" }}>{s.name}</Text>
              {s.location ? <Text style={{ color: colors.mutedForeground, fontSize: 12 }}>{s.location}</Text> : null}
            </Pressable>
          ))}
          <Pressable
            onPress={goToFirstDelivery}
            disabled={deliveries.length === 0}
            style={({ pressed }) => [styles.btnPrimary, { backgroundColor: colors.primary, opacity: deliveries.length === 0 ? 0.5 : pressed ? 0.85 : 1 }]}
            testID="open-first-delivery-btn"
          >
            <Text style={[styles.btnPrimaryText, { color: colors.primaryForeground }]}>Open first delivery</Text>
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
  hitRow: { borderWidth: 1, borderRadius: 8, padding: 10, gap: 2 },
  btnPrimary: { borderRadius: 10, alignItems: "center", justifyContent: "center", paddingVertical: 12 },
  btnPrimaryText: { fontWeight: "600" },
  btnSecondary: { borderWidth: 1, borderRadius: 10, alignItems: "center", justifyContent: "center", paddingVertical: 12, flexDirection: "row", gap: 8 },
  btnSecondaryText: { fontWeight: "600" },
  sectionLabel: { fontSize: 11, fontWeight: "700", textTransform: "uppercase", letterSpacing: 0.6, marginTop: 14, marginBottom: 2 },
  row: { flexDirection: "row", alignItems: "center", gap: 12, borderWidth: 1, borderRadius: 12, padding: 12 },
  empty: { fontSize: 12, paddingVertical: 8, fontStyle: "italic" },
});
