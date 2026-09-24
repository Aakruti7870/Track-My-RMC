import React, { useState } from "react";
import {
  KeyboardTypeOptions,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";

import { useTheme } from "@/src/theme/ThemeProvider";
import { control, fonts, fontSize, radius, spacing } from "@/src/theme/tokens";

type Props = {
  label?: string;
  value: string;
  onChangeText: (t: string) => void;
  placeholder?: string;
  keyboardType?: KeyboardTypeOptions;
  autoFocus?: boolean;
  maxLength?: number;
  error?: string | null;
  hint?: string;
  editable?: boolean;
  autoCapitalize?: "none" | "sentences" | "words" | "characters";
  autoCorrect?: boolean;
  secureTextEntry?: boolean;
  center?: boolean;
  leftAdornment?: React.ReactNode;
  rightAdornment?: React.ReactNode;
  testID?: string;
};

export function Input({
  label,
  value,
  onChangeText,
  placeholder,
  keyboardType,
  autoFocus,
  maxLength,
  error,
  hint,
  editable = true,
  autoCapitalize = "none",
  autoCorrect = false,
  secureTextEntry = false,
  center = false,
  leftAdornment,
  rightAdornment,
  testID,
}: Props) {
  const { colors } = useTheme();
  const [focused, setFocused] = useState(false);
  const borderColor = error ? colors.error : focused ? colors.brand : colors.border;
  const supportingText = error || hint;

  return (
    <View style={styles.wrap}>
      {label ? (
        <Text
          style={[
            styles.label,
            { color: error ? colors.error : focused ? colors.brand : colors.onSurfaceSecondary },
          ]}
        >
          {label}
        </Text>
      ) : null}

      <View
        style={[
          styles.field,
          {
            backgroundColor: editable ? colors.surfaceSecondary : colors.disabledSurface,
            borderColor,
            shadowColor: focused && !error ? colors.brand : colors.shadow,
            shadowOpacity: focused && !error ? (colors.isDark ? 0.2 : 0.11) : 0,
            elevation: focused && !error ? 1 : 0,
          },
        ]}
      >
        {leftAdornment ? <View style={styles.adornment}>{leftAdornment}</View> : null}
        <TextInput
          testID={testID}
          value={value}
          onChangeText={onChangeText}
          placeholder={placeholder}
          placeholderTextColor={colors.onSurfaceTertiary}
          keyboardType={keyboardType}
          autoFocus={autoFocus}
          maxLength={maxLength}
          editable={editable}
          autoCapitalize={autoCapitalize}
          autoCorrect={autoCorrect}
          secureTextEntry={secureTextEntry}
          accessibilityLabel={label || placeholder || "Input field"}
          accessibilityState={{ disabled: !editable }}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          selectionColor={colors.brand}
          cursorColor={colors.brand}
          style={[
            styles.input,
            {
              color: editable ? colors.onSurface : colors.disabledContent,
              textAlign: center ? "center" : "left",
              letterSpacing: center ? 8 : 0,
            },
          ]}
        />
        {rightAdornment ? <View style={styles.adornment}>{rightAdornment}</View> : null}
      </View>

      {supportingText ? (
        <Text
          accessibilityLiveRegion={error ? "polite" : "none"}
          style={[styles.supporting, { color: error ? colors.error : colors.onSurfaceTertiary }]}
        >
          {supportingText}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: spacing.xs },
  label: {
    paddingHorizontal: 2,
    fontFamily: fonts.semibold,
    fontSize: fontSize.sm,
    lineHeight: 17,
  },
  field: {
    minHeight: control.inputHeight,
    flexDirection: "row",
    alignItems: "center",
    borderRadius: radius.md,
    borderWidth: 1,
    paddingHorizontal: spacing.md,
    shadowOffset: { width: 0, height: 6 },
    shadowRadius: 14,
  },
  input: {
    minWidth: 0,
    minHeight: control.inputHeight - 2,
    flex: 1,
    paddingHorizontal: spacing.xs,
    paddingVertical: 0,
    fontFamily: fonts.medium,
    fontSize: fontSize.base,
    lineHeight: 20,
  },
  adornment: {
    minWidth: 30,
    minHeight: 30,
    alignItems: "center",
    justifyContent: "center",
  },
  supporting: {
    paddingHorizontal: 2,
    fontFamily: fonts.medium,
    fontSize: fontSize.xs,
    lineHeight: 16,
  },
});
