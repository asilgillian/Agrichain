import { Feather } from "@expo/vector-icons";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "expo-router";
import { useState } from "react";
import { ActivityIndicator, Alert, Pressable, RefreshControl, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useApi } from "@/lib/api";
import { useColors } from "@/hooks/useColors";
import { useMe } from "@/hooks/useMe";

type Batch = {
  id: string;
  batchTag: string;
  status: "open" | "locked" | "delivered";
  totalWeightKg: number;
  farmerCount: number;
  commodityType: string | null;
  createdAt: string;
};

// Field agents see only their own open + locked batches. Delivered batches drop
// off this screen because the next action lives on the delivery, not the batch.
export default function ProcurementHomeScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const api = useApi();
  const qc = useQueryClient();
  const { me } = useMe();

  const { data, isLoading, refetch, isRefetching } = useQuery<Batch[]>({
    queryKey: ["procurement-batches", me?.id],
    enabled: !!me?.id,
    queryFn: () => api<Batch[]>(`/api/batches?agentId=${me!.id}`),
  });

  const open = (data ?? []).filter(b => b.status === "open");
  const locked = (data ?? []).filter(b => b.status === "locked");

  const [creating, setCreating] = useState(false);
  const [commodity, setCommodity] = useState("");

  const createMut = useMutation({
    mutationFn: (commodityType: string) =>
      // Server's CreateBatchBody requires { cropType, harvestDate }. The
      // optional fields (farmerContributions, qualifyingStreams, commodityType)
      // are read off req.body directly. We default harvest date to today; the
      // agent can revisit later from the back office.
      api<Batch>("/api/batches", {
        method: "POST",
        body: {
          cropType: commodityType,
          harvestDate: new Date().toISOString().slice(0, 10),
          commodityType,
          farmerCount: 0,
          farmerContributions: [],
          qualifyingStreams: [],
        },
      }),
    onSuccess: (b) => {
      qc.invalidateQueries({ queryKey: ["procurement-batches", me?.id] });
      setCreating(false);
      setCommodity("");
      router.push(`/procurement/batch/${b.id}`);
    },
    onError: (e: any) => Alert.alert("Could not create batch", e?.message ?? "Failed"),
  });

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: colors.background }}
      contentContainerStyle={[styles.container, { paddingTop: 8, paddingBottom: insets.bottom + 80 }]}
      refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={refetch} tintColor={colors.primary} />}
    >
      <View style={styles.headerRow}>
        <Text style={[styles.h1, { color: colors.foreground }]}>My batches</Text>
        <Pressable
          onPress={() => setCreating(v => !v)}
          style={({ pressed }) => [styles.fab, { backgroundColor: colors.primary, opacity: pressed ? 0.8 : 1 }]}
          testID="new-batch-fab"
        >
          <Feather name={creating ? "x" : "plus"} size={20} color={colors.primaryForeground} />
        </Pressable>
      </View>

      {creating && (
        <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <Text style={[styles.cardTitle, { color: colors.foreground }]}>New batch</Text>
          <Text style={[styles.cardSub, { color: colors.mutedForeground }]}>Pick the commodity. You can add farmer contributions on the next screen.</Text>
          <TextInput
            value={commodity}
            onChangeText={setCommodity}
            placeholder="e.g. coffee, maize"
            placeholderTextColor={colors.mutedForeground}
            style={[styles.input, { color: colors.foreground, borderColor: colors.border, backgroundColor: colors.background }]}
            autoCapitalize="none"
            testID="new-batch-commodity"
          />
          <Pressable
            onPress={() => commodity.trim() && createMut.mutate(commodity.trim())}
            disabled={!commodity.trim() || createMut.isPending}
            style={({ pressed }) => [styles.btnPrimary, { backgroundColor: colors.primary, opacity: !commodity.trim() || createMut.isPending ? 0.5 : pressed ? 0.85 : 1 }]}
            testID="new-batch-submit"
          >
            <Text style={[styles.btnPrimaryText, { color: colors.primaryForeground }]}>{createMut.isPending ? "Creating…" : "Create batch"}</Text>
          </Pressable>
        </View>
      )}

      {isLoading ? (
        <View style={{ paddingVertical: 40, alignItems: "center" }}><ActivityIndicator color={colors.primary} /></View>
      ) : (
        <>
          <SectionHeader label={`Open · ${open.length}`} colors={colors} />
          {open.length === 0 ? (
            <EmptyHint text="No open batches. Tap + to start one." colors={colors} />
          ) : open.map(b => <BatchRow key={b.id} batch={b} onPress={() => router.push(`/procurement/batch/${b.id}`)} colors={colors} />)}

          <SectionHeader label={`Locked — awaiting handover · ${locked.length}`} colors={colors} />
          {locked.length === 0 ? (
            <EmptyHint text="Nothing pending handover." colors={colors} />
          ) : locked.map(b => <BatchRow key={b.id} batch={b} onPress={() => router.push(`/procurement/batch/${b.id}`)} colors={colors} />)}
        </>
      )}
    </ScrollView>
  );
}

