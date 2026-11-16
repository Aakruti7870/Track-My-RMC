import React from "react";
import { Pressable, StyleSheet, View, useWindowDimensions } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useRouter, type Href } from "expo-router";

import { AppText } from "@/src/components/ui/AppText";
import { CardHighlight } from "@/src/components/ui/CardHighlight";
import { IconTile } from "@/src/components/IconTile";
import type { RoleModule } from "@/src/navigation/moduleCatalog";
import { useTheme } from "@/src/theme/ThemeProvider";
import { fonts, radius } from "@/src/theme/tokens";

export function HomeSectionHeader({ title, seeAll, testID }: { title: string; seeAll?: Href; testID?: string }) {
  const router = useRouter();
  const { colors } = useTheme();
  return (
    <View style={styles.heading}>
      <AppText accessibilityRole="header" style={styles.title}>{title}</AppText>
      {seeAll ? (
        <Pressable testID={testID} accessibilityRole="button" accessibilityLabel={`See all ${title}`}
          onPress={() => router.push(seeAll)} style={({ pressed }) => [styles.link, { opacity: pressed ? 0.7 : 1 }]}>
          <AppText style={styles.linkLabel} color={colors.accentText}>See All</AppText>
          <Ionicons name="chevron-forward" size={14} color={colors.accentText} accessible={false} aria-hidden />
        </Pressable>
      ) : null}
    </View>
  );
}

export function HomeModuleSection({ id, title, modules, seeAll, homeShortcut = false, testIDPrefix = "role-module-" }: {
  id: string; title: string; modules: readonly RoleModule[]; seeAll?: Href; homeShortcut?: boolean; testIDPrefix?: string;
}) {
  const { colors } = useTheme();
  const router = useRouter();
  const { width, fontScale } = useWindowDimensions();
  const compact = (width - 32) / fontScale < (homeShortcut ? 250 : 350);
  if (!modules.length) return null;
  return (
    <View testID={`home-modules-${id}`} style={[styles.section, { backgroundColor: colors.surfaceSecondary, borderColor: colors.divider }]}>
      {(!homeShortcut || colors.isDark) ? <CardHighlight radius={radius.lg} /> : null}
      <HomeSectionHeader title={title} seeAll={seeAll} testID={`home-see-all-${id}`} />
      <View style={styles.grid}>
        {modules.map(module => (
          <Pressable key={module.key} testID={testIDPrefix + module.key} accessibilityRole="button"
            accessibilityLabel={module.label} accessibilityHint={module.description}
            onPress={() => router.push(module.route)}
            style={({ pressed }) => [styles.tile, { width: compact ? "48%" : "23.5%", opacity: pressed ? 0.74 : 1 }]}>
            {module.symbol ? <IconTile symbol={module.symbol} quickAccess={homeShortcut} /> : <IconTile icon={module.icon} quickAccess={homeShortcut} />}
            <AppText center style={[styles.label, homeShortcut && styles.quickLabel]}>{module.label}</AppText>
          </Pressable>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  section: { borderRadius: radius.lg, borderWidth: 1, paddingHorizontal: 10, paddingBottom: 10, gap: 4 },
  heading: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8, minHeight: 44 },
  title: { flexShrink: 1, fontFamily: fonts.semibold, fontSize: 15, lineHeight: 20 },
  link: { flexDirection: "row", alignItems: "center", gap: 3, minHeight: 44, paddingHorizontal: 4 },
  linkLabel: { fontFamily: fonts.semibold, fontSize: 12, lineHeight: 16 },
  grid: { flexDirection: "row", flexWrap: "wrap", columnGap: "2%", rowGap: 8 },
  tile: { minHeight: 76, minWidth: 0, paddingHorizontal: 2, paddingVertical: 4, gap: 6, alignItems: "center" },
  quickLabel: { fontSize: 11, lineHeight: 15 },
  label: { fontFamily: fonts.medium, fontSize: 12, lineHeight: 16, maxWidth: "100%" },
});
