import { Feather } from "@expo/vector-icons";
import { useAuth } from "@clerk/expo";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useColors } from "@/hooks/useColors";

const API_BASE =
  process.env.EXPO_PUBLIC_API_URL ??
  (process.env.EXPO_PUBLIC_DOMAIN
    ? `https://${process.env.EXPO_PUBLIC_DOMAIN}`
    : "");

type PendingFarmer = {
  id: string;
  firstName: string;
  lastName: string;
  referenceNumber: string;
  groupId: string;
  groupName: string | null;
  village: string | null;
  phoneNumber: string | null;
  registrationStage: string;
};
type Commodity = { id: string; name: string; defaultUnit?: string | null };
type AddedCrop = { commodityId: string; name: string; lastHarvestKg?: string; lastHarvestDate?: string };

type ListResp = { data: PendingFarmer[]; total: number };

// Chip option lists shared with the Register tab (mirrors API enum sets).
const ACTIVITY_OPTIONS: { value: string; label: string }[] = [
  { value: "livestock", label: "Livestock" },
  { value: "fishing", label: "Fishing" },
  { value: "beekeeping", label: "Beekeeping" },
  { value: "trading", label: "Trading" },
  { value: "carpentry", label: "Carpentry" },
  { value: "other", label: "Other" },
];
const INCOME_SOURCE_OPTIONS = [
  { value: "none", label: "None" },
  { value: "trading", label: "Trading" },
  { value: "wage_labour", label: "Wage labour" },
  { value: "remittance", label: "Remittance" },
  { value: "other", label: "Other" },
];
const EDUCATION_OPTIONS = [
  { value: "none", label: "None" },
  { value: "primary", label: "Primary" },
  { value: "secondary", label: "Secondary" },
  { value: "tertiary", label: "Tertiary" },
];
const COOKING_FUEL_OPTIONS = [
  { value: "firewood", label: "Firewood" },
  { value: "charcoal", label: "Charcoal" },
  { value: "lpg", label: "LPG" },
  { value: "electricity", label: "Electricity" },
  { value: "other", label: "Other" },
];
const YES_NO_OPTIONS = [
  { value: "yes", label: "Yes" },
  { value: "no", label: "No" },
];

