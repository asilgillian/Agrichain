import { Feather } from "@expo/vector-icons";
import { useAuth } from "@clerk/expo";
import * as Location from "expo-location";
import React, { useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { OrgRegionGroupVillagePicker } from "@/components/OrgRegionGroupVillagePicker";
import { useColors } from "@/hooks/useColors";

const API_BASE =
  process.env.EXPO_PUBLIC_API_URL ??
  (process.env.EXPO_PUBLIC_DOMAIN
    ? `https://${process.env.EXPO_PUBLIC_DOMAIN}`
    : "");

type Coords = { latitude: number; longitude: number; accuracy: number | null };

// One-shot full registration: agent captures everything (location pick + KYC) in one
// visit and the resulting farmer is immediately marked fully_registered. Compare to
// preregister.tsx, which captures the bare minimum and defers KYC to /complete.
export default function RegisterScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { getToken } = useAuth();

  // Identity
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [nationalId, setNationalId] = useState("");
  const [dateOfBirth, setDateOfBirth] = useState(""); // YYYY-MM-DD
  const [sex, setSex] = useState<"" | "male" | "female" | "other">("");
  const [phoneNumber, setPhoneNumber] = useState("+256");

  // Location (3-dropdown picker)
  const [orgRegionId, setOrgRegionId] = useState("");
  const [groupId, setGroupId] = useState("");
  const [regionId, setRegionId] = useState(""); // selected village id

  // Household
  const [householdSize, setHouseholdSize] = useState("");
  const [dependants, setDependants] = useState("");
  const [headOfHousehold, setHeadOfHousehold] = useState("");
  const [landTenure, setLandTenure] = useState<"" | "Owned" | "Rented" | "Inherited" | "Other">("");

  // Optional GPS pin → becomes a single-Point plot for the new farmer.
  const [coords, setCoords] = useState<Coords | null>(null);
  const [locating, setLocating] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const useMyLocation = async () => {
    try {
      setLocating(true);
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== "granted") {
        Alert.alert("Permission denied", "Location access is required to drop a plot pin.");
        return;
      }
      const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High });
      setCoords({
        latitude: loc.coords.latitude,
        longitude: loc.coords.longitude,
        accuracy: loc.coords.accuracy ?? null,
      });
    } catch (e: any) {
      Alert.alert("Couldn't get location", e?.message ?? "Unknown error");
    } finally {
      setLocating(false);
    }
  };

  // Translate org-region binding error codes (and the few /farmers-specific ones)
  // into language a field agent can act on.
  const friendlyError = (code?: string, fallback?: string) => {
    switch (code) {
      case "GROUP_REQUIRED":
        return "Please pick a farmer group.";
      case "GROUP_NOT_FOUND":
        return "The selected group no longer exists. Pick another.";
      case "GROUP_ARCHIVED":
        return "The selected group has been archived. Pick an active one.";
      case "REGION_NOT_LEAF":
        return "Pick a specific village (deepest level), not a parent area.";
      case "REGION_REQUIRED":
        return "Please pick a village.";
      case "VILLAGE_OUT_OF_ORG_REGION":
        return "The picked village is not inside the selected region. Adjust your picks.";
      case "GROUP_OUT_OF_ORG_REGION":
        return "The picked group is not inside the selected region. Adjust your picks.";
      default:
        return fallback ?? "Submission failed.";
    }
  };

  const submit = async () => {
    if (!firstName.trim() || !lastName.trim()) {
      Alert.alert("Missing fields", "First name and last name are required.");
      return;
    }
    if (!nationalId.trim()) {
      Alert.alert("Missing field", "National ID is required for full registration.");
      return;
    }
    if (!orgRegionId || !groupId || !regionId) {
      Alert.alert("Missing fields", "Region, group and village are all required.");
      return;
    }
    if (dateOfBirth && !/^\d{4}-\d{2}-\d{2}$/.test(dateOfBirth.trim())) {
      Alert.alert("Invalid date", "Date of birth must be in YYYY-MM-DD format (e.g. 1990-04-25).");
      return;
    }

    setSubmitting(true);
    try {
      const token = await getToken();
      const authHeaders: Record<string, string> = {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      };

      // Build the body. CreateFarmerBody requires firstName/lastName/nationalId/
      // groupId/regionId. orgRegionId is read separately by the route to enforce
      // the same containment checks as /preregister. Optional fields are omitted
      // when empty so the server keeps its defaults.
      const body: Record<string, unknown> = {
        firstName: firstName.trim(),
        lastName: lastName.trim(),
        nationalId: nationalId.trim(),
        groupId,
        regionId,
        orgRegionId,
      };
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

      const farmerRes = await fetch(`${API_BASE}/api/farmers`, {
        method: "POST",
        headers: authHeaders,
        body: JSON.stringify(body),
      });
      if (!farmerRes.ok) {
        let code: string | undefined;
        let serverError: string | undefined;
        try {
          const j = await farmerRes.json();
          code = typeof j?.code === "string" ? j.code : undefined;
          serverError = typeof j?.error === "string" ? j.error : undefined;
        } catch {
          /* non-JSON */
        }
        Alert.alert("Couldn't register farmer", friendlyError(code, serverError));
        return;
      }
      const farmer = await farmerRes.json();

      // Optional plot pin — same non-fatal pattern as preregister.
      if (coords) {
        const plotRes = await fetch(`${API_BASE}/api/plots`, {
          method: "POST",
          headers: authHeaders,
          body: JSON.stringify({
            farmerId: farmer.id,
            cropType: "Unknown",
            areaHectares: 0,
            polygon: { type: "Point", coordinates: [coords.longitude, coords.latitude] },
          }),
        });
        if (!plotRes.ok) {
          const text = await plotRes.text();
          Alert.alert(
            "Plot pin failed",
            `Farmer was created, but the plot pin couldn't be saved: ${text.slice(0, 200)}`,
          );
        }
      }

      Alert.alert("Done", `Registered ${farmer.firstName} ${farmer.lastName}.`);
      // Reset the per-farmer fields. Keep Region/Group so the next farmer in the
      // same group can be added quickly; clear village to force a re-pick.
      setFirstName("");
      setLastName("");
      setNationalId("");
      setDateOfBirth("");
      setSex("");
      setPhoneNumber("+256");
      setRegionId("");
      setHouseholdSize("");
      setDependants("");
      setHeadOfHousehold("");
      setLandTenure("");
      setCoords(null);
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
      <Text style={[styles.title, { color: colors.foreground }]}>Register Farmer</Text>
      <Text style={[styles.subtitle, { color: colors.mutedForeground }]}>
        Capture identity, KYC and location in a single visit. The farmer will be marked fully registered immediately.
      </Text>

      <Text style={[styles.sectionLabel, { color: colors.foreground }]}>Identity</Text>
      <Field label="First name *" value={firstName} onChangeText={setFirstName} placeholder="Mary" colors={colors} testID="reg-first-name" />
      <Field label="Last name *" value={lastName} onChangeText={setLastName} placeholder="Nakato" colors={colors} testID="reg-last-name" />
      <Field
        label="National ID *"
        value={nationalId}
        onChangeText={setNationalId}
        placeholder="CM12345678ABCD"
        autoCapitalize="characters"
        colors={colors}
        testID="reg-national-id"
      />
      <Field
        label="Date of birth (YYYY-MM-DD)"
        value={dateOfBirth}
        onChangeText={setDateOfBirth}
        placeholder="1990-04-25"
        keyboardType="numbers-and-punctuation"
        autoCapitalize="none"
        colors={colors}
        testID="reg-dob"
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
        testIDPrefix="reg-sex"
      />
      <Field
        label="Phone"
        value={phoneNumber}
        onChangeText={setPhoneNumber}
        placeholder="+256..."
        keyboardType="phone-pad"
        colors={colors}
        testID="reg-phone"
      />

      <Text style={[styles.sectionLabel, { color: colors.foreground }]}>Location</Text>
      <OrgRegionGroupVillagePicker
        orgRegionId={orgRegionId}
        groupId={groupId}
        villageId={regionId}
        onChange={({ orgRegionId: r, groupId: g, villageId: v }) => {
          setOrgRegionId(r);
          setGroupId(g);
          setRegionId(v);
        }}
        testIDPrefix="reg"
      />

      <Text style={[styles.sectionLabel, { color: colors.foreground }]}>Household</Text>
      <Field
        label="Household size"
        value={householdSize}
        onChangeText={setHouseholdSize}
        placeholder="5"
        keyboardType="number-pad"
        colors={colors}
        testID="reg-household-size"
      />
      <Field
        label="Dependants"
        value={dependants}
        onChangeText={setDependants}
        placeholder="3"
        keyboardType="number-pad"
        colors={colors}
        testID="reg-dependants"
      />
      <Field
        label="Head of household"
        value={headOfHousehold}
        onChangeText={setHeadOfHousehold}
        placeholder="Self / Spouse / Parent…"
        colors={colors}
        testID="reg-head-of-household"
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
        testIDPrefix="reg-land-tenure"
      />

      <Text style={[styles.sectionLabel, { color: colors.foreground }]}>Plot location (optional)</Text>
      <Pressable
        onPress={useMyLocation}
        disabled={locating}
        style={({ pressed }) => [
          styles.locationBtn,
          { borderColor: colors.border, backgroundColor: colors.card, opacity: pressed ? 0.7 : 1 },
        ]}
        testID="reg-use-my-location"
      >
        {locating ? (
          <ActivityIndicator size="small" color={colors.primary} />
        ) : (
          <Feather name="map-pin" size={18} color={colors.primary} />
        )}
        <Text style={[styles.locationBtnText, { color: colors.foreground }]}>
          {locating ? "Getting location…" : coords ? "Update GPS pin" : "Use my location"}
        </Text>
      </Pressable>
      {coords && (
        <View style={[styles.coordsCard, { borderColor: colors.border, backgroundColor: colors.card }]}>
          <Text style={[styles.coordsLine, { color: colors.foreground }]}>
            Lat {coords.latitude.toFixed(5)}, Lng {coords.longitude.toFixed(5)}
          </Text>
          {coords.accuracy != null && (
            <Text style={[styles.coordsAccuracy, { color: colors.mutedForeground }]}>±{Math.round(coords.accuracy)}m</Text>
          )}
        </View>
      )}

      <Pressable
        onPress={submit}
        disabled={submitting}
        style={({ pressed }) => [
          styles.submitBtn,
          { backgroundColor: colors.primary, opacity: pressed || submitting ? 0.7 : 1 },
        ]}
        testID="submit-register"
      >
        {submitting ? (
          <ActivityIndicator size="small" color={colors.primaryForeground} />
        ) : (
          <Feather name="user-check" size={18} color={colors.primaryForeground} />
        )}
        <Text style={[styles.submitText, { color: colors.primaryForeground }]}>
          {submitting ? "Submitting…" : "Register farmer"}
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

const styles = StyleSheet.create({
  container: { paddingHorizontal: 20, gap: 12 },
  title: { fontSize: 24, fontWeight: "700" },
  subtitle: { fontSize: 14, marginBottom: 8 },
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
  locationBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    borderWidth: 1,
    borderRadius: 8,
    paddingVertical: 12,
    paddingHorizontal: 14,
  },
  locationBtnText: { fontSize: 15, fontWeight: "500" },
  coordsCard: {
    borderWidth: 1,
    borderRadius: 8,
    padding: 12,
    gap: 4,
  },
  coordsLine: { fontSize: 14, fontWeight: "500" },
  coordsAccuracy: { fontSize: 12 },
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
