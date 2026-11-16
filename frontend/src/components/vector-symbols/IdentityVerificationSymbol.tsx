import { View } from "react-native";

import { LightArtworkSurface } from "@/src/components/IconTile";
import { VectorSymbol } from "@/src/components/VectorSymbol";
import { useTheme } from "@/src/theme/ThemeProvider";
import { homeArtwork, lightQuickAccessArtwork } from "@/src/theme/tokens";

export function IdentityVerificationSymbol({ size = 28, verified = false }: { size?: number; verified?: boolean }) {
  const { colors } = useTheme();
  const artwork = <VectorSymbol name={verified ? "kyc-verified" : "restricted-access"}
    variant={verified ? undefined : "browser-shield"} size={size * 0.84}
    color={colors.isDark ? "#FFFFFF" : lightQuickAccessArtwork.iconInk} />;
  if (!colors.isDark) {
    return <LightArtworkSurface cornerRadius={size / 5} style={{ width: size, height: size }}>{artwork}</LightArtworkSurface>;
  }
  return (
    <View style={{ width: size, height: size, borderRadius: size / 5, alignItems: "center",
      justifyContent: "center", backgroundColor: homeArtwork.kycIconFill }} aria-hidden>
      {artwork}
    </View>
  );
}
