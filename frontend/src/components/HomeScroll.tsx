import { useState, type ReactNode } from "react";
import { Platform, ScrollView, StyleSheet, View, type ScrollViewProps, type ViewStyle } from "react-native";

type Props = Pick<ScrollViewProps, "contentContainerStyle" | "refreshControl" | "testID"> & {
  lead: ReactNode;
  shortcuts: ReactNode;
  children: ReactNode;
  backgroundColor: string;
  gap: number;
  paddingHorizontal: number;
  paddingTop?: number;
  tabBarOverlay?: number;
};

const MIN_SCROLL_SPACE = 150;

/** Keep the shortcuts visible without taking away the space needed to scroll the dashboard. */
export function HomeScroll({ lead, shortcuts, children, backgroundColor, gap, paddingHorizontal,
  paddingTop = 0, tabBarOverlay = 0, contentContainerStyle, refreshControl, testID }: Props) {
  const [viewportHeight, setViewportHeight] = useState(0);
  const [leadHeight, setLeadHeight] = useState(0);
  const [shortcutHeight, setShortcutHeight] = useState(0);
  const available = viewportHeight - tabBarOverlay - MIN_SCROLL_SPACE;
  const canPinShortcuts = shortcutHeight > 0 && shortcutHeight + paddingTop <= available;
  const fixed = canPinShortcuts && leadHeight > 0 && leadHeight + shortcutHeight <= available;
  const sticky = !fixed && canPinShortcuts;
  const webScrollInsets = Platform.OS === "web"
    ? { scrollPaddingTop: sticky ? shortcutHeight : 0, scrollPaddingBottom: tabBarOverlay } as ViewStyle
    : undefined;
  const leadBlock = <View key="lead" style={{ paddingTop, paddingBottom: gap }}
    onLayout={event => setLeadHeight(event.nativeEvent.layout.height)}>
    {lead}
  </View>;
  const shortcutBlock = <View key="shortcuts" testID={testID + "-shortcuts"}
    style={{ paddingBottom: gap, backgroundColor: fixed ? undefined : backgroundColor }}
    onLayout={event => setShortcutHeight(event.nativeEvent.layout.height)}>
    {shortcuts}
  </View>;

  return (
    <View testID={testID + "-frame"} style={styles.frame}
      onLayout={event => setViewportHeight(event.nativeEvent.layout.height)}>
      {fixed ? <View testID={testID + "-fixed"} style={{ paddingHorizontal }}>
        {leadBlock}
        {shortcutBlock}
      </View> : null}
      <ScrollView testID={testID} style={[styles.frame, webScrollInsets]}
        contentContainerStyle={[{ paddingHorizontal }, contentContainerStyle]}
        stickyHeaderIndices={sticky ? [1] : undefined}
        showsVerticalScrollIndicator={false} refreshControl={Platform.OS === "web" ? undefined : refreshControl}>
        {fixed ? null : leadBlock}
        {fixed ? null : shortcutBlock}
        <View style={{ gap }}>{children}</View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({ frame: { flex: 1, minHeight: 0 } });
