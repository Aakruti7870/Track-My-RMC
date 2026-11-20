import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import { Platform, ScrollView } from "react-native";

export function useWebCarousel(scrollRef: RefObject<ScrollView | null>, width: number, slideCount: number, showSlide: (index: number) => void) {
  const webPaused = useRef(false);
  const [webNode, setWebNode] = useState<HTMLElement | null>(null);
  const attachScroll = useCallback((instance: ScrollView | null) => {
    scrollRef.current = instance;
    if (Platform.OS === "web") setWebNode(instance as unknown as HTMLElement | null);
  }, [scrollRef]);

  useEffect(() => {
    const node = webNode;
    if (!node || width <= 0) return;

    let pointer: { id: number; x: number; y: number; offset: number } | undefined;
    let dragged = false;
    let hovered = node.matches(":hover");
    let focused = node.contains(document.activeElement);
    const updatePause = () => { webPaused.current = hovered || focused || Boolean(pointer); };
    const enter = (event: PointerEvent) => { if (event.pointerType === "mouse") hovered = true; updatePause(); };
    const leave = () => { hovered = false; updatePause(); };
    const focus = () => { focused = true; updatePause(); };
    const blur = (event: FocusEvent) => {
      focused = event.relatedTarget instanceof Node && node.contains(event.relatedTarget);
      updatePause();
    };
    const start = (event: PointerEvent) => {
      dragged = false;
      if (event.pointerType !== "mouse" || event.button !== 0 || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
      pointer = { id: event.pointerId, x: event.clientX, y: event.clientY, offset: node.scrollLeft };
      updatePause();
    };
    const move = (event: PointerEvent) => {
      if (!pointer || event.pointerId !== pointer.id) return;
      const distance = pointer.x - event.clientX;
      if (!dragged) {
        const vertical = Math.abs(pointer.y - event.clientY);
        if (vertical >= 6 && vertical > Math.abs(distance)) {
          pointer = undefined;
          updatePause();
          return;
        }
        if (Math.abs(distance) < 6) return;
        dragged = true;
        node.style.scrollSnapType = "none";
      }
      node.scrollLeft = pointer.offset + distance;
      event.preventDefault();
    };
    const pageFor = (offset: number) => Math.max(0, Math.min(slideCount - 1, Math.round(offset / width)));
    const end = (event: PointerEvent) => {
      if (!pointer || pointer.id !== event.pointerId) return;
      const index = pageFor(node.scrollLeft);
      pointer = undefined;
      updatePause();
      node.style.removeProperty("scroll-snap-type");
      if (dragged) showSlide(index);
    };
    const preventNativeDrag = (event: DragEvent) => { if (pointer) event.preventDefault(); };
    const click = (event: MouseEvent) => {
      if (!dragged || event.detail === 0) return;
      dragged = false;
      event.preventDefault();
      event.stopPropagation();
    };
    const key = (event: KeyboardEvent) => {
      if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
      if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
      event.preventDefault();
      node.focus({ preventScroll: true });
      const direction = event.key === "ArrowLeft" ? -1 : 1;
      showSlide(pageFor(node.scrollLeft + direction * width));
    };

    updatePause();
    node.addEventListener("pointerenter", enter);
    node.addEventListener("pointerleave", leave);
    node.addEventListener("focusin", focus);
    node.addEventListener("focusout", blur);
    node.addEventListener("pointerdown", start);
    node.addEventListener("dragstart", preventNativeDrag);
    node.addEventListener("click", click, true);
    node.addEventListener("keydown", key);
    window.addEventListener("pointermove", move, { passive: false });
    window.addEventListener("pointerup", end);
    window.addEventListener("pointercancel", end);
    return () => {
      node.style.removeProperty("scroll-snap-type");
      webPaused.current = false;
      node.removeEventListener("pointerenter", enter);
      node.removeEventListener("pointerleave", leave);
      node.removeEventListener("focusin", focus);
      node.removeEventListener("focusout", blur);
      node.removeEventListener("pointerdown", start);
      node.removeEventListener("dragstart", preventNativeDrag);
      node.removeEventListener("click", click, true);
      node.removeEventListener("keydown", key);
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", end);
      window.removeEventListener("pointercancel", end);
    };
  }, [webNode, showSlide, slideCount, width]);

  return { attachScroll, webPaused };
}