export default function CompleteScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { getToken } = useAuth();

  const [pending, setPending] = useState<PendingFarmer[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [search, setSearch] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<PendingFarmer | null>(null);

  const authHeaders = useCallback(async (): Promise<Record<string, string>> => {
    const token = await getToken();
    return {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    };
  }, [getToken]);

  const fetchPending = useCallback(async () => {
    setError(null);
    try {
      const headers = await authHeaders();
      const res = await fetch(
        `${API_BASE}/api/farmers?registrationStage=pre_registered&limit=50`,
        { headers },
      );
      if (!res.ok) {
        const text = await res.text();
        throw new Error(`Failed to load (${res.status}): ${text.slice(0, 200)}`);
      }
      const json: ListResp = await res.json();
      setPending(json.data ?? []);
    } catch (e: any) {
      setError(e?.message ?? "Failed to load pending farmers");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [authHeaders]);

  useEffect(() => {
    void fetchPending();
  }, [fetchPending]);

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    void fetchPending();
  }, [fetchPending]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return pending;
    return pending.filter(
      (f) =>
        `${f.firstName} ${f.lastName}`.toLowerCase().includes(q) ||
        (f.referenceNumber ?? "").toLowerCase().includes(q) ||
        (f.village ?? "").toLowerCase().includes(q),
    );
  }, [pending, search]);

  // After a successful KYC submit, drop the farmer from the local list and
  // pop back to the list view. We avoid a full re-fetch so the screen stays
  // instant — pull-to-refresh covers consistency if the agent wants it.
  const handleCompleted = useCallback((farmerId: string) => {
    setPending((prev) => prev.filter((f) => f.id !== farmerId));
    setSelected(null);
  }, []);

  if (selected) {
    return (
      <CompleteFarmerForm
        farmer={selected}
        onCancel={() => setSelected(null)}
        onCompleted={handleCompleted}
      />
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: colors.background, paddingTop: insets.top + 16 }}>
      <View style={{ paddingHorizontal: 20, gap: 8 }}>
        <Text style={[styles.title, { color: colors.foreground }]}>Complete Registration</Text>
        <Text style={[styles.subtitle, { color: colors.mutedForeground }]}>
          Pick a pre-registered farmer and capture the missing KYC details to mark them fully registered.
        </Text>
        <View style={[styles.searchWrap, { borderColor: colors.border, backgroundColor: colors.card }]}>
          <Feather name="search" size={16} color={colors.mutedForeground} />
          <TextInput
            value={search}
            onChangeText={setSearch}
            placeholder="Search by name, reference, or village"
            placeholderTextColor={colors.mutedForeground}
            style={[styles.searchInput, { color: colors.foreground }]}
            autoCapitalize="none"
            autoCorrect={false}
            testID="complete-search"
          />
          {search ? (
            <Pressable onPress={() => setSearch("")} hitSlop={8}>
              <Feather name="x" size={16} color={colors.mutedForeground} />
            </Pressable>
          ) : null}
        </View>
      </View>

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator size="large" color={colors.primary} />
        </View>
      ) : error ? (
        <View style={styles.center}>
          <Feather name="alert-circle" size={32} color={colors.destructive} />
          <Text style={[styles.errorText, { color: colors.foreground }]}>{error}</Text>
          <Pressable
            onPress={() => {
              setLoading(true);
              void fetchPending();
            }}
            style={({ pressed }) => [
              styles.retryBtn,
              { backgroundColor: colors.primary, opacity: pressed ? 0.7 : 1 },
            ]}
            testID="complete-retry"
          >
            <Text style={{ color: colors.primaryForeground, fontWeight: "600" }}>Try again</Text>
          </Pressable>
        </View>
      ) : filtered.length === 0 ? (
        <ScrollView
          contentContainerStyle={[styles.center, { paddingBottom: insets.bottom + 96 }]}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
        >
          <Feather name="check-circle" size={36} color={colors.mutedForeground} />
          <Text style={[styles.emptyTitle, { color: colors.foreground }]}>
            {search ? "No matches" : "Nothing pending"}
          </Text>
          <Text style={[styles.emptyText, { color: colors.mutedForeground }]}>
            {search
              ? "Try a different search term."
              : "All farmers in your assigned groups are already fully registered."}
          </Text>
        </ScrollView>
      ) : (
        <FlatList
          data={filtered}
          keyExtractor={(f) => f.id}
          contentContainerStyle={{ padding: 20, paddingBottom: insets.bottom + 96, gap: 10 }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
          renderItem={({ item }) => (
            <Pressable
              onPress={() => setSelected(item)}
              style={({ pressed }) => [
                styles.row,
                { borderColor: colors.border, backgroundColor: colors.card, opacity: pressed ? 0.7 : 1 },
              ]}
              testID={`pending-${item.id}`}
            >
              <View style={{ flex: 1 }}>
                <Text style={[styles.rowName, { color: colors.foreground }]}>
                  {item.firstName} {item.lastName}
                </Text>
                <Text style={[styles.rowMeta, { color: colors.mutedForeground }]}>
                  {item.referenceNumber}
                  {item.groupName ? ` • ${item.groupName}` : ""}
                  {item.village ? ` • ${item.village}` : ""}
                </Text>
              </View>
              <Feather name="chevron-right" size={20} color={colors.mutedForeground} />
            </Pressable>
          )}
        />
      )}
    </View>
  );
}

