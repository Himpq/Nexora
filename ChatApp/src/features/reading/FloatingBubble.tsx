import { useEffect, useRef, useState } from "react";
import { Animated, PanResponder, StyleSheet, useWindowDimensions } from "react-native";
import { Feather } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { colors, haptics, shadow } from "../../design";
import {
  clampBubblePosition,
  loadBubblePosition,
  saveBubblePosition,
} from "./floatingLayout";

const SIZE = 52;
const MARGIN = 12;
const PEEK = 18; // visible strip when tucked into the edge
const DRAG_THRESHOLD = 4;
// Release within this distance of an edge and the bubble snaps in immediately.
const SNAP_THRESHOLD = 34;
// While floating, sit within this distance of an edge and an idle timer tucks
// it in automatically — no inward motion required.
const IDLE_SNAP_THRESHOLD = 30;
const IDLE_MS = 2200;

type Side = "left" | "right";

/**
 * Floating book button with a 3-step interaction:
 *  1. floating — draggable anywhere; near an edge, tucks in after a short idle.
 *  2. tucked   — collapsed into the edge (PEEK strip). Tap → pops out (step 3).
 *  3. popped   — fully visible at the margin. Tap → opens the assistant panel;
 *                after a short idle it tucks back in.
 *
 * Release near an edge while dragging snaps in immediately (water drop).
 * Tap handling lives in the pan responder's release branch (no nested Pressable).
 */
