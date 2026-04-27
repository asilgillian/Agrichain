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
  View,
} from "react-native";

import { useColors } from "@/hooks/useColors";

const API_BASE =
  process.env.EXPO_PUBLIC_API_URL ??
  (process.env.EXPO_PUBLIC_DOMAIN ? `https://${process.env.EXPO_PUBLIC_DOMAIN}` : "");

type RegionRow = {
  id: string;
  name: string;
  parentId: string | null;
  level: number | null;
  countryCode: string | null;
  isActive: boolean | null;
};
type CountryHierarchy = {
  countryCode: string;
  countryName: string;
  levels: { level: number; name: string }[];
};

export interface RegionPickerProps {
  value: string;
  onChange: (regionId: string) => void;
  country?: string;
  testID?: string;
}

/**
 * Mobile cascading admin-unit picker. Tapping the field opens a full-screen
 * modal that drills the configured country hierarchy one level at a time
 * (Uganda: District → Sub-county → Parish → Village). Selecting a leaf — or
 * any intermediate level the user is willing to stop at — sets the regionId.
 *
 * Replaces the previous "paste region UUID" TextInput which was unusable in
 * the field.
 */
export function RegionPicker({ value, onChange, country = "UG", testID = "region-picker" }: RegionPickerProps) {
  const colors = useColors();
  const { getToken } = useAuth();
  const [open, setOpen] = useState(false);
  // Stack of region ids representing the drill path. [] means at root (level 1).
  // Each element is the id of the parent region whose children we are showing.
  const [path, setPath] = useState<RegionRow[]>([]);

  const { data: regions, isLoading: regionsLoading } = useQuery<RegionRow[]>({
    queryKey: ["/api/admin/regions"],
    enabled: open || !!value,
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const token = await getToken();
      const r = await fetch(`${API_BASE}/api/admin/regions`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (!r.ok) throw new Error(`Regions ${r.status}`);
      return r.json();
    },
  });

  const { data: hierarchies } = useQuery<CountryHierarchy[]>({
    queryKey: ["/api/admin/country-hierarchies"],
    enabled: open,
    staleTime: 60 * 60_000,
    queryFn: async () => {
      const token = await getToken();
      const r = await fetch(`${API_BASE}/api/admin/country-hierarchies`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (!r.ok) throw new Error(`Hierarchies ${r.status}`);
      return r.json();
    },
  });

  const all = (regions ?? []) as RegionRow[];
  const byId = useMemo(() => {
    const m = new Map<string, RegionRow>();
    for (const r of all) m.set(r.id, r);
    return m;
  }, [all]);

  const childrenOf = useMemo(() => {
    const m = new Map<string | null, RegionRow[]>();
    for (const r of all) {
      if ((r.countryCode ?? "") !== country) continue;
      if (r.isActive === false) continue;
      const key = r.parentId ?? null;
      const arr = m.get(key) ?? [];
      arr.push(r);
      m.set(key, arr);
    }
    for (const arr of m.values()) arr.sort((a, b) => a.name.localeCompare(b.name));
    return m;
  }, [all, country]);

  const levels = (hierarchies ?? []).find(h => h.countryCode === country)?.levels
    .slice().sort((a, b) => a.level - b.level)
    ?? [{ level: 1, name: "Region" }];

  // Display path of the currently committed value (regardless of in-progress drill)
  const committedPath = useMemo(() => {
    if (!value) return [] as RegionRow[];
    const out: RegionRow[] = [];
    let node: RegionRow | undefined = byId.get(value);
    while (node) {
      out.unshift(node);
      node = node.parentId ? byId.get(node.parentId) : undefined;
    }
    return out;
  }, [value, byId]);

  const currentParentId = path.length > 0 ? path[path.length - 1].id : null;
  const currentDepth = path.length; // 0 = showing level-1 options
  const currentLevelName = levels[currentDepth]?.name ?? `Level ${currentDepth + 1}`;
  const options = childrenOf.get(currentParentId) ?? [];

  const openModal = () => {
    setPath([]);
    setOpen(true);
  };

  const pick = (r: RegionRow) => {
    const kids = childrenOf.get(r.id) ?? [];
    if (kids.length === 0) {
      // Leaf — commit and close.
      onChange(r.id);
      setOpen(false);
      return;
    }
    // Drill deeper.
    setPath(p => [...p, r]);
  };

  const stopHere = () => {
    if (path.length === 0) return;
    onChange(path[path.length - 1].id);
    setOpen(false);
  };

  const back = () => setPath(p => p.slice(0, -1));

  const valueLabel = committedPath.length > 0
    ? committedPath.map(p => p.name).join(" › ")
    : "Tap to choose administrative unit";

  return (
    <View style={styles.field}>
      <Pressable
        onPress={openModal}
        style={[styles.trigger, { borderColor: colors.border, backgroundColor: colors.card }]}
        testID={testID}
      >
        <Text
          style={[styles.triggerText, { color: committedPath.length > 0 ? colors.foreground : colors.mutedForeground }]}
          numberOfLines={2}
        >
          {valueLabel}
        </Text>
        <Feather name="chevron-down" size={18} color={colors.mutedForeground} />
      </Pressable>

      <Modal visible={open} animationType="slide" onRequestClose={() => setOpen(false)} transparent={false}>
        <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }}>
          <View style={[styles.modalHeader, { borderBottomColor: colors.border }]}>
            <Pressable onPress={() => setOpen(false)} hitSlop={12} testID={`${testID}-close`}>
              <Feather name="x" size={22} color={colors.foreground} />
            </Pressable>
            <Text style={[styles.modalTitle, { color: colors.foreground }]}>
              Select {currentLevelName}
            </Text>
            <View style={{ width: 22 }} />
          </View>

          {path.length > 0 && (
            <View style={[styles.crumbBar, { borderBottomColor: colors.border }]}>
              <Pressable onPress={back} style={styles.crumbBack} hitSlop={8} testID={`${testID}-back`}>
                <Feather name="chevron-left" size={18} color={colors.primary} />
                <Text style={[styles.crumbBackText, { color: colors.primary }]}>Back</Text>
              </Pressable>
              <Text style={[styles.crumbText, { color: colors.mutedForeground }]} numberOfLines={1}>
                {path.map(p => p.name).join(" › ")}
              </Text>
            </View>
          )}

          {regionsLoading ? (
            <View style={styles.center}><ActivityIndicator color={colors.primary} /></View>
          ) : options.length === 0 ? (
            <View style={styles.center}>
              <Text style={{ color: colors.mutedForeground }}>
                No {currentLevelName.toLowerCase()}s configured here.
              </Text>
              {path.length > 0 && (
                <Pressable onPress={stopHere} style={[styles.stopBtn, { borderColor: colors.primary }]} testID={`${testID}-stop-here`}>
                  <Text style={{ color: colors.primary, fontWeight: "600" }}>Use {path[path.length - 1].name}</Text>
                </Pressable>
              )}
            </View>
          ) : (
            <FlatList
              data={options}
              keyExtractor={r => r.id}
              renderItem={({ item }) => {
                const hasKids = (childrenOf.get(item.id) ?? []).length > 0;
                return (
                  <Pressable
                    onPress={() => pick(item)}
                    style={({ pressed }) => [
                      styles.row,
                      { borderBottomColor: colors.border, backgroundColor: pressed ? colors.muted : colors.background },
                    ]}
                    testID={`${testID}-option-${item.id}`}
                  >
                    <Text style={[styles.rowText, { color: colors.foreground }]}>{item.name}</Text>
                    {hasKids ? (
                      <Feather name="chevron-right" size={18} color={colors.mutedForeground} />
                    ) : (
                      <Feather name="check-circle" size={18} color={colors.mutedForeground} />
                    )}
                  </Pressable>
                );
              }}
              ListFooterComponent={path.length > 0 ? (
                <Pressable onPress={stopHere} style={[styles.stopBtn, { borderColor: colors.primary, alignSelf: "center", marginTop: 16 }]} testID={`${testID}-stop-here`}>
                  <Text style={{ color: colors.primary, fontWeight: "600" }}>
                    Stop at {path[path.length - 1].name}
                  </Text>
                </Pressable>
              ) : null}
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
  crumbBar: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderBottomWidth: 1,
    gap: 12,
  },
  crumbBack: { flexDirection: "row", alignItems: "center", gap: 2 },
  crumbBackText: { fontSize: 14, fontWeight: "500" },
  crumbText: { fontSize: 13, flex: 1 },
  row: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  rowText: { fontSize: 15 },
  center: { flex: 1, alignItems: "center", justifyContent: "center", gap: 12, padding: 24 },
  stopBtn: { borderWidth: 1, borderRadius: 8, paddingVertical: 10, paddingHorizontal: 16 },
});
