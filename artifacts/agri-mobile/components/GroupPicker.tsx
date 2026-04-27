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

type GroupRow = {
  id: string;
  name: string;
  regionId?: string | null;
  village?: string | null;
};

export interface GroupPickerProps {
  value: string;
  onChange: (groupId: string) => void;
  /** Optional region filter — pass the region id selected in RegionPicker. */
  regionId?: string;
  testID?: string;
}

/**
 * Mobile searchable group picker. Replaces the "paste group UUID" TextInput.
 * When `regionId` is provided, only groups in that exact region are shown
 * (callers should pass the deepest selected admin unit). Without a regionId
 * filter, the full group list is searchable.
 */
export function GroupPicker({ value, onChange, regionId, testID = "group-picker" }: GroupPickerProps) {
  const colors = useColors();
  const { getToken } = useAuth();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");

  const { data: groups, isLoading } = useQuery<GroupRow[]>({
    queryKey: ["/api/groups", "all"],
    enabled: open || !!value,
    staleTime: 60_000,
    queryFn: async () => {
      const token = await getToken();
      const r = await fetch(`${API_BASE}/api/groups`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (!r.ok) throw new Error(`Groups ${r.status}`);
      const body = await r.json();
      // /api/groups returns a plain array per the existing route handler.
      return Array.isArray(body) ? body : (body?.data ?? []);
    },
  });

  const all = groups ?? [];
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return all.filter(g => {
      // Strict region filter: when an admin unit is chosen, only show groups
      // whose regionId is exactly that id. Groups with null regionId never
      // belong to a specific unit, so they are excluded too.
      if (regionId && g.regionId !== regionId) return false;
      if (!q) return true;
      return g.name.toLowerCase().includes(q) || (g.village ?? "").toLowerCase().includes(q);
    });
  }, [all, query, regionId]);

  const selected = all.find(g => g.id === value);
  const valueLabel = selected ? selected.name : "Tap to choose group";

  return (
    <View style={styles.field}>
      <Pressable
        onPress={() => { setQuery(""); setOpen(true); }}
        style={[styles.trigger, { borderColor: colors.border, backgroundColor: colors.card }]}
        testID={testID}
      >
        <Text
          style={[styles.triggerText, { color: selected ? colors.foreground : colors.mutedForeground }]}
          numberOfLines={1}
        >
          {valueLabel}
        </Text>
        <Feather name="chevron-down" size={18} color={colors.mutedForeground} />
      </Pressable>

      <Modal visible={open} animationType="slide" onRequestClose={() => setOpen(false)}>
        <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }}>
          <View style={[styles.modalHeader, { borderBottomColor: colors.border }]}>
            <Pressable onPress={() => setOpen(false)} hitSlop={12} testID={`${testID}-close`}>
              <Feather name="x" size={22} color={colors.foreground} />
            </Pressable>
            <Text style={[styles.modalTitle, { color: colors.foreground }]}>Select group</Text>
            <View style={{ width: 22 }} />
          </View>

          <View style={[styles.searchBar, { borderBottomColor: colors.border }]}>
            <Feather name="search" size={16} color={colors.mutedForeground} />
            <TextInput
              autoFocus
              value={query}
              onChangeText={setQuery}
              placeholder="Search by group or village…"
              placeholderTextColor={colors.mutedForeground}
              style={[styles.searchInput, { color: colors.foreground }]}
              testID={`${testID}-search`}
            />
          </View>

          {isLoading ? (
            <View style={styles.center}><ActivityIndicator color={colors.primary} /></View>
          ) : filtered.length === 0 ? (
            <View style={styles.center}>
              <Text style={{ color: colors.mutedForeground, textAlign: "center" }}>
                {regionId ? "No groups exist in this administrative unit yet." : "No groups found."}
              </Text>
              {regionId && (
                <Text style={{ color: colors.mutedForeground, textAlign: "center", fontSize: 12 }}>
                  Create one from the web console first.
                </Text>
              )}
            </View>
          ) : (
            <FlatList
              data={filtered}
              keyExtractor={g => g.id}
              renderItem={({ item }) => (
                <Pressable
                  onPress={() => { onChange(item.id); setOpen(false); }}
                  style={({ pressed }) => [
                    styles.row,
                    { borderBottomColor: colors.border, backgroundColor: pressed ? colors.muted : colors.background },
                  ]}
                  testID={`${testID}-option-${item.id}`}
                >
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.rowName, { color: colors.foreground }]}>{item.name}</Text>
                    {item.village && (
                      <Text style={[styles.rowSub, { color: colors.mutedForeground }]}>{item.village}</Text>
                    )}
                  </View>
                  {value === item.id && <Feather name="check" size={18} color={colors.primary} />}
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
  field: { gap: 6 },
  trigger: {
    borderWidth: 1,
    borderRadius: 8,
    paddingVertical: 12,
    paddingHorizontal: 12,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
  },
  triggerText: { flex: 1, fontSize: 15 },
  modalHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
  },
  modalTitle: { fontSize: 16, fontWeight: "600" },
  searchBar: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderBottomWidth: 1,
  },
  searchInput: { flex: 1, fontSize: 15, paddingVertical: 6 },
  row: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
    gap: 12,
  },
  rowName: { fontSize: 15, fontWeight: "500" },
  rowSub: { fontSize: 12, marginTop: 2 },
  center: { flex: 1, alignItems: "center", justifyContent: "center", gap: 8, padding: 24 },
});
