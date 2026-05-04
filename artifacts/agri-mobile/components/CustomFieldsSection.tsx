import React from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";

import type { TemplateField } from "@/lib/registration-template";
import { selectCustomFields } from "@/lib/registration-template";

type Colors = {
  background: string;
  foreground: string;
  card: string;
  border: string;
  primary: string;
  primaryForeground: string;
  muted: string;
  mutedForeground: string;
};

type Props = {
  fields: TemplateField[];
  values: Record<string, string>;
  onChange: (key: string, value: string) => void;
  colors: Colors;
  testIDPrefix?: string;
};

// Renders the admin-defined custom registration fields. Mirrors the look of
// the existing Field/ChoiceField widgets in register.tsx + complete.tsx but
// is self-contained so the same component drops into both screens. Submitted
// values are always strings — for multichoice we comma-join (the server
// re-splits on read). Number/date validation is loose by design — the server
// is the authority and will round-trip whatever we send into the value column.
export default function CustomFieldsSection({ fields, values, onChange, colors, testIDPrefix = "custom" }: Props) {
  const customFields = selectCustomFields(fields);
  if (customFields.length === 0) return null;
  return (
    <View>
      <Text style={[styles.sectionLabel, { color: colors.foreground }]}>Additional information</Text>
      {customFields.map((f) => (
        <CustomField
          key={f.fieldKey}
          field={f}
          value={values[f.fieldKey] ?? ""}
          onChange={(v) => onChange(f.fieldKey, v)}
          colors={colors}
          testIDPrefix={testIDPrefix}
        />
      ))}
    </View>
  );
}

function CustomField({
  field,
  value,
  onChange,
  colors,
  testIDPrefix,
}: {
  field: TemplateField;
  value: string;
  onChange: (v: string) => void;
  colors: Colors;
  testIDPrefix: string;
}) {
  const label = `${field.label}${field.required ? " *" : ""}`;
  const tid = `${testIDPrefix}-${field.fieldKey}`;
  if (field.fieldType === "yesno") {
    return (
      <ChipRow
        label={label}
        value={value}
        options={[
          { value: "yes", label: "Yes" },
          { value: "no", label: "No" },
        ]}
        onChange={onChange}
        colors={colors}
        testIDPrefix={tid}
      />
    );
  }
  if (field.fieldType === "choice") {
    return (
      <ChipRow
        label={label}
        value={value}
        options={field.options ?? []}
        onChange={onChange}
        colors={colors}
        testIDPrefix={tid}
      />
    );
  }
  if (field.fieldType === "multichoice") {
    const selected = value ? value.split(",").map((s) => s.trim()).filter(Boolean) : [];
    return (
      <View style={{ marginTop: 12 }}>
        <Text style={[styles.label, { color: colors.foreground }]}>{label}</Text>
        <View style={styles.chipRow}>
          {(field.options ?? []).map((opt) => {
            const active = selected.includes(opt.value);
            return (
              <Pressable
                key={opt.value}
                onPress={() => {
                  const next = active ? selected.filter((s) => s !== opt.value) : [...selected, opt.value];
                  onChange(next.join(","));
                }}
                style={[
                  styles.chip,
                  {
                    backgroundColor: active ? colors.primary : colors.card,
                    borderColor: active ? colors.primary : colors.border,
                  },
                ]}
                testID={`${tid}-${opt.value}`}
              >
                <Text style={{ color: active ? colors.primaryForeground : colors.foreground }}>{opt.label}</Text>
              </Pressable>
            );
          })}
        </View>
      </View>
    );
  }
  // text / number / date — all rendered as a TextInput with hint keyboard.
  const keyboardType =
    field.fieldType === "number" ? ("number-pad" as const) :
    field.fieldType === "date" ? ("numbers-and-punctuation" as const) :
    ("default" as const);
  const placeholder =
    field.fieldType === "date" ? "YYYY-MM-DD" :
    field.fieldType === "number" ? "0" :
    "";
  return (
    <View style={{ marginTop: 12 }}>
      <Text style={[styles.label, { color: colors.foreground }]}>{label}</Text>
      <TextInput
        value={value}
        onChangeText={onChange}
        placeholder={placeholder}
        placeholderTextColor={colors.mutedForeground}
        keyboardType={keyboardType}
        autoCapitalize="none"
        style={[
          styles.input,
          { borderColor: colors.border, color: colors.foreground, backgroundColor: colors.card },
        ]}
        testID={tid}
      />
    </View>
  );
}

function ChipRow({
  label,
  value,
  options,
  onChange,
  colors,
  testIDPrefix,
}: {
  label: string;
  value: string;
  options: { value: string; label: string }[];
  onChange: (v: string) => void;
  colors: Colors;
  testIDPrefix: string;
}) {
  return (
    <View style={{ marginTop: 12 }}>
      <Text style={[styles.label, { color: colors.foreground }]}>{label}</Text>
      <View style={styles.chipRow}>
        {options.map((opt) => {
          const active = value === opt.value;
          return (
            <Pressable
              key={opt.value}
              onPress={() => onChange(active ? "" : opt.value)}
              style={[
                styles.chip,
                {
                  backgroundColor: active ? colors.primary : colors.card,
                  borderColor: active ? colors.primary : colors.border,
                },
              ]}
              testID={`${testIDPrefix}-${opt.value}`}
            >
              <Text style={{ color: active ? colors.primaryForeground : colors.foreground }}>{opt.label}</Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  sectionLabel: { marginTop: 24, marginBottom: 4, fontSize: 14, fontWeight: "700", textTransform: "uppercase", letterSpacing: 0.5 },
  label: { fontSize: 14, fontWeight: "500", marginBottom: 6 },
  input: { borderWidth: 1, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, fontSize: 16 },
  chipRow: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  chip: { paddingVertical: 8, paddingHorizontal: 14, borderRadius: 999, borderWidth: 1 },
});
