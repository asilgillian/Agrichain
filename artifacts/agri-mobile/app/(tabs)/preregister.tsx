import { Feather } from "@expo/vector-icons";
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

import { useColors } from "@/hooks/useColors";

// Resolve the API base. EXPO_PUBLIC_API_URL is the canonical override; otherwise
// fall back to the workspace dev domain so local web builds at least hit the right host.
// NOTE: Mobile auth is not yet wired to Clerk — requests to gated endpoints will return 401
// until the auth bridge lands. The UI flow below is fully functional and ready for that step.
const API_BASE =
  process.env.EXPO_PUBLIC_API_URL ??
  (typeof process !== "undefined" && (process as any).env?.REPLIT_DEV_DOMAIN
    ? `https://${(process as any).env.REPLIT_DEV_DOMAIN}/api-server`
    : "");

type Coords = { latitude: number; longitude: number; accuracy: number | null };

export default function PreregisterScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [phoneNumber, setPhoneNumber] = useState("+256");
  const [village, setVillage] = useState("");
  const [groupId, setGroupId] = useState("");
  const [regionId, setRegionId] = useState("");
  const [coords, setCoords] = useState<Coords | null>(null);
  const [locating, setLocating] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  // Capture the agent's current GPS as a single-point plot location. Permission is
  // requested on the fly; if the user denies we surface a clear native alert.
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

  const submit = async () => {
    if (!firstName.trim() || !lastName.trim() || !groupId.trim() || !regionId.trim()) {
      Alert.alert("Missing fields", "First name, last name, group id and region id are required.");
      return;
    }
    setSubmitting(true);
    try {
      // 1. Pre-register the farmer.
      const farmerBody: Record<string, unknown> = {
        firstName: firstName.trim(),
        lastName: lastName.trim(),
        groupId: groupId.trim(),
        regionId: regionId.trim(),
      };
      if (phoneNumber.trim() && phoneNumber.trim() !== "+256") farmerBody.phoneNumber = phoneNumber.trim();
      if (village.trim()) farmerBody.village = village.trim();

      const farmerRes = await fetch(`${API_BASE}/api/farmers/preregister`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(farmerBody),
      });
      if (!farmerRes.ok) {
        const text = await farmerRes.text();
        throw new Error(`Farmer pre-register failed (${farmerRes.status}): ${text.slice(0, 200)}`);
      }
      const farmer = await farmerRes.json();

      // 2. If the agent dropped a pin, create the plot too.
      if (coords) {
        const plotRes = await fetch(`${API_BASE}/api/plots`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            farmerId: farmer.id,
            cropType: "Unknown",
            areaHectares: 0,
            polygon: { type: "Point", coordinates: [coords.longitude, coords.latitude] },
          }),
        });
        if (!plotRes.ok) {
          const text = await plotRes.text();
          // Non-fatal: farmer was created, but plot failed.
          Alert.alert("Plot pin failed", `Farmer was created, but the plot pin couldn't be saved: ${text.slice(0, 200)}`);
        }
      }

      Alert.alert("Done", `Pre-registered ${farmer.firstName} ${farmer.lastName}`);
      // Reset for next entry.
      setFirstName("");
      setLastName("");
      setPhoneNumber("+256");
      setVillage("");
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
      <Text style={[styles.title, { color: colors.foreground }]}>Pre-register Farmer</Text>
      <Text style={[styles.subtitle, { color: colors.mutedForeground }]}>
        Capture the bare minimum in the field. Full KYC details can be completed later from the web console.
      </Text>

      {/* Auth gap warning — mobile API calls will currently 401 until Clerk auth is wired. */}
      <View style={[styles.warning, { borderColor: "#f59e0b", backgroundColor: "rgba(245, 158, 11, 0.1)" }]}>
        <Feather name="alert-triangle" size={18} color="#b45309" />
        <Text style={[styles.warningText, { color: colors.foreground }]}>
          Mobile sign-in isn't wired up yet — submissions will fail with 401 until that lands. The form is ready for it.
        </Text>
      </View>

      <Field label="First name *" value={firstName} onChangeText={setFirstName} placeholder="Mary" colors={colors} testID="pre-first-name" />
      <Field label="Last name *" value={lastName} onChangeText={setLastName} placeholder="Nakato" colors={colors} testID="pre-last-name" />
      <Field label="Phone" value={phoneNumber} onChangeText={setPhoneNumber} placeholder="+256..." keyboardType="phone-pad" colors={colors} testID="pre-phone" />
      <Field label="Village" value={village} onChangeText={setVillage} placeholder="Kabale" colors={colors} testID="pre-village" />
      <Field label="Group ID *" value={groupId} onChangeText={setGroupId} placeholder="Paste group UUID" colors={colors} testID="pre-group" />
      <Field label="Region ID *" value={regionId} onChangeText={setRegionId} placeholder="Paste region UUID" colors={colors} testID="pre-region" />

      <Text style={[styles.sectionLabel, { color: colors.foreground }]}>Plot location (optional)</Text>
      <Pressable
        onPress={useMyLocation}
        disabled={locating}
        style={({ pressed }) => [
          styles.locationBtn,
          { borderColor: colors.border, backgroundColor: colors.card, opacity: pressed ? 0.7 : 1 },
        ]}
        testID="use-my-location"
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
        testID="submit-preregister"
      >
        {submitting ? (
          <ActivityIndicator size="small" color={colors.primaryForeground} />
        ) : (
          <Feather name="user-plus" size={18} color={colors.primaryForeground} />
        )}
        <Text style={[styles.submitText, { color: colors.primaryForeground }]}>
          {submitting ? "Submitting…" : "Pre-register farmer"}
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
  colors,
  testID,
}: {
  label: string;
  value: string;
  onChangeText: (v: string) => void;
  placeholder?: string;
  keyboardType?: "default" | "phone-pad";
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
        autoCapitalize="words"
        style={[styles.input, { borderColor: colors.border, color: colors.foreground, backgroundColor: colors.card }]}
        testID={testID}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    paddingHorizontal: 20,
    gap: 12,
  },
  title: {
    fontSize: 24,
    fontWeight: "700",
  },
  subtitle: {
    fontSize: 14,
    marginBottom: 8,
  },
  warning: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 10,
    padding: 12,
    borderRadius: 8,
    borderWidth: 1,
    marginBottom: 8,
  },
  warningText: {
    flex: 1,
    fontSize: 13,
    lineHeight: 18,
  },
  field: { gap: 6 },
  fieldLabel: { fontSize: 12, fontWeight: "500", textTransform: "uppercase", letterSpacing: 0.4 },
  input: {
    borderWidth: 1,
    borderRadius: 8,
    paddingVertical: 10,
    paddingHorizontal: 12,
    fontSize: 15,
  },
  sectionLabel: {
    fontSize: 14,
    fontWeight: "600",
    marginTop: 8,
  },
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
