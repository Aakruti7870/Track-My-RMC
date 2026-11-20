import { Children, isValidElement, useEffect, useRef, useState, type ReactElement } from "react";
import { Platform, ScrollView, StyleSheet, View, useWindowDimensions } from "react-native";

export function HomeCardRow({ children, testID, label, minCardWidth, maxCardWidth = Infinity, gap = 8 }: {
  children: ReactElement | (ReactElement | null)[];
  testID?: string;
  label: string;
  minCardWidth: number;
  maxCardWidth?: number;
  gap?: number;
}) {
  const cards = Children.toArray(children).filter(isValidElement);
  const { fontScale } = useWindowDimensions();
  const [width, setWidth] = useState(0);
  const scroll = useRef<ScrollView>(null);
  const hasMultipleCards = cards.length > 1;
  const minWidth = Math.ceil(minCardWidth * fontScale);
  const gapWidth = (cards.length - 1) * gap;
  const fits = width > 0 && cards.length * minWidth + gapWidth <= width;
  const cardWidth = fits
    ? Math.min(Math.floor((width - gapWidth) / cards.length), Math.max(minWidth, maxCardWidth))
    : Math.min(minWidth, width || minWidth);
  const canScroll = width > 0 && !fits && hasMultipleCards;

  useEffect(() => {
    if (Platform.OS !== "web" || !hasMultipleCards) return;
    const node = scroll.current?.getScrollableNode() as unknown as HTMLElement | undefined;
    if (!node) return;

    setWidth(node.clientWidth);
    const observer = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width));
    observer.observe(node);
    return () => observer.disconnect();
  }, [hasMultipleCards]);

  useEffect(() => {
    if (Platform.OS !== "web" || !canScroll) return;
    const node = scroll.current?.getScrollableNode() as unknown as HTMLElement | undefined;
    if (!node) return;

    let pointer: { id: number; x: number; offset: number } | undefined;
    let dragged = false;

    // Browsers already handle touch and trackpad scrolling. Enable the same
    // gesture for a mouse, and leave ordinary card clicks intact.
    const start = (event: PointerEvent) => {
      dragged = false;
      if (event.pointerType === "mouse" && event.button === 0) {
        pointer = { id: event.pointerId, x: event.clientX, offset: node.scrollLeft };
      }
    };
    const move = (event: PointerEvent) => {
      if (!pointer || event.pointerId !== pointer.id) return;
      const distance = pointer.x - event.clientX;
      if (!dragged && Math.abs(distance) < 6) return;
      dragged = true;
      node.scrollLeft = pointer.offset + distance;
      event.preventDefault();
    };
    const end = () => {
      pointer = undefined;
    };
    const click = (event: MouseEvent) => {
      if (!dragged || event.detail === 0) return;
      dragged = false;
      event.preventDefault();
      event.stopPropagation();
    };
    const keyDown = (event: KeyboardEvent) => {
      if (event.target !== node || !["ArrowLeft", "ArrowRight"].includes(event.key)) return;
      event.preventDefault();
      node.scrollLeft += event.key === "ArrowLeft" ? -(cardWidth + gap) : cardWidth + gap;
    };

    node.addEventListener("pointerdown", start);
    node.addEventListener("click", click, true);
    node.addEventListener("keydown", keyDown);
    window.addEventListener("pointermove", move, { passive: false });
    window.addEventListener("pointerup", end);
    window.addEventListener("pointercancel", end);
    return () => {
      node.removeEventListener("pointerdown", start);
      node.removeEventListener("click", click, true);
      node.removeEventListener("keydown", keyDown);
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", end);
      window.removeEventListener("pointercancel", end);
    };
  }, [canScroll, cardWidth, gap]);

  if (!cards.length) return null;
  if (!hasMultipleCards) return <View testID={testID} style={styles.viewport}>{cards[0]}</View>;

  return (
    <ScrollView
      ref={scroll}
      testID={testID}
      horizontal
      nestedScrollEnabled
      directionalLockEnabled
      showsHorizontalScrollIndicator={false}
      scrollEnabled={Platform.OS === "web" || canScroll}
      accessibilityLabel={label}
      role={Platform.OS === "web" && canScroll ? "region" : undefined}
      tabIndex={Platform.OS === "web" && canScroll ? 0 : undefined}
      onLayout={Platform.OS === "web" ? undefined : event => setWidth(event.nativeEvent.layout.width)}
      style={styles.viewport}
      contentContainerStyle={{ gap }}
    >
      {cards.map(card => (
        <View key={card.key} style={{ width: cardWidth }}>
          {card}
        </View>
      ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  viewport: { width: "100%", minWidth: 0, flexGrow: 0 },
});