function CompleteFarmerForm({
  farmer,
  onCancel,
  onCompleted,
}: {
  farmer: PendingFarmer;
  onCancel: () => void;
  onCompleted: (farmerId: string) => void;
}) {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { getToken } = useAuth();

  const [nationalId, setNationalId] = useState("");
  const [dateOfBirth, setDateOfBirth] = useState(""); // YYYY-MM-DD
  const [sex, setSex] = useState<"" | "male" | "female" | "other">("");
  const [phoneNumber, setPhoneNumber] = useState(farmer.phoneNumber ?? "+256");
  const [householdSize, setHouseholdSize] = useState("");
  const [dependants, setDependants] = useState("");
  const [headOfHousehold, setHeadOfHousehold] = useState("");
  const [landTenure, setLandTenure] = useState<"" | "Owned" | "Rented" | "Inherited" | "Other">("");

  // Farm — crops grown (multi from commodity master, with last harvest)
  const [commodities, setCommodities] = useState<Commodity[]>([]);
  const [crops, setCrops] = useState<AddedCrop[]>([]);
  const [showAddCrop, setShowAddCrop] = useState(false);
  const [pendingCommodityId, setPendingCommodityId] = useState("");
  const [pendingHarvestKg, setPendingHarvestKg] = useState("");
  const [pendingHarvestDate, setPendingHarvestDate] = useState("");

  // Farm — other on-farm activities
  const [otherActivities, setOtherActivities] = useState<string[]>([]);

  // Livelihood — for living-income tracking
  const [cultivatedLandHa, setCultivatedLandHa] = useState("");
  const [offFarmIncomeSource, setOffFarmIncomeSource] = useState("");
  const [offFarmIncomeMonthlyUgx, setOffFarmIncomeMonthlyUgx] = useState("");
  const [monthsOfFoodShortage, setMonthsOfFoodShortage] = useState("");
  const [educationLevelHead, setEducationLevelHead] = useState("");
  const [accessCleanWater, setAccessCleanWater] = useState<"" | "yes" | "no">("");
  const [accessElectricity, setAccessElectricity] = useState<"" | "yes" | "no">("");
  const [primaryCookingFuel, setPrimaryCookingFuel] = useState("");

  const [submitting, setSubmitting] = useState(false);

  // Load active commodities once. Failure is non-fatal — the agent can still complete
  // the registration; the crops section will just show an empty picker.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const token = await getToken();
        const res = await fetch(`${API_BASE}/api/commodities?status=active`, {
          headers: token ? { Authorization: `Bearer ${token}` } : {},
        });
        if (!res.ok) return;
        const rows = await res.json();
        if (!cancelled && Array.isArray(rows)) {
          setCommodities(rows.map((r: any) => ({ id: r.id, name: r.name, defaultUnit: r.defaultUnit })));
        }
      } catch {
        /* non-fatal */
      }
    })();
    return () => { cancelled = true; };
  }, [getToken]);

  // Translate server error codes into language a field agent can act on.
  const friendlyError = (code?: string, fallback?: string) => {
    switch (code) {
      case "NATIONAL_ID_REQUIRED":
        return "National ID is required to complete registration.";
      case "ALREADY_FULLY_REGISTERED":
        return "This farmer is already fully registered.";
      default:
        return fallback ?? "Submission failed.";
    }
  };

  const submit = async () => {
    if (!nationalId.trim()) {
      Alert.alert("Missing field", "National ID is required.");
      return;
    }
    if (dateOfBirth && !/^\d{4}-\d{2}-\d{2}$/.test(dateOfBirth.trim())) {
      Alert.alert("Invalid date", "Date of birth must be in YYYY-MM-DD format (e.g. 1990-04-25).");
      return;
    }
    setSubmitting(true);
    try {
      const token = await getToken();
      const headers: Record<string, string> = {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      };
      // Only send fields the agent actually filled in. The server's /complete
      // handler selectively accepts each KYC field and won't overwrite with empty.
      const body: Record<string, unknown> = { nationalId: nationalId.trim() };
      if (dateOfBirth.trim()) body.dateOfBirth = dateOfBirth.trim();
      if (sex) body.sex = sex;
      if (phoneNumber.trim() && phoneNumber.trim() !== "+256") body.phoneNumber = phoneNumber.trim();
      if (householdSize.trim()) {
        const n = parseInt(householdSize.trim(), 10);
        if (Number.isFinite(n) && n >= 0) body.householdSize = n;
      }
      if (dependants.trim()) {
        const n = parseInt(dependants.trim(), 10);
        if (Number.isFinite(n) && n >= 0) body.dependants = n;
      }
      if (headOfHousehold.trim()) body.headOfHousehold = headOfHousehold.trim();
      if (landTenure) body.landTenure = landTenure;

      // Farm + livelihood (only include fields with a value)
      if (otherActivities.length > 0) body.otherActivities = otherActivities;
      if (cultivatedLandHa.trim()) {
        const n = Number(cultivatedLandHa.trim());
        if (Number.isFinite(n) && n >= 0) body.cultivatedLandHa = n;
      }
      if (offFarmIncomeSource) body.offFarmIncomeSource = offFarmIncomeSource;
      if (offFarmIncomeMonthlyUgx.trim()) {
        const n = parseInt(offFarmIncomeMonthlyUgx.trim(), 10);
        if (Number.isFinite(n) && n >= 0) body.offFarmIncomeMonthlyUgx = n;
      }
      if (monthsOfFoodShortage.trim()) {
        const n = parseInt(monthsOfFoodShortage.trim(), 10);
        if (Number.isFinite(n) && n >= 0 && n <= 12) body.monthsOfFoodShortage = n;
      }
      if (educationLevelHead) body.educationLevelHead = educationLevelHead;
      if (accessCleanWater) body.accessCleanWater = accessCleanWater === "yes";
      if (accessElectricity) body.accessElectricity = accessElectricity === "yes";
      if (primaryCookingFuel) body.primaryCookingFuel = primaryCookingFuel;
      // crops[]: send only when the agent added at least one. Server REPLACES the
      // existing crop set, so only include when the form had crops in it (the user
      // can also explicitly send an empty array later via PATCH if they ever need
      // to clear; not needed here since we only ever ADD on the complete form).
      if (crops.length > 0) {
        body.crops = crops.map((c) => ({
          commodityId: c.commodityId,
          ...(c.lastHarvestKg ? { lastHarvestKg: Number(c.lastHarvestKg) } : {}),
          ...(c.lastHarvestDate ? { lastHarvestDate: c.lastHarvestDate } : {}),
        }));
      }

      const res = await fetch(`${API_BASE}/api/farmers/${farmer.id}/complete`, {
        method: "POST",
        headers,
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        let code: string | undefined;
        let serverError: string | undefined;
        try {
          const j = await res.json();
          code = typeof j?.code === "string" ? j.code : undefined;
          serverError = typeof j?.error === "string" ? j.error : undefined;
        } catch {
          /* non-JSON response */
        }
        Alert.alert("Couldn't complete registration", friendlyError(code, serverError));
        return;
      }
      Alert.alert("Done", `${farmer.firstName} ${farmer.lastName} is now fully registered.`);
      onCompleted(farmer.id);
    } catch (e: any) {
      Alert.alert("Submission failed", e?.message ?? "Unknown error");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: colors.background }}
      contentContainerStyle={[
        styles.container,
        { paddingTop: insets.top + 16, paddingBottom: insets.bottom + 96 },
      ]}
      keyboardShouldPersistTaps="handled"
    >
      <Pressable onPress={onCancel} hitSlop={8} style={styles.backRow} testID="complete-back">
        <Feather name="chevron-left" size={20} color={colors.primary} />
        <Text style={{ color: colors.primary, fontWeight: "600" }}>Back to list</Text>
      </Pressable>

      <Text style={[styles.title, { color: colors.foreground }]}>
        {farmer.firstName} {farmer.lastName}
      </Text>
      <Text style={[styles.subtitle, { color: colors.mutedForeground }]}>
        {farmer.referenceNumber}
        {farmer.groupName ? ` • ${farmer.groupName}` : ""}
        {farmer.village ? ` • ${farmer.village}` : ""}
      </Text>

      <Text style={[styles.sectionLabel, { color: colors.foreground }]}>Identity</Text>
      <Field
        label="National ID *"
        value={nationalId}
        onChangeText={setNationalId}
        placeholder="CM12345678ABCD"
        colors={colors}
        autoCapitalize="characters"
        testID="complete-national-id"
      />
      <Field
        label="Date of birth (YYYY-MM-DD)"
        value={dateOfBirth}
        onChangeText={setDateOfBirth}
        placeholder="1990-04-25"
        keyboardType="numbers-and-punctuation"
        colors={colors}
        autoCapitalize="none"
        testID="complete-dob"
      />
      <ChoiceField
        label="Sex"
        value={sex}
        onChange={(v) => setSex(v as typeof sex)}
        options={[
          { value: "male", label: "Male" },
          { value: "female", label: "Female" },
          { value: "other", label: "Other" },
        ]}
        colors={colors}
        testIDPrefix="complete-sex"
      />
      <Field
        label="Phone"
        value={phoneNumber}
        onChangeText={setPhoneNumber}
        placeholder="+256..."
        keyboardType="phone-pad"
        colors={colors}
        testID="complete-phone"
      />

      <Text style={[styles.sectionLabel, { color: colors.foreground }]}>Household</Text>
      <Field
        label="Household size"
        value={householdSize}
        onChangeText={setHouseholdSize}
        placeholder="5"
        keyboardType="number-pad"
        colors={colors}
        testID="complete-household-size"
      />
      <Field
        label="Dependants"
        value={dependants}
        onChangeText={setDependants}
        placeholder="3"
        keyboardType="number-pad"
        colors={colors}
        testID="complete-dependants"
      />
      <Field
        label="Head of household"
        value={headOfHousehold}
        onChangeText={setHeadOfHousehold}
        placeholder="Self / Spouse / Parent…"
        colors={colors}
        testID="complete-head-of-household"
      />
      <ChoiceField
        label="Land tenure"
        value={landTenure}
        onChange={(v) => setLandTenure(v as typeof landTenure)}
        options={[
          { value: "Owned", label: "Owned" },
          { value: "Rented", label: "Rented" },
          { value: "Inherited", label: "Inherited" },
          { value: "Other", label: "Other" },
        ]}
        colors={colors}
        testIDPrefix="complete-land-tenure"
      />

      {/* ---------------- Crops grown ---------------- */}
      <Text style={[styles.sectionLabel, { color: colors.foreground }]}>Crops grown</Text>
      {crops.length === 0 && !showAddCrop && (
        <Text style={{ color: colors.mutedForeground, fontSize: 13 }}>
          No crops added yet. Tap &quot;Add crop&quot; to record what this farmer grows.
        </Text>
      )}
      {crops.map((c, idx) => (
        <View
          key={`${c.commodityId}-${idx}`}
          style={[styles.cropRow, { borderColor: colors.border, backgroundColor: colors.card }]}
        >
          <View style={{ flex: 1 }}>
            <Text style={{ color: colors.foreground, fontWeight: "600" }}>{c.name}</Text>
            <Text style={{ color: colors.mutedForeground, fontSize: 12, marginTop: 2 }}>
              {c.lastHarvestKg ? `Last harvest: ${c.lastHarvestKg} kg` : "No harvest recorded"}
              {c.lastHarvestDate ? ` · ${c.lastHarvestDate}` : ""}
            </Text>
          </View>
          <Pressable
            onPress={() => setCrops((prev) => prev.filter((_, i) => i !== idx))}
            style={({ pressed }) => [styles.removeBtn, { opacity: pressed ? 0.6 : 1 }]}
            testID={`complete-crop-remove-${idx}`}
          >
            <Feather name="x" size={18} color={colors.mutedForeground} />
          </Pressable>
        </View>
      ))}
      {showAddCrop ? (
        <View style={[styles.addCropCard, { borderColor: colors.border, backgroundColor: colors.card }]}>
          <Text style={[styles.fieldLabel, { color: colors.mutedForeground }]}>Pick a commodity</Text>
          {commodities.length === 0 ? (
            <Text style={{ color: colors.mutedForeground, fontSize: 13 }}>
              No commodities available. Ask an admin to add some.
            </Text>
          ) : (
            <View style={styles.chipRow}>
              {commodities
                .filter((c) => !crops.some((added) => added.commodityId === c.id))
                .map((c) => {
                  const active = pendingCommodityId === c.id;
                  return (
                    <Pressable
                      key={c.id}
                      onPress={() => setPendingCommodityId(active ? "" : c.id)}
                      style={({ pressed }) => [
                        styles.chip,
                        {
                          borderColor: active ? colors.primary : colors.border,
                          backgroundColor: active ? colors.primary : colors.background,
                          opacity: pressed ? 0.7 : 1,
                        },
                      ]}
                      testID={`complete-commodity-${c.id}`}
                    >
                      <Text style={{ color: active ? colors.primaryForeground : colors.foreground, fontWeight: active ? "600" : "500" }}>
                        {c.name}
                      </Text>
                    </Pressable>
                  );
                })}
            </View>
          )}
          <Field
            label="Last harvest (kg, optional)"
            value={pendingHarvestKg}
            onChangeText={setPendingHarvestKg}
            placeholder="120"
            keyboardType="number-pad"
            colors={colors}
            testID="complete-pending-harvest-kg"
          />
          <Field
            label="Last harvest date (YYYY-MM-DD, optional)"
            value={pendingHarvestDate}
            onChangeText={setPendingHarvestDate}
            placeholder="2025-12-10"
            keyboardType="numbers-and-punctuation"
            autoCapitalize="none"
            colors={colors}
            testID="complete-pending-harvest-date"
          />
          <View style={{ flexDirection: "row", gap: 8, marginTop: 4 }}>
            <Pressable
              onPress={() => {
                if (!pendingCommodityId) {
                  Alert.alert("Pick a commodity", "Tap one of the commodities above first.");
                  return;
                }
                if (pendingHarvestDate.trim() && !/^\d{4}-\d{2}-\d{2}$/.test(pendingHarvestDate.trim())) {
                  Alert.alert("Invalid date", "Use YYYY-MM-DD format (e.g. 2025-12-10).");
                  return;
                }
                const commodity = commodities.find((c) => c.id === pendingCommodityId);
                if (!commodity) return;
                setCrops((prev) => [
                  ...prev,
                  {
                    commodityId: commodity.id,
                    name: commodity.name,
                    lastHarvestKg: pendingHarvestKg.trim() || undefined,
                    lastHarvestDate: pendingHarvestDate.trim() || undefined,
                  },
                ]);
                setPendingCommodityId("");
                setPendingHarvestKg("");
                setPendingHarvestDate("");
                setShowAddCrop(false);
              }}
              style={({ pressed }) => [
                styles.smallBtn,
                { backgroundColor: colors.primary, opacity: pressed ? 0.7 : 1 },
              ]}
              testID="complete-save-crop"
            >
              <Text style={{ color: colors.primaryForeground, fontWeight: "600" }}>Save crop</Text>
            </Pressable>
            <Pressable
              onPress={() => {
                setPendingCommodityId("");
                setPendingHarvestKg("");
                setPendingHarvestDate("");
                setShowAddCrop(false);
              }}
              style={({ pressed }) => [
                styles.smallBtn,
                { backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border, opacity: pressed ? 0.7 : 1 },
              ]}
              testID="complete-cancel-crop"
            >
              <Text style={{ color: colors.foreground, fontWeight: "500" }}>Cancel</Text>
            </Pressable>
          </View>
        </View>
      ) : (
        <Pressable
          onPress={() => setShowAddCrop(true)}
          style={({ pressed }) => [
            styles.addBtn,
            { borderColor: colors.border, backgroundColor: colors.card, opacity: pressed ? 0.7 : 1 },
          ]}
          testID="complete-add-crop"
        >
          <Feather name="plus" size={18} color={colors.primary} />
          <Text style={{ color: colors.foreground, fontWeight: "500" }}>Add crop</Text>
        </Pressable>
      )}

      {/* ---------------- Other on-farm activities ---------------- */}
      <Text style={[styles.sectionLabel, { color: colors.foreground }]}>Other on-farm activities</Text>
      <MultiChoiceField
        values={otherActivities}
        onToggle={(v) =>
          setOtherActivities((prev) => (prev.includes(v) ? prev.filter((x) => x !== v) : [...prev, v]))
        }
        options={ACTIVITY_OPTIONS}
        colors={colors}
        testIDPrefix="complete-activity"
      />

      {/* ---------------- Livelihood ---------------- */}
      <Text style={[styles.sectionLabel, { color: colors.foreground }]}>Livelihood</Text>
      <Field
        label="Cultivated land (hectares)"
        value={cultivatedLandHa}
        onChangeText={setCultivatedLandHa}
        placeholder="1.5"
        keyboardType="numbers-and-punctuation"
        colors={colors}
        testID="complete-cultivated-land"
      />
      <ChoiceField
        label="Main off-farm income source"
        value={offFarmIncomeSource}
        onChange={setOffFarmIncomeSource}
        options={INCOME_SOURCE_OPTIONS}
        colors={colors}
        testIDPrefix="complete-income-source"
      />
      <Field
        label="Off-farm income, monthly (UGX)"
        value={offFarmIncomeMonthlyUgx}
        onChangeText={setOffFarmIncomeMonthlyUgx}
        placeholder="150000"
        keyboardType="number-pad"
        colors={colors}
        testID="complete-off-farm-income"
      />
      <Field
        label="Months of food shortage per year (0–12)"
        value={monthsOfFoodShortage}
        onChangeText={setMonthsOfFoodShortage}
        placeholder="2"
        keyboardType="number-pad"
        colors={colors}
        testID="complete-food-shortage"
      />
      <ChoiceField
        label="Education of head of household"
        value={educationLevelHead}
        onChange={setEducationLevelHead}
        options={EDUCATION_OPTIONS}
        colors={colors}
        testIDPrefix="complete-education"
      />
      <ChoiceField
        label="Access to clean water"
        value={accessCleanWater}
        onChange={(v) => setAccessCleanWater(v as typeof accessCleanWater)}
        options={YES_NO_OPTIONS}
        colors={colors}
        testIDPrefix="complete-water"
      />
      <ChoiceField
        label="Access to electricity"
        value={accessElectricity}
        onChange={(v) => setAccessElectricity(v as typeof accessElectricity)}
        options={YES_NO_OPTIONS}
        colors={colors}
        testIDPrefix="complete-electricity"
      />
      <ChoiceField
        label="Primary cooking fuel"
        value={primaryCookingFuel}
        onChange={setPrimaryCookingFuel}
        options={COOKING_FUEL_OPTIONS}
        colors={colors}
        testIDPrefix="complete-cooking-fuel"
      />

      <Pressable
        onPress={submit}
        disabled={submitting}
        style={({ pressed }) => [
          styles.submitBtn,
          { backgroundColor: colors.primary, opacity: pressed || submitting ? 0.7 : 1 },
        ]}
        testID="submit-complete"
      >
        {submitting ? (
          <ActivityIndicator size="small" color={colors.primaryForeground} />
        ) : (
          <Feather name="check" size={18} color={colors.primaryForeground} />
        )}
        <Text style={[styles.submitText, { color: colors.primaryForeground }]}>
          {submitting ? "Submitting…" : "Mark as fully registered"}
        </Text>
      </Pressable>
    </ScrollView>
  );
}