export function FloatingBubble({ onPress }: { onPress: () => void }) {
  const { width, height } = useWindowDimensions();
  const insets = useSafeAreaInsets();

  const topBound = insets.top + 8;
  const bottomBound = Math.max(topBound, height - insets.bottom - 8 - SIZE);
  const clampX = (x: number) => Math.min(Math.max(MARGIN, x), width - SIZE - MARGIN);
  const clampY = (y: number) => Math.min(Math.max(topBound, y), bottomBound);

  const initial = useRef({
    x: width - SIZE - MARGIN,
    y: Math.min(bottomBound, height * 0.55),
  }).current;
  const pan = useRef(new Animated.ValueXY(initial)).current;
  const layoutRef = useRef({ ...initial });
  const startRef = useRef({ ...initial });
  const dockSideRef = useRef<Side>("right");
  const idleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // tucked = collapsed into edge; popped = revealed but not yet the panel.
  const [tucked, setTucked] = useState(false);
  const [popped, setPopped] = useState(false);
  // The PanResponder is created once (useRef), so its handlers would capture
  // stale `tucked`/`popped`. Mirror them into refs the handlers read live.
  const tuckedRef = useRef(false);
  const poppedRef = useRef(false);
  const setTuckedLive = (v: boolean) => {
    tuckedRef.current = v;
    setTucked(v);
  };
  const setPoppedLive = (v: boolean) => {
    poppedRef.current = v;
    setPopped(v);
  };

  useEffect(() => {
    const id = pan.addListener((value) => {
      layoutRef.current = value;
    });
    return () => pan.removeListener(id);
  }, [pan]);

  const clearIdle = () => {
    if (idleTimer.current) {
      clearTimeout(idleTimer.current);
      idleTimer.current = null;
    }
  };

  // Restore last position.
  useEffect(() => {
    let active = true;
    (async () => {
      const saved = await loadBubblePosition();
      if (!active || !saved) {
        return;
      }
      const c = clampBubblePosition(saved, width, topBound, bottomBound, SIZE, MARGIN);
      pan.setValue({ x: c.x, y: c.y });
      layoutRef.current = { x: c.x, y: c.y };
    })();
    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Re-clamp on rotation / dimension change so the bubble never leaves screen.
  useEffect(() => {
    const c = clampBubblePosition(layoutRef.current, width, topBound, bottomBound, SIZE, MARGIN);
    layoutRef.current = { x: c.x, y: c.y };
    pan.setValue({ x: c.x, y: c.y });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [width, height]);

  useEffect(() => clearIdle, []);

  const persist = () => {
    void saveBubblePosition({
      x: Math.round(layoutRef.current.x),
      y: Math.round(layoutRef.current.y),
    });
  };

  const animateX = (toX: number, then?: () => void) => {
    Animated.spring(pan.x, {
      toValue: toX,
      useNativeDriver: false,
      friction: 7,
      tension: 80,
    }).start(() => then?.());
  };

  const sideOf = (x: number): Side => (x + SIZE / 2 < width / 2 ? "left" : "right");

  // Collapse into the edge (tucked).
  const tuckIn = (side: Side) => {
    dockSideRef.current = side;
    setTuckedLive(true);
    setPoppedLive(false);
    haptics.impact("light");
    animateX(side === "left" ? PEEK - SIZE : width - PEEK, persist);
  };

  // Pop back out to the margin (revealed), still just the bubble.
  const popOut = (side: Side) => {
    setTuckedLive(false);
    setPoppedLive(true);
    haptics.impact("light");
    animateX(side === "left" ? MARGIN : width - SIZE - MARGIN, persist);
  };

  // Schedule an auto-tuck when floating/popped near an edge.
  const scheduleAutoTuck = () => {
    clearIdle();
    const side = sideOf(layoutRef.current.x);
    const distToEdge = side === "left" ? layoutRef.current.x : width - SIZE - layoutRef.current.x;
    if (distToEdge <= IDLE_SNAP_THRESHOLD) {
      idleTimer.current = setTimeout(() => tuckIn(side), IDLE_MS);
    }
  };

  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: (_, g) =>
        Math.abs(g.dx) > DRAG_THRESHOLD || Math.abs(g.dy) > DRAG_THRESHOLD,
      onPanResponderGrant: () => {
        clearIdle();
        startRef.current = { ...layoutRef.current };
      },
      onPanResponderMove: (_, g) => {
        const nx = clampX(startRef.current.x + g.dx);
        const ny = clampY(startRef.current.y + g.dy);
        pan.setValue({ x: nx, y: ny });
      },
      onPanResponderRelease: (_, g) => {
        const moved = Math.abs(g.dx) > DRAG_THRESHOLD || Math.abs(g.dy) > DRAG_THRESHOLD;
        if (!moved) {
          // Tap — no nested Pressable. Three steps:
          //   tucked → pop out; popped → open panel; floating → open panel.
          if (tuckedRef.current) {
            popOut(dockSideRef.current);
            scheduleAutoTuck();
          } else {
            onPress();
          }
          return;
        }
        const side = sideOf(layoutRef.current.x);
        const distToEdge = side === "left" ? layoutRef.current.x : width - SIZE - layoutRef.current.x;
        setPoppedLive(false);
        // Obvious compress-toward-edge motion → snap in immediately (water drop).
        if (distToEdge <= SNAP_THRESHOLD) {
          tuckIn(side);
        } else {
          dockSideRef.current = side;
          setTuckedLive(false);
          animateX(side === "left" ? MARGIN : width - SIZE - MARGIN, persist);
          scheduleAutoTuck();
        }
      },
    }),
  ).current;

  // Arm the auto-tuck whenever the bubble is floating (not tucked) and idle.
  useEffect(() => {
    if (tucked) {
      clearIdle();
      return;
    }
    scheduleAutoTuck();
    return clearIdle;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tucked, popped, width, height]);

  return (
    <Animated.View
      accessible
      accessibilityRole="button"
      accessibilityLabel="学习助手"
      accessibilityHint={
        tucked ? "点击展开" : popped ? "点击打开学习助手" : "点击打开学习助手，拖动可移动，拖到边缘可收起"
      }
      style={[
        styles.bubble,
        tucked && styles.bubbleTucked,
        { transform: [{ translateX: pan.x }, { translateY: pan.y }] },
      ]}
      {...panResponder.panHandlers}
    >
      <Feather name="book-open" size={22} color={colors.textInverse} />
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  bubble: {
    position: "absolute",
    left: 0,
    top: 0,
    width: SIZE,
    height: SIZE,
    borderRadius: 16,
    backgroundColor: colors.surfaceInverse,
    alignItems: "center",
    justifyContent: "center",
    ...shadow.lg,
  },
  bubbleTucked: {
    opacity: 0.9,
  },
});
