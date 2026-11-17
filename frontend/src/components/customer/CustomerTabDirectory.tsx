import { VectorSymbol } from "@/src/components/VectorSymbol";
import { useRouter } from "expo-router";
import { Pressable, ScrollView, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { IconTile } from "@/src/components/IconTile";
import { ThemedScreen } from "@/src/components/ThemedScreen";
import { AppText } from "@/src/components/ui/AppText";
import type { HomeLink } from "@/src/navigation/customerHome";
import { useTheme } from "@/src/theme/ThemeProvider";
import { radius, spacing } from "@/src/theme/tokens";

export function CustomerTabDirectory({ title, testID, sections }: {
  title: string;
  testID: string;
  sections: readonly { title: string; links: readonly HomeLink[] }[];
}) {
  const { colors } = useTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  return (
    <ThemedScreen>
      <ScrollView testID={testID} showsVerticalScrollIndicator={false}
        contentContainerStyle={[styles.content, { paddingTop: insets.top + spacing.lg }]}>
        <AppText accessibilityRole="header" variant="title">{title}</AppText>
        {sections.map(section => (
          <View key={section.title} style={styles.section}>
            <AppText accessibilityRole="header" variant="heading">{section.title}</AppText>
            <View style={[styles.panel, { backgroundColor: colors.surfaceSecondary, borderColor: colors.border }]}>
              {section.links.map((link, index) => (
                <Pressable key={link.key} testID={`customer-directory-${link.key}`}
                  accessibilityRole="button" accessibilityLabel={link.label} onPress={() => router.push(link.route)}
                  style={({ pressed }) => [styles.row, {
                    borderTopColor: colors.divider,
                    borderTopWidth: index === 0 ? 0 : StyleSheet.hairlineWidth,
                    opacity: pressed ? 0.72 : 1,
                  }]}>
                  <IconTile symbol={link.symbol} width={36} />
                  <View style={styles.copy}>
                    <AppText variant="label">{link.label}</AppText>
                    {link.hint ? <AppText variant="caption">{link.hint}</AppText> : null}
                  </View>
                  <VectorSymbol name="chevron-right" size={17} color={colors.onSurfaceTertiary} />
                </Pressable>
              ))}
            </View>
          </View>
        ))}
      </ScrollView>
    </ThemedScreen>
  );
}

const styles = StyleSheet.create({
  content: { width: "100%", maxWidth: 760, alignSelf: "center", paddingHorizontal: spacing.lg, paddingBottom: spacing.xl, gap: spacing.lg },
  section: { gap: spacing.sm },
  panel: { borderWidth: 1, borderRadius: radius.lg, paddingHorizontal: spacing.md },
  row: { flexDirection: "row", alignItems: "center", minHeight: 56, paddingVertical: spacing.sm, gap: spacing.md },
  copy: { flex: 1, minWidth: 0, gap: 2 },
});
