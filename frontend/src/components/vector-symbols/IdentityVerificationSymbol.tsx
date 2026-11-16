import { View } from "react-native";

import { VectorSymbol } from "@/src/components/VectorSymbol";
import { homeArtwork } from "@/src/theme/tokens";

export function IdentityVerificationSymbol({ size = 28 }: { size?: number }) {
  return (
    <View style={{ width: size, height: size, borderRadius: size / 5, alignItems: "center",
      justifyContent: "center", backgroundColor: homeArtwork.kycIconFill }} aria-hidden>
      <VectorSymbol name="restricted-access" variant="browser-shield" size={size * 0.84} color="#FFFFFF" />
    </View>
  );
}
