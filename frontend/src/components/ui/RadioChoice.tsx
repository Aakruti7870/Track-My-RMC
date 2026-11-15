import { Ionicons } from "@expo/vector-icons";
import { StyleSheet, View } from "react-native";
import { TouchableRipple, useTheme as usePaperTheme, type MD3Theme } from "react-native-paper";

import { radius, spacing } from "@/src/theme/tokens";
import { AppText } from "./AppText";

type Props = {
  label: string;
  description?: string;
  checked: boolean;
  disabled?: boolean;
  onPress: () => void;
  testID?: string;
};

export function RadioChoice({ label, description, checked, disabled, onPress, testID }: Props) {
  const { colors } = usePaperTheme<MD3Theme>();
  const foreground = disabled ? colors.onSurfaceDisabled : checked ? colors.primary : colors.onSurfaceVariant;

  return (
    <TouchableRipple
      testID={testID}
      accessibilityRole="radio"
      accessibilityLabel={label}
      accessibilityHint={description}
      accessibilityState={{ checked, disabled }}
      disabled={disabled}
      onPress={onPress}
      style={[
        styles.choice,
        {
          backgroundColor: disabled ? colors.surfaceDisabled : checked ? colors.primaryContainer : colors.surface,
          borderColor: checked && !disabled ? colors.primary : colors.outline,
        },
      ]}
    >
      <View style={styles.content}>
        <Ionicons
          name={checked ? "radio-button-on" : "radio-button-off"}
          size={22}
          color={foreground}
          importantForAccessibility="no"
        />
        <View style={styles.copy}>
          <AppText variant="body" maxFontSizeMultiplier={0} color={disabled ? foreground : undefined}>
            {label}
          </AppText>
          {description ? (
            <AppText variant="caption" maxFontSizeMultiplier={0} color={disabled ? foreground : undefined}>
              {description}
            </AppText>
          ) : null}
        </View>
      </View>
    </TouchableRipple>
  );
}

const styles = StyleSheet.create({
  choice: { minHeight: 56, borderWidth: 1, borderRadius: radius.md, overflow: "hidden", justifyContent: "center" },
  content: { flexDirection: "row", alignItems: "center", padding: spacing.md, gap: spacing.md },
  copy: { flex: 1, minWidth: 0, gap: spacing["2xs"] },
});
