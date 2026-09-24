import { useLocalSearchParams } from "expo-router";

import { BusinessModule } from "@/src/screens/BusinessModule";

export default function BusinessModuleRoute() {
  const { kind } = useLocalSearchParams<{ kind?: string }>();
  return <BusinessModule kind={typeof kind === "string" ? kind : "reports"} />;
}
