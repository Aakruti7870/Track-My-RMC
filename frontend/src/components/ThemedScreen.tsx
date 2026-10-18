import React, { type PropsWithChildren } from "react";
import { ImageBackground, StyleSheet } from "react-native";
import { useTheme } from "@/src/theme/ThemeProvider";
import { getThemedCanvasColor } from "@/src/theme/sceneBackground";

/**
 * Customer tab wallpaper: its own opaque canvas + 35% theme image.
 * The previous tab is never used as the new tab's background.
 */
export function ThemedScreen({ children }: PropsWithChildren) {
  const { colors } = useTheme();
  return (
    <ImageBackground
      source={colors.isDark
        ? require("../../assets/images/Background Dark Theme.png")
        : require("../../assets/images/Background Light Theme.png")}
      resizeMode="cover"
      imageStyle={styles.artwork}
      style={[styles.root, { backgroundColor: getThemedCanvasColor(colors) }]}
    >
      {children}
    </ImageBackground>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  artwork: { opacity: 0.35 },
});
