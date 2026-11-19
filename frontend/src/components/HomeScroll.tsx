import { type ReactNode } from "react";
import { Platform, ScrollView, StyleSheet, type ScrollViewProps } from "react-native";

type Props = Pick<ScrollViewProps, "contentContainerStyle" | "refreshControl" | "testID" | "style"> & {
  children: ReactNode;
  gap: number;
  paddingHorizontal: number;
  paddingTop?: number;
};

export function HomeScroll({ children, gap, paddingHorizontal, paddingTop = 0,
  contentContainerStyle, refreshControl, testID, style }: Props) {
  return (
    <ScrollView testID={testID} style={[styles.scroll, style]}
      contentContainerStyle={[{ gap, paddingHorizontal, paddingTop }, contentContainerStyle]}
      showsVerticalScrollIndicator={false} refreshControl={Platform.OS === "web" ? undefined : refreshControl}>
      {children}
    </ScrollView>
  );
}

const styles = StyleSheet.create({ scroll: { flex: 1, minHeight: 0 } });
