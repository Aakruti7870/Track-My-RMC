import { View } from "react-native";
import { useLocalSearchParams } from "expo-router";

import { BusinessModule } from "@/src/screens/BusinessModule";

export default function BusinessModuleRoute() {
  const { kind } = useLocalSearchParams<{ kind?: string }>();
  return (
    <View style={{ flex: 1 }}>
      <BusinessModule kind={typeof kind === "string" ? kind : "reports"} />
    </View>
  );
}
