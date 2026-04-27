import { Feather } from "@expo/vector-icons";
import { useAuth } from "@clerk/expo";
import { useQuery } from "@tanstack/react-query";
import React, { useMemo, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Modal,
  Pressable,
  SafeAreaView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";

import { useColors } from "@/hooks/useColors";

const API_BASE =
  process.env.EXPO_PUBLIC_API_URL ??
  (process.env.EXPO_PUBLIC_DOMAIN ? `https://${process.env.EXPO_PUBLIC_DOMAIN}` : "");

export type OrgRegion = { id: string; name: string; description?: string | null; districtCount?: number };
export type GroupRow = { id: string; name: string; regionId?: string | null };
export type VillageRow = { id: string; name: string; level: number };

export interface OrgRegionGroupVillagePickerProps {
  orgRegionId: string;
  groupId: string;
  villageId: string;
  onChange: (next: { orgRegionId: string; groupId: string; villageId: string }) => void;
  testIDPrefix?: string;
}

/**
 * Three-level cascading picker used by mobile field forms (preregister, etc.).
 * Choosing a parent level resets the children below it so a stale combination
 * can never be submitted.
 */
export function OrgRegionGroupVillagePicker({
  orgRegionId,
  groupId,
  villageId,
  onChange,
  testIDPrefix = "ogv",
}: OrgRegionGroupVillagePickerProps) {
  const colors = useColors();
  const { getToken } = useAuth();

  const authedFetch = async (path: string) => {
    const token = await getToken();
    const r = await fetch(`${API_BASE}${path}`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    if (!r.ok) throw new Error(`${path} ${r.status}`);
    return r.json();
  };

  const orgRegionsQ = useQuery<OrgRegion[]>({
    queryKey: ["/api/org-regions"],
    queryFn: () => authedFetch("/api/org-regions"),
    staleTime: 60_000,
  });

  const groupsQ = useQuery<GroupRow[]>({
    queryKey: ["/api/org-regions/groups", orgRegionId],
    enabled: !!orgRegionId,
    queryFn: () => authedFetch(`/api/org-regions/${orgRegionId}/groups`),
    staleTime: 60_000,
  });

  const villagesQ = useQuery<VillageRow[]>({
    queryKey: ["/api/org-regions/villages", orgRegionId],
    enabled: !!orgRegionId,
    queryFn: () => authedFetch(`/api/org-regions/${orgRegionId}/villages`),
    staleTime: 60_000,
  });

  const orgRegions = orgRegionsQ.data ?? [];
  const groups = groupsQ.data ?? [];
  const villages = villagesQ.data ?? [];

  const setOrgRegion = (id: string) => onChange({ orgRegionId: id, groupId: "", villageId: "" });
  const setGroup = (id: string) => onChange({ orgRegionId, groupId: id, villageId });
  const setVillage = (id: string) => onChange({ orgRegionId, groupId, villageId: id });

  return (
    <View style={{ gap: 10 }}>
      <DropdownField
        label="Region *"
        valueLabel={orgRegions.find((r) => r.id === orgRegionId)?.name ?? "Tap to choose region"}
        loading={orgRegionsQ.isLoading}
        items={orgRegions.map((r) => ({ id: r.id, label: r.name, sub: `${r.districtCount ?? 0} districts` }))}
        onPick={setOrgRegion}
        emptyLabel="No regions configured. Ask an admin to set them up."
        testID={`${testIDPrefix}-region`}
        colors={colors}
      />
      <DropdownField
        label="Farmer Group *"
        valueLabel={groups.find((g) => g.id === groupId)?.name ?? (orgRegionId ? "Tap to choose group" : "Pick a region first")}
        disabled={!orgRegionId}
        loading={groupsQ.isLoading}
        items={groups.map((g) => ({ id: g.id, label: g.name }))}
        onPick={setGroup}
        emptyLabel="No groups in this region yet."
        testID={`${testIDPrefix}-group`}
        colors={colors}
      />
      <DropdownField
        label="Village *"
        valueLabel={villages.find((v) => v.id === villageId)?.name ?? (orgRegionId ? "Tap to choose village" : "Pick a region first")}
        disabled={!orgRegionId}
        loading={villagesQ.isLoading}
        items={villages.map((v) => ({ id: v.id, label: v.name }))}
        onPick={setVillage}
        emptyLabel="No villages mapped under this region's districts."
        testID={`${testIDPrefix}-village`}
        colors={colors}
      />
    </View>
  );
}

type Item = { id: string; label: string; sub?: string };

function DropdownField({
  label,
  valueLabel,
  items,
  onPick,
  loading,
  disabled,
  emptyLabel,
  testID,
  colors,
}: {
  label: string;
  valueLabel: string;
  items: Item[];
  onPick: (id: string) => void;
  loading?: boolean;
  disabled?: boolean;
  emptyLabel?: string;
  testID?: string;
  colors: ReturnType<typeof useColors>;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? items.filter((i) => i.label.toLowerCase().includes(q)) : items;
  }, [items, query]);

  return (
    <View style={{ gap: 6 }}>
      <Text style={[styles.label, { color: colors.mutedForeground }]}>{label}</Text>
      <Pressable
        onPress={() => !disabled && setOpen(true)}
        disabled={disabled}
        style={[
          styles.field,
          {
            borderColor: colors.border,
            backgroundColor: colors.card,
            opacity: disabled ? 0.5 : 1,
          },
        ]}
        testID={testID}
      >
        <Text style={{ color: colors.foreground, flex: 1 }} numberOfLines={1}>
          {valueLabel}
        </Text>
        {loading ? <ActivityIndicator size="small" color={colors.primary} /> : <Feather name="chevron-down" size={18} color={colors.mutedForeground} />}
      </Pressable>
      <Modal visible={open} animationType="slide" onRequestClose={() => setOpen(false)}>
        <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }}>
          <View style={[styles.modalHeader, { borderBottomColor: colors.border }]}>
            <Pressable onPress={() => setOpen(false)} hitSlop={10}>
              <Feather name="x" size={22} color={colors.foreground} />
            </Pressable>
            <Text style={[styles.modalTitle, { color: colors.foreground }]}>{label.replace(" *", "")}</Text>
            <View style={{ width: 22 }} />
          </View>
          <View style={{ padding: 12 }}>
            <TextInput
              value={query}
              onChangeText={setQuery}
              placeholder="Search…"
              placeholderTextColor={colors.mutedForeground}
              style={[styles.search, { borderColor: colors.border, color: colors.foreground, backgroundColor: colors.card }]}
            />
          </View>
          {filtered.length === 0 ? (
            <View style={{ padding: 24, alignItems: "center" }}>
              <Text style={{ color: colors.mutedForeground }}>{emptyLabel ?? "No items"}</Text>
            </View>
          ) : (
            <FlatList
              data={filtered}
              keyExtractor={(i) => i.id}
              renderItem={({ item }) => (
                <Pressable
                  onPress={() => { onPick(item.id); setOpen(false); setQuery(""); }}
                  style={({ pressed }) => [
                    styles.row,
                    { borderBottomColor: colors.border, opacity: pressed ? 0.6 : 1 },
                  ]}
                  testID={`${testID}-item-${item.id}`}
                >
                  <Text style={{ color: colors.foreground, fontSize: 16 }}>{item.label}</Text>
                  {item.sub && <Text style={{ color: colors.mutedForeground, fontSize: 12 }}>{item.sub}</Text>}
                </Pressable>
              )}
            />
          )}
        </SafeAreaView>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  label: { fontSize: 12, fontWeight: "500", textTransform: "uppercase", letterSpacing: 0.4 },
  field: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    borderWidth: 1,
    borderRadius: 8,
    paddingVertical: 12,
    paddingHorizontal: 12,
  },
  modalHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    padding: 12,
    borderBottomWidth: 1,
  },
  modalTitle: { fontSize: 16, fontWeight: "600" },
  search: {
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 15,
  },
  row: { paddingHorizontal: 16, paddingVertical: 14, borderBottomWidth: StyleSheet.hairlineWidth },
});
