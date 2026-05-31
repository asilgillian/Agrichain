import { Feather } from "@expo/vector-icons";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useColors } from "@/hooks/useColors";
import { useMe } from "@/hooks/useMe";
import { useApi } from "@/lib/api";

// A "farmer-entrepreneur" is a fully-registered farmer flagged as eligible for
// bulking loans. This screen lets a field agent search registered farmers and
// toggle that flag. Only fully-registered farmers can be marked (the server
// rejects pre-registered ones with a 409), so we search registrationStage=fully_registered.
type Farmer = {
  id: string;
  firstName: string;
  lastName: string;
  referenceNumber: string | null;
  village: string | null;
  isEntrepreneur?: boolean;
};

type FarmersResponse = { data: Farmer[]; total: number; page: number; limit: number };

export default function EntrepreneursScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const api = useApi();
  const qc = useQueryClient();
  const { me } = useMe();
  const perms = me?.permissions ?? [];
  const canManage = perms.includes("*") || perms.includes("farmers.register");

  const [search, setSearch] = useState("");
  const queryKey = ["entrepreneur-farmers", search] as const;

  const { data, isLoading, isError, refetch, isRefetching } = useQuery<FarmersResponse>({
    queryKey,
    queryFn: () => {
      const p = new URLSearchParams();
      p.set("registrationStage", "fully_registered");
      p.set("limit", "50");
      if (search.trim()) p.set("search", search.trim());
      return api<FarmersResponse>(`/api/farmers?${p.toString()}`);
    },
  });

  const toggle = useMutation({
    mutationFn: ({ id, makeEntrepreneur }: { id: string; makeEntrepreneur: boolean }) =>
      api(`/api/farmers/${id}/entrepreneur`, { method: makeEntrepreneur ? "POST" : "DELETE" }),
    onSuccess: () => qc.invalidateQueries({ queryKey }),
    onError: (e: any) => Alert.alert("Couldn't update", e?.message ?? "Please try again."),
  });

  const farmers = data?.data ?? [];

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <View style={{ paddingHorizontal: 20, paddingTop: 12, gap: 8 }}>
        <Text style={[styles.subtitle, { color: colors.mutedForeground }]}>
          Flag fully-registered farmers as entrepreneurs so they qualify for bulking loans.
        </Text>
        <View style={[styles.searchWrap, { borderColor: colors.border, backgroundColor: colors.card }]}>
          <Feather name="search" size={16} color={colors.mutedForeground} />
          <TextInput
            value={search}
            onChangeText={setSearch}
            placeholder="Search by name, reference, or ID"
            placeholderTextColor={colors.mutedForeground}
            style={[styles.searchInput, { color: colors.foreground }]}
            autoCapitalize="none"
            autoCorrect={false}
            testID="entrepreneur-search"
          />
          {search ? (
            <Pressable onPress={() => setSearch("")} hitSlop={8}>
              <Feather name="x" size={16} color={colors.mutedForeground} />
            </Pressable>
          ) : null}
        </View>
        {!canManage ? (
          <Text style={[styles.note, { color: colors.mutedForeground }]}>
            You can view entrepreneur status, but only users with farmer-registration access can change it.
          </Text>
        ) : null}
      </View>

      {isLoading ? (
        <View style={styles.center}>
          <ActivityIndicator size="large" color={colors.primary} />
        </View>
      ) : isError ? (
        <View style={styles.center}>
          <Feather name="alert-circle" size={32} color={colors.destructive} />
          <Text style={[styles.errorText, { color: colors.foreground }]}>Couldn't load farmers.</Text>
          <Pressable
            onPress={() => refetch()}
            style={({ pressed }) => [styles.retryBtn, { backgroundColor: colors.primary, opacity: pressed ? 0.7 : 1 }]}
            testID="entrepreneur-retry"
          >
            <Text style={{ color: colors.primaryForeground, fontWeight: "600" }}>Try again</Text>
          </Pressable>
        </View>
      ) : farmers.length === 0 ? (
        <View style={styles.center}>
          <Feather name="users" size={36} color={colors.mutedForeground} />
          <Text style={[styles.emptyTitle, { color: colors.foreground }]}>
            {search ? "No matches" : "No registered farmers"}
          </Text>
          <Text style={[styles.emptyText, { color: colors.mutedForeground }]}>
            {search ? "Try a different search term." : "Fully register a farmer before marking them an entrepreneur."}
          </Text>
        </View>
      ) : (
        <FlatList
          data={farmers}
          keyExtractor={(f) => f.id}
          onRefresh={() => refetch()}
          refreshing={isRefetching}
          contentContainerStyle={{ padding: 20, paddingBottom: insets.bottom + 96, gap: 10 }}
          renderItem={({ item }) => {
            const isEntrepreneur = !!item.isEntrepreneur;
            const pending = toggle.isPending && toggle.variables?.id === item.id;
            return (
              <View
                style={[styles.row, { borderColor: colors.border, backgroundColor: colors.card }]}
                testID={`entrepreneur-row-${item.id}`}
              >
                <View style={{ flex: 1 }}>
                  <Text style={[styles.rowName, { color: colors.foreground }]}>
                    {item.firstName} {item.lastName}
                  </Text>
                  <Text style={[styles.rowMeta, { color: colors.mutedForeground }]}>
                    {item.referenceNumber}
                    {item.village ? ` • ${item.village}` : ""}
                  </Text>
                  {isEntrepreneur ? (
                    <View style={[styles.badge, { backgroundColor: colors.primary }]}>
                      <Feather name="award" size={11} color={colors.primaryForeground} />
                      <Text style={[styles.badgeText, { color: colors.primaryForeground }]}>Entrepreneur</Text>
                    </View>
                  ) : null}
                </View>
                {canManage ? (
                  <Pressable
                    onPress={() => toggle.mutate({ id: item.id, makeEntrepreneur: !isEntrepreneur })}
                    disabled={pending}
                    style={({ pressed }) => [
                      styles.toggleBtn,
                      {
                        borderColor: isEntrepreneur ? colors.destructive : colors.primary,
                        backgroundColor: isEntrepreneur ? "transparent" : colors.primary,
                        opacity: pending ? 0.5 : pressed ? 0.7 : 1,
                      },
                    ]}
                    testID={`entrepreneur-toggle-${item.id}`}
                  >
                    {pending ? (
                      <ActivityIndicator size="small" color={isEntrepreneur ? colors.destructive : colors.primaryForeground} />
                    ) : (
                      <Text
                        style={{
                          color: isEntrepreneur ? colors.destructive : colors.primaryForeground,
                          fontWeight: "600",
                          fontSize: 13,
                        }}
                      >
                        {isEntrepreneur ? "Remove" : "Mark"}
                      </Text>
                    )}
                  </Pressable>
                ) : null}
              </View>
            );
          }}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  subtitle: { fontSize: 14 },
  note: { fontSize: 12, fontStyle: "italic" },
  searchWrap: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    marginTop: 4,
  },
  searchInput: { flex: 1, fontSize: 15, paddingVertical: 0 },
  center: { flex: 1, alignItems: "center", justifyContent: "center", gap: 12, paddingHorizontal: 24, paddingTop: 60 },
  errorText: { fontSize: 14, textAlign: "center" },
  retryBtn: { paddingHorizontal: 18, paddingVertical: 10, borderRadius: 8, marginTop: 4 },
  emptyTitle: { fontSize: 16, fontWeight: "600" },
  emptyText: { fontSize: 14, textAlign: "center" },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  rowName: { fontSize: 16, fontWeight: "600" },
  rowMeta: { fontSize: 12, marginTop: 2 },
  badge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    alignSelf: "flex-start",
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 3,
    marginTop: 6,
  },
  badgeText: { fontSize: 11, fontWeight: "600" },
  toggleBtn: {
    minWidth: 76,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderRadius: 8,
    paddingVertical: 9,
    paddingHorizontal: 12,
  },
});
