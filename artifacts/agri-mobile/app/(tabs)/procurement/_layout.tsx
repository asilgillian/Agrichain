import { Stack } from "expo-router";

import { useColors } from "@/hooks/useColors";

export default function ProcurementLayout() {
  const colors = useColors();
  return (
    <Stack
      screenOptions={{
        headerStyle: { backgroundColor: colors.background },
        headerTintColor: colors.foreground,
        contentStyle: { backgroundColor: colors.background },
      }}
    >
      <Stack.Screen name="index" options={{ title: "Procurement" }} />
      <Stack.Screen name="deliveries/new" options={{ title: "Capture delivery" }} />
      <Stack.Screen name="batches/new" options={{ title: "New batch" }} />
      <Stack.Screen name="batch/[id]" options={{ title: "Batch" }} />
      <Stack.Screen name="delivery/[id]" options={{ title: "Delivery" }} />
    </Stack>
  );
}