function SectionHeader({ label, colors }: { label: string; colors: ReturnType<typeof useColors> }) {
  return <Text style={[styles.sectionLabel, { color: colors.mutedForeground }]}>{label}</Text>;
}
function EmptyHint({ text, colors }: { text: string; colors: ReturnType<typeof useColors> }) {
  return <Text style={[styles.empty, { color: colors.mutedForeground }]}>{text}</Text>;
}
function BatchRow({ batch, onPress, colors }: { batch: Batch; onPress: () => void; colors: ReturnType<typeof useColors> }) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [styles.row, { backgroundColor: colors.card, borderColor: colors.border, opacity: pressed ? 0.85 : 1 }]}
      testID={`batch-row-${batch.id}`}
    >
      <View style={[styles.rowIcon, { backgroundColor: colors.accent }]}>
        <Feather name="package" size={18} color={colors.primary} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={[styles.rowTitle, { color: colors.foreground }]} numberOfLines={1}>{batch.batchTag} · {batch.commodityType ?? "—"}</Text>
        <Text style={[styles.rowSub, { color: colors.mutedForeground }]}>
          {batch.farmerCount} farmer{batch.farmerCount === 1 ? "" : "s"} · {Number(batch.totalWeightKg ?? 0).toLocaleString()} kg
        </Text>
      </View>
      <Feather name="chevron-right" size={18} color={colors.mutedForeground} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: { paddingHorizontal: 16, gap: 10 },
  headerRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 4 },
  h1: { fontSize: 22, fontWeight: "700" },
  fab: { width: 40, height: 40, borderRadius: 20, alignItems: "center", justifyContent: "center" },
  card: { borderWidth: 1, borderRadius: 12, padding: 14, gap: 10 },
  cardTitle: { fontSize: 15, fontWeight: "700" },
  cardSub: { fontSize: 12, lineHeight: 17 },
  input: { borderWidth: 1, borderRadius: 8, paddingHorizontal: 12, paddingVertical: 10, fontSize: 14 },
  btnPrimary: { borderRadius: 10, alignItems: "center", justifyContent: "center", paddingVertical: 12 },
  btnPrimaryText: { fontWeight: "600" },
  sectionLabel: { fontSize: 11, fontWeight: "700", textTransform: "uppercase", letterSpacing: 0.6, marginTop: 14, marginBottom: 2 },
  row: { flexDirection: "row", alignItems: "center", gap: 12, borderWidth: 1, borderRadius: 12, padding: 12 },
  rowIcon: { width: 36, height: 36, borderRadius: 18, alignItems: "center", justifyContent: "center" },
  rowTitle: { fontSize: 14, fontWeight: "600" },
  rowSub: { fontSize: 12, marginTop: 2 },
  empty: { fontSize: 12, paddingVertical: 8, fontStyle: "italic" },
});
