import { View } from "react-native";
import { useLocalSearchParams } from "expo-router";

import { BusinessModule } from "@/src/screens/BusinessModule";

export default function BusinessModuleRoute() {
  const { kind, plantId, material } = useLocalSearchParams<{ kind?: string; plantId?: string; material?: string }>();
  return (
    <View style={{ flex: 1 }}>
      <BusinessModule key={JSON.stringify([kind, plantId, material])} kind={typeof kind === "string" ? kind : "reports"}
        preferredPlant={typeof plantId === "string" ? plantId : undefined}
        material={typeof material === "string" ? material : undefined} />
    </View>
  );
}
