import { Feather } from "@expo/vector-icons";
import { useQuery } from "@tanstack/react-query";
import { useRouter } from "expo-router";
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useApi } from "@/lib/api";
import { useColors } from "@/hooks/useColors";
import { useMe } from "@/hooks/useMe";

// --- Types -----------------------------------------------------------------
//
// In the new delivery-first model, the field-agent landing page surfaces TWO
// lists side by side:
//   1. Captured (unbatched) deliveries — every per-farmer drop-off the agent
//      has recorded but not yet grouped into a batch.
//   2. Open batches — groupings of same-crop deliveries that are still being
//      assembled or awaiting station handover.
//
// A delivery becomes "in a batch" when the agent (or back office) groups it,
// at which point its status flips from `captured` to `pending_weight_submit`
// and the existing weight/QC/pricing workflow takes over.

type Delivery = {
  id: string;
  deliveryNumber: string;
  farmerId: string;
  cropType: string;
  capturedWeightKg: number;
  status: string;
  createdAt: string;
};

type Batch = {
  id: string;
  batchTag: string;
  status: "open" | "locked" | "delivered";
  totalWeightKg: number;
  farmerCount: number;
  cropType: string | null;
  createdAt: string;
};

export default function ProcurementHomeScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const api = useApi();
  const { me } = useMe();

  // Captured = no batch yet. We pass `unbatched=true` so the server applies
  // status='captured' AND batch_id IS NULL — never trust the client to
  // dedupe these into the right bucket.
  const capturedQ = useQuery<Delivery[]>({
    queryKey: ["captured-deliveries", me?.id],
    enabled: !!me?.id,
    queryFn: () => api<Delivery[]>(`/api/procurement/deliveries?unbatched=true&agentId=${me!.id}`),
  });

  const batchesQ = useQuery<Batch[]>({
    queryKey: ["procurement-batches", me?.id],
    enabled: !!me?.id,
    queryFn: () => api<Batch[]>(`/api/batches?agentId=${me!.id}`),
  });

  const captured = capturedQ.data ?? [];
  const batches = batchesQ.data ?? [];
  const open = batches.filter(b => b.status === "open");
  const locked = batches.filter(b => b.status === "locked");

  const refreshing = capturedQ.isRefetching || batchesQ.isRefetching;
  const refetchAll = () => { capturedQ.refetch(); batchesQ.refetch(); };
  const loading = capturedQ.isLoading || batchesQ.isLoading;

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: colors.background }}
      contentContainerStyle={[styles.container, { paddingTop: 8, paddingBottom: insets.bottom + 80 }]}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refetchAll} tintColor={colors.primary} />}
    >
      <Text style={[styles.h1, { color: colors.foreground }]}>Procurement</Text>

      <View style={styles.actionRow}>
        <Pressable
          onPress={() => router.push("/procurement/deliveries/new")}
          style={({ pressed }) => [styles.actionBtn, { backgroundColor: colors.primary, opacity: pressed ? 0.85 : 1 }]}
          testID="capture-delivery-cta"
        >
          <Feather name="plus" size={16} color={colors.primaryForeground} />
          <Text style={[styles.actionBtnText, { color: colors.primaryForeground }]}>Capture delivery</Text>
        </Pressable>
        <Pressable
          onPress={() => router.push("/procurement/batches/new")}
          disabled={captured.length === 0}
          style={({ pressed }) => [
            styles.actionBtnSecondary,
            {
              borderColor: colors.border,
              opacity: captured.length === 0 ? 0.4 : pressed ? 0.85 : 1,
            },
          ]}
          testID="new-batch-cta"
        >
          <Feather name="package" size={16} color={colors.foreground} />
          <Text style={[styles.actionBtnSecondaryText, { color: colors.foreground }]}>Group into batch</Text>
        </Pressable>
      </View>

      <Pressable
        onPress={() => router.push("/procurement/suppliers/new")}
        style={({ pressed }) => [styles.supplierLink, { opacity: pressed ? 0.6 : 1 }]}
        testID="register-supplier-cta"
      >
        <Feather name="briefcase" size={14} color={colors.primary} />
        <Text style={[styles.supplierLinkText, { color: colors.primary }]}>Register a third-party supplier</Text>
      </Pressable>

      <Pressable
        onPress={() => router.push("/procurement/entrepreneurs")}
        style={({ pressed }) => [styles.supplierLink, { opacity: pressed ? 0.6 : 1 }]}
        testID="manage-entrepreneurs-cta"
      >
        <Feather name="award" size={14} color={colors.primary} />
        <Text style={[styles.supplierLinkText, { color: colors.primary }]}>Manage farmer-entrepreneurs</Text>
      </Pressable>

      {loading ? (
        <View style={{ paddingVertical: 40, alignItems: "center" }}><ActivityIndicator color={colors.primary} /></View>
      ) : (
        <>
          <SectionHeader label={`Captured (unbatched) · ${captured.length}`} colors={colors} />
          {captured.length === 0 ? (
            <EmptyHint text="No captured deliveries. Tap Capture delivery to record one." colors={colors} />
          ) : captured.map(d => (
            <DeliveryRow key={d.id} delivery={d} onPress={() => router.push(`/procurement/delivery/${d.id}`)} colors={colors} />
          ))}

          <SectionHeader label={`Open batches · ${open.length}`} colors={colors} />
          {open.length === 0 ? (
            <EmptyHint text="No open batches yet." colors={colors} />
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

function DeliveryRow({ delivery, onPress, colors }: { delivery: Delivery; onPress: () => void; colors: ReturnType<typeof useColors> }) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [styles.row, { backgroundColor: colors.card, borderColor: colors.border, opacity: pressed ? 0.85 : 1 }]}
      testID={`delivery-row-${delivery.id}`}
    >
      <View style={[styles.rowIcon, { backgroundColor: colors.accent }]}>
        <Feather name="truck" size={18} color={colors.primary} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={[styles.rowTitle, { color: colors.foreground }]} numberOfLines={1}>{delivery.deliveryNumber} · {delivery.cropType}</Text>
        <Text style={[styles.rowSub, { color: colors.mutedForeground }]}>
          {Number(delivery.capturedWeightKg ?? 0).toLocaleString()} kg · captured
        </Text>
      </View>
      <Feather name="chevron-right" size={18} color={colors.mutedForeground} />
    </Pressable>
  );
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
        <Text style={[styles.rowTitle, { color: colors.foreground }]} numberOfLines={1}>{batch.batchTag} · {batch.cropType ?? "—"}</Text>
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
  h1: { fontSize: 22, fontWeight: "700", marginBottom: 4 },
  actionRow: { flexDirection: "row", gap: 8, marginBottom: 6 },
  actionBtn: { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, paddingVertical: 11, borderRadius: 10 },
  actionBtnText: { fontWeight: "600", fontSize: 13 },
  actionBtnSecondary: { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, paddingVertical: 11, borderRadius: 10, borderWidth: 1 },
  actionBtnSecondaryText: { fontWeight: "600", fontSize: 13 },
  supplierLink: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, paddingVertical: 6 },
  supplierLinkText: { fontWeight: "600", fontSize: 13 },
  sectionLabel: { fontSize: 11, fontWeight: "700", textTransform: "uppercase", letterSpacing: 0.6, marginTop: 14, marginBottom: 2 },
  row: { flexDirection: "row", alignItems: "center", gap: 12, borderWidth: 1, borderRadius: 12, padding: 12 },
  rowIcon: { width: 36, height: 36, borderRadius: 18, alignItems: "center", justifyContent: "center" },
  rowTitle: { fontSize: 14, fontWeight: "600" },
  rowSub: { fontSize: 12, marginTop: 2 },
  empty: { fontSize: 12, paddingVertical: 8, fontStyle: "italic" },
});