function Field({
  label,
  value,
  onChangeText,
  placeholder,
  keyboardType,
  autoCapitalize,
  colors,
  testID,
}: {
  label: string;
  value: string;
  onChangeText: (v: string) => void;
  placeholder?: string;
  keyboardType?: "default" | "phone-pad" | "number-pad" | "numbers-and-punctuation";
  autoCapitalize?: "none" | "characters" | "words" | "sentences";
  colors: ReturnType<typeof useColors>;
  testID?: string;
}) {
  return (
    <View style={styles.field}>
      <Text style={[styles.fieldLabel, { color: colors.mutedForeground }]}>{label}</Text>
      <TextInput
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={colors.mutedForeground}
        keyboardType={keyboardType ?? "default"}
        autoCapitalize={autoCapitalize ?? "words"}
        style={[styles.input, { borderColor: colors.border, color: colors.foreground, backgroundColor: colors.card }]}
        testID={testID}
      />
    </View>
  );
}

function ChoiceField({
  label,
  value,
  onChange,
  options,
  colors,
  testIDPrefix,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
  colors: ReturnType<typeof useColors>;
  testIDPrefix?: string;
}) {
  return (
    <View style={styles.field}>
      <Text style={[styles.fieldLabel, { color: colors.mutedForeground }]}>{label}</Text>
      <View style={styles.chipRow}>
        {options.map((opt) => {
          const active = value === opt.value;
          return (
            <Pressable
              key={opt.value}
              onPress={() => onChange(active ? "" : opt.value)}
              style={({ pressed }) => [
                styles.chip,
                {
                  borderColor: active ? colors.primary : colors.border,
                  backgroundColor: active ? colors.primary : colors.card,
                  opacity: pressed ? 0.7 : 1,
                },
              ]}
              testID={testIDPrefix ? `${testIDPrefix}-${opt.value}` : undefined}
            >
              <Text
                style={{
                  color: active ? colors.primaryForeground : colors.foreground,
                  fontWeight: active ? "600" : "500",
                }}
              >
                {opt.label}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

// Multi-select chip row. Like ChoiceField but holds an array of values; tapping a chip
// toggles its membership. Used for "Other on-farm activities".
function MultiChoiceField({
  values,
  onToggle,
  options,
  colors,
  testIDPrefix,
}: {
  values: string[];
  onToggle: (v: string) => void;
  options: { value: string; label: string }[];
  colors: ReturnType<typeof useColors>;
  testIDPrefix?: string;
}) {
  return (
    <View style={styles.field}>
      <View style={styles.chipRow}>
        {options.map((opt) => {
          const active = values.includes(opt.value);
          return (
            <Pressable
              key={opt.value}
              onPress={() => onToggle(opt.value)}
              style={({ pressed }) => [
                styles.chip,
                {
                  borderColor: active ? colors.primary : colors.border,
                  backgroundColor: active ? colors.primary : colors.card,
                  opacity: pressed ? 0.7 : 1,
                },
              ]}
              testID={testIDPrefix ? `${testIDPrefix}-${opt.value}` : undefined}
            >
              <Text
                style={{
                  color: active ? colors.primaryForeground : colors.foreground,
                  fontWeight: active ? "600" : "500",
                }}
              >
                {opt.label}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { paddingHorizontal: 20, gap: 12 },
  title: { fontSize: 24, fontWeight: "700" },
  subtitle: { fontSize: 14, marginBottom: 4 },
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
  backRow: { flexDirection: "row", alignItems: "center", gap: 4, marginBottom: 4 },
  field: { gap: 6 },
  fieldLabel: { fontSize: 12, fontWeight: "500", textTransform: "uppercase", letterSpacing: 0.4 },
  input: {
    borderWidth: 1,
    borderRadius: 8,
    paddingVertical: 10,
    paddingHorizontal: 12,
    fontSize: 15,
  },
  sectionLabel: { fontSize: 14, fontWeight: "600", marginTop: 8 },
  chipRow: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  chip: { borderWidth: 1, borderRadius: 999, paddingHorizontal: 14, paddingVertical: 8 },
  cropRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    borderWidth: 1,
    borderRadius: 8,
    paddingVertical: 10,
    paddingHorizontal: 12,
  },
  removeBtn: { padding: 6 },
  addCropCard: {
    borderWidth: 1,
    borderRadius: 8,
    padding: 12,
    gap: 10,
  },
  addBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    borderWidth: 1,
    borderStyle: "dashed",
    borderRadius: 8,
    paddingVertical: 10,
    paddingHorizontal: 12,
    justifyContent: "center",
  },
  smallBtn: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 8,
    paddingVertical: 10,
  },
  submitBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
    borderRadius: 10,
    paddingVertical: 14,
    marginTop: 16,
  },
  submitText: { fontSize: 16, fontWeight: "600" },
});
