import { Feather } from "@expo/vector-icons";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "expo-router";
import { useMemo, useState } from "react";
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useApi } from "@/lib/api";
import { useColors } from "@/hooks/useColors";
import { useMe } from "@/hooks/useMe";

// BATCH GROUPING screen.
//
// The agent picks a crop, then multi-selects from the captured (unbatched)
// deliveries that share that crop, and submits. The server validates same-crop
// invariance + atomic ownership transition; only deliveries still in
// status='captured' AND batch_id IS NULL succeed.

type Delivery = {
  id: string;
  deliveryNumber: string;
  farmerId: string;
  cropType: string;
  capturedWeightKg: number;
  status: string;
};

export default function NewBatchScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const api = useApi();
  const qc = useQueryClient();
  const { me } = useMe();

  const { data: captured, isLoading } = useQuery<Delivery[]>({
    queryKey: ["captured-deliveries", me?.id],
    enabled: !!me?.id,
    queryFn: () => api<Delivery[]>(`/api/procurement/deliveries?unbatched=true&agentId=${me!.id}`),
  });

  // Crop choices come from the captured set itself — no point offering a crop
  // the agent has zero deliveries for.
  const crops = useMemo(() => Array.from(new Set((captured ?? []).map(d => d.cropType))).sort(), [captured]);
  const [crop, setCrop] = useState<string | null>(null);
  const eligible = useMemo(() => (captured ?? []).filter(d => d.cropType === crop), [captured, crop]);
  const [picked, setPicked] = useState<Set<string>>(new Set());

  const togglePick = (id: string) => {
    setPicked(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const submit = useMutation({
    mutationFn: () => api<{ id: string; batchTag: string }>("/api/batches/from-deliveries", {
      method: "POST",
      body: { deliveryIds: Array.from(picked) },
    }),
    onSuccess: (b) => {
      qc.invalidateQueries({ queryKey: ["captured-deliveries"] });
      qc.invalidateQueries({ queryKey: ["procurement-batches"] });
      router.replace(`/procurement/batch/${b.id}`);
    },
    onError: (e: any) => Alert.alert("Could not create batch", e?.message ?? "Failed"),
  });

  const totalKg = eligible.filter(d => picked.has(d.id)).reduce((s, d) => s + Number(d.capturedWeightKg ?? 0), 0);
  const canSubmit = !!crop && picked.size > 0 && !submit.isPending;

  if (isLoading) {
    return <View style={{ flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: colors.background }}><ActivityIndicator color={colors.primary} /></View>;
  }

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: colors.background }}
      contentContainerStyle={[styles.container, { paddingBottom: insets.bottom + 40 }]}
    >
      <Text style={[styles.h1, { color: colors.foreground }]}>Group deliveries into a batch</Text>
      <Text style={[styles.sub, { color: colors.mutedForeground }]}>
        Pick a crop, then select the captured deliveries to include. Only same-crop deliveries can share a batch.
      </Text>

      {crops.length === 0 ? (
        <Text style={[styles.empty, { color: colors.mutedForeground }]}>You have no captured deliveries yet.</Text>
      ) : (
        <>
          <Text style={[styles.sectionLabel, { color: colors.mutedForeground }]}>Crop</Text>
          <View style={styles.chipRow}>
            {crops.map(c => {
              const active = c === crop;
              return (
                <Pressable
                  key={c}
                  onPress={() => { setCrop(c); setPicked(new Set()); }}
                  style={({ pressed }) => [
                    styles.chip,
                    {
                      backgroundColor: active ? colors.primary : colors.card,
                      borderColor: active ? colors.primary : colors.border,
                      opacity: pressed ? 0.85 : 1,
                    },
                  ]}
                  testID={`crop-chip-${c}`}
                >
                  <Text style={{ color: active ? colors.primaryForeground : colors.foreground, fontWeight: "600", fontSize: 12 }}>{c}</Text>
                </Pressable>
              );
            })}
          </View>

          {crop && (
            <>
              <Text style={[styles.sectionLabel, { color: colors.mutedForeground }]}>Captured · {crop} · {eligible.length}</Text>
              {eligible.map(d => {
                const sel = picked.has(d.id);
                return (
                  <Pressable
                    key={d.id}
                    onPress={() => togglePick(d.id)}
                    style={({ pressed }) => [
                      styles.row,
                      {
                        backgroundColor: colors.card,
                        borderColor: sel ? colors.primary : colors.border,
                        borderWidth: sel ? 2 : 1,
                        opacity: pressed ? 0.85 : 1,
                      },
                    ]}
                    testID={`pick-delivery-${d.id}`}
                  >
                    <View style={[styles.checkbox, { borderColor: sel ? colors.primary : colors.border, backgroundColor: sel ? colors.primary : "transparent" }]}>
                      {sel && <Feather name="check" size={12} color={colors.primaryForeground} />}
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={{ color: colors.foreground, fontWeight: "600", fontSize: 14 }} numberOfLines={1}>{d.deliveryNumber}</Text>
                      <Text style={{ color: colors.mutedForeground, fontSize: 12 }}>{Number(d.capturedWeightKg ?? 0).toLocaleString()} kg · farmer {d.farmerId.slice(0, 8)}</Text>
                    </View>
                  </Pressable>
                );
              })}

              <View style={[styles.summary, { borderColor: colors.border }]}>
                <Text style={{ color: colors.mutedForeground, fontSize: 12 }}>Selected</Text>
                <Text style={{ color: colors.foreground, fontWeight: "700" }}>
                  {picked.size} delivery{picked.size === 1 ? "" : "s"} · {totalKg.toLocaleString()} kg
                </Text>
              </View>

              <Pressable
                onPress={() => submit.mutate()}
                disabled={!canSubmit}
                style={({ pressed }) => [styles.btnPrimary, { backgroundColor: colors.primary, opacity: !canSubmit ? 0.5 : pressed ? 0.85 : 1 }]}
                testID="create-batch-btn"
              >
                <Text style={[styles.btnPrimaryText, { color: colors.primaryForeground }]}>{submit.isPending ? "Creating…" : "Create batch"}</Text>
              </Pressable>
            </>
          )}
        </>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { paddingHorizontal: 16, paddingTop: 12, gap: 8 },
  h1: { fontSize: 22, fontWeight: "700" },
  sub: { fontSize: 12, marginTop: 2, marginBottom: 4 },
  sectionLabel: { fontSize: 11, fontWeight: "700", textTransform: "uppercase", letterSpacing: 0.6, marginTop: 12, marginBottom: 4 },
  chipRow: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  chip: { paddingHorizontal: 12, paddingVertical: 7, borderRadius: 16, borderWidth: 1 },
  row: { flexDirection: "row", alignItems: "center", gap: 12, borderRadius: 12, padding: 12 },
  checkbox: { width: 20, height: 20, borderRadius: 4, borderWidth: 2, alignItems: "center", justifyContent: "center" },
  summary: { borderTopWidth: 1, paddingTop: 12, marginTop: 12, flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  btnPrimary: { borderRadius: 10, alignItems: "center", justifyContent: "center", paddingVertical: 14, marginTop: 8 },
  btnPrimaryText: { fontWeight: "600", fontSize: 14 },
  empty: { fontSize: 13, paddingVertical: 16, fontStyle: "italic", textAlign: "center" },
});
