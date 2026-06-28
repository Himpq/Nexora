import { useEffect, useMemo, useRef, useState } from "react";
import {
  Animated,
  Keyboard,
  KeyboardEvent,
  PanResponder,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
  useWindowDimensions,
} from "react-native";
import { Feather } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { AppText, colors, haptics, radius, shadow, spacing } from "../../design";
import {
  clampLayout,
  defaultLayout,
  loadActiveTab,
  loadFloatingLayout,
  PANEL_MIN_H,
  PANEL_MIN_W,
  saveActiveTab,
  saveFloatingLayout,
} from "./floatingLayout";
import type { FloatingLayout } from "./floatingLayout";
import { AiTab } from "./tabs/AiTab";
import { GuideTab } from "./tabs/GuideTab";
import { KnowledgeTab } from "./tabs/KnowledgeTab";
import { ProgressTab } from "./tabs/ProgressTab";
import { QuizTab } from "./tabs/QuizTab";
import type { AssistantTabKey, ReaderContext } from "./types";

const TABS: Array<{ key: AssistantTabKey; label: string }> = [
  { key: "guide", label: "导读" },
  { key: "ai", label: "AI" },
  { key: "quiz", label: "测验" },
  { key: "knowledge", label: "知识点" },
  { key: "progress", label: "进度" },
];

const EDGE = 10; // resize edge strip thickness — narrow so it barely overlaps content

type ResizeEdges = { left?: boolean; right?: boolean; top?: boolean; bottom?: boolean };

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), Math.max(min, max));
}

/** Compute the next layout when dragging the given edges by (dx, dy). */
function computeResize(
  start: FloatingLayout,
  edges: ResizeEdges,
  dx: number,
  dy: number,
  screenW: number,
  screenH: number,
  top: number,
  bottom: number,
): FloatingLayout {
  let { x, y, w, h } = start;
  if (edges.left) {
    const minXForMinW = start.x + start.w - PANEL_MIN_W;
    const nx = clamp(start.x + dx, 8, minXForMinW);
    w = start.w - (nx - start.x);
    x = nx;
  }
  if (edges.right) {
    w = clamp(start.w + dx, PANEL_MIN_W, screenW - start.x - 8);
  }
  if (edges.top) {
    const minYForMinH = start.y + start.h - PANEL_MIN_H;
    const ny = clamp(start.y + dy, top + 8, minYForMinH);
    h = start.h - (ny - start.y);
    y = ny;
  }
  if (edges.bottom) {
    h = clamp(start.h + dy, PANEL_MIN_H, screenH - start.y - bottom - 8);
  }
  return { x, y, w, h };
}

/**
 * Draggable / resizable reading assistant panel. Resizable from all four edges
 * (and corners); resize handles only claim drags, so taps pass through to the
 * content beneath (e.g. the AI send button). Kept mounted (hidden) once first
 * opened so AI conversations and tab state survive close/reopen. When the
 * keyboard appears the panel shrinks so its bottom (the composer) sticks to the
 * keyboard top — the input never gets covered.
 */
export function AssistantPanel({
  open,
  onClose,
  context,
}: {
  open: boolean;
  onClose: () => void;
  context: ReaderContext;
}) {
  const { width, height } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  // BookReader is a RootStack screen — no floating tab bar here, so only clear
  // the safe-area inset plus a small margin.
  const top = insets.top;
  const bottom = insets.bottom + 8;

  const def = defaultLayout(width, height, top, bottom);
  const pos = useRef(new Animated.ValueXY({ x: def.x, y: def.y })).current;
  const size = useRef(new Animated.ValueXY({ x: def.w, y: def.h })).current;
  const layoutRef = useRef<FloatingLayout>({ x: def.x, y: def.y, w: def.w, h: def.h });
  const appear = useRef(new Animated.Value(0)).current;
  const restoreLayout = useRef<FloatingLayout | null>(null);
  const preKb = useRef<FloatingLayout | null>(null);
  const lastTapRef = useRef(0);
  // Height of the overlay (= reader area, below the native header). Captured
  // via onLayout so keyboard math never depends on the header height or on
  // screen-space keyboard coordinates.
  const overlayHRef = useRef(height);

  const [activeTab, setActiveTab] = useState<AssistantTabKey>("guide");
  const [visited, setVisited] = useState<Set<AssistantTabKey>>(() => new Set(["guide"]));

  // Restore persisted layout + last-used tab.
  useEffect(() => {
    let active = true;
    (async () => {
      const [saved, tab] = await Promise.all([loadFloatingLayout(), loadActiveTab()]);
      if (!active) {
        return;
      }
      if (saved) {
        const c = clampLayout(saved, width, height, top, bottom);
        pos.setValue({ x: c.x, y: c.y });
        size.setValue({ x: c.w, y: c.h });
        layoutRef.current = c;
      }
      if (tab) {
        setActiveTab(tab);
      }
    })();
    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Re-clamp on rotation / dimension change.
  useEffect(() => {
    const c = clampLayout(layoutRef.current, width, height, top, bottom);
    layoutRef.current = c;
    pos.setValue({ x: c.x, y: c.y });
    size.setValue({ x: c.w, y: c.h });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [width, height]);

  useEffect(() => {
    setVisited((prev) => {
      if (prev.has(activeTab)) {
        return prev;
      }
      const next = new Set(prev);
      next.add(activeTab);
      return next;
    });
    void saveActiveTab(activeTab);
  }, [activeTab]);

  // Fade in/out on open toggle.
  useEffect(() => {
    Animated.timing(appear, {
      toValue: open ? 1 : 0,
      duration: 180,
      useNativeDriver: true,
    }).start();
  }, [open, appear]);

  useEffect(() => {
    const posId = pos.addListener((v) => {
      layoutRef.current.x = v.x;
      layoutRef.current.y = v.y;
    });
    const sizeId = size.addListener((v) => {
      layoutRef.current.w = v.x;
      layoutRef.current.h = v.y;
    });
    return () => {
      pos.removeListener(posId);
      size.removeListener(sizeId);
    };
  }, [pos, size]);

  // Keyboard: shrink the panel so its bottom edge (the composer) sits on the
  // keyboard top. We work entirely in overlay-local coordinates — the keyboard
  // occupies the bottom `kbHeight` of the overlay (the overlay spans from just
  // below the native header to the screen bottom), so its top in overlay space
  // is `overlayH - kbHeight`. This avoids any dependence on header height or
  // screen-space keyboard coordinates (which are unreliable on Android).
  useEffect(() => {
    const showEvt = Platform.OS === "ios" ? "keyboardWillShow" : "keyboardDidShow";
    const hideEvt = Platform.OS === "ios" ? "keyboardWillHide" : "keyboardDidHide";

    const onShow = (e: KeyboardEvent) => {
      const kbHeight = e.endCoordinates?.height ?? 0;
      if (kbHeight <= 0) {
        return;
      }
      const kbTopLocal = overlayHRef.current - kbHeight;
      const cur = { ...layoutRef.current };
      const desiredBottom = kbTopLocal - 8;
      let newH = desiredBottom - cur.y;
      let newY = cur.y;
      if (newH < PANEL_MIN_H) {
        newH = PANEL_MIN_H;
        newY = Math.max(top + 8, desiredBottom - newH);
      }
      // Nothing to do if the panel already clears the keyboard.
      if (cur.y + cur.h <= desiredBottom + 0.5) {
        return;
      }
      preKb.current = cur;
      const dur = e.duration || 220;
      const anims: Animated.CompositeAnimation[] = [
        Animated.timing(size.y, { toValue: newH, duration: dur, useNativeDriver: false }),
      ];
      if (Math.abs(newY - cur.y) > 0.5) {
        anims.push(
          Animated.timing(pos.y, { toValue: newY, duration: dur, useNativeDriver: false }),
        );
      }
      Animated.parallel(anims).start();
    };
    const onHide = (e: KeyboardEvent) => {
      const restore = preKb.current;
      preKb.current = null;
      if (!restore) {
        return;
      }
      const dur = e.duration || 220;
      const anims: Animated.CompositeAnimation[] = [
        Animated.timing(size.y, { toValue: restore.h, duration: dur, useNativeDriver: false }),
      ];
      if (Math.abs(restore.y - layoutRef.current.y) > 0.5) {
        anims.push(
          Animated.timing(pos.y, { toValue: restore.y, duration: dur, useNativeDriver: false }),
        );
      }
      Animated.parallel(anims).start();
    };

    const showSub = Keyboard.addListener(showEvt, onShow);
    const hideSub = Keyboard.addListener(hideEvt, onHide);
    return () => {
      showSub.remove();
      hideSub.remove();
    };
  }, [top]);

  // Drag bar — move the panel; tap (no move) detects double-tap to maximize.
  const dragStart = useRef({ x: 0, y: 0 });
  const dragMovedRef = useRef(false);
  const dragResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: (_, g) => Math.abs(g.dx) > 3 || Math.abs(g.dy) > 3,
      onPanResponderGrant: () => {
        dragStart.current = { x: layoutRef.current.x, y: layoutRef.current.y };
        dragMovedRef.current = false;
      },
      onPanResponderMove: (_, g) => {
        dragMovedRef.current = true;
        const nx = clamp(dragStart.current.x + g.dx, 8, width - layoutRef.current.w - 8);
        const ny = clamp(
          dragStart.current.y + g.dy,
          top + 8,
          height - layoutRef.current.h - bottom - 8,
        );
        pos.setValue({ x: nx, y: ny });
      },
      onPanResponderRelease: () => {
        if (dragMovedRef.current) {
          void saveFloatingLayout(layoutRef.current);
          lastTapRef.current = 0;
          return;
        }
        // Tap on the drag bar — double-tap toggles maximize.
        const now = Date.now();
        if (now - lastTapRef.current < 300) {
          lastTapRef.current = 0;
          haptics.impact("light");
          const maximized = clampLayout(
            { x: 8, y: top + 8, w: width - 16, h: height - top - bottom - 16 },
            width,
            height,
            top,
            bottom,
          );
          const isMaxed =
            layoutRef.current.w >= maximized.w - 1 && layoutRef.current.h >= maximized.h - 1;
          const target = isMaxed && restoreLayout.current ? restoreLayout.current : maximized;
          if (!isMaxed) {
            restoreLayout.current = { ...layoutRef.current };
          } else {
            restoreLayout.current = null;
          }
          pos.setValue({ x: target.x, y: target.y });
          size.setValue({ x: target.w, y: target.h });
          layoutRef.current = target;
          void saveFloatingLayout(target);
        } else {
          lastTapRef.current = now;
        }
      },
    }),
  ).current;

  // Resize handles — one per edge. They occupy a thin strip on each edge and
  // grab immediately, so the panel is resizable from all four sides. Content
  // (e.g. the AI composer) is inset past EDGE so no interactive element sits
  // under a handle — taps on buttons/inputs always reach them.
  const resizeStart = useRef<FloatingLayout>({ x: 0, y: 0, w: 0, h: 0 });
  const handles = useMemo(() => {
    const build = (edges: ResizeEdges) =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: () => true,
        onPanResponderGrant: () => {
          resizeStart.current = { ...layoutRef.current };
          restoreLayout.current = null;
        },
        onPanResponderMove: (_, g) => {
          const next = computeResize(
            resizeStart.current,
            edges,
            g.dx,
            g.dy,
            width,
            height,
            top,
            bottom,
          );
          pos.setValue({ x: next.x, y: next.y });
          size.setValue({ x: next.w, y: next.h });
        },
        onPanResponderRelease: () => {
          void saveFloatingLayout(layoutRef.current);
        },
      });
    return [
      { key: "top", style: styles.hTop, pr: build({ top: true }) },
      { key: "bottom", style: styles.hBottom, pr: build({ bottom: true }) },
      { key: "left", style: styles.hLeft, pr: build({ left: true }) },
      { key: "right", style: styles.hRight, pr: build({ right: true }) },
    ];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [width, height, top, bottom]);

  const subtitle = context.chapter?.name || context.lectureTitle || "";

  return (
    <Animated.View
      style={[styles.overlay, { opacity: appear }]}
      pointerEvents={open ? "auto" : "none"}
      onLayout={(e) => {
        overlayHRef.current = e.nativeEvent.layout.height;
      }}
    >
      <Pressable style={styles.scrim} onPress={onClose} />
      <Animated.View
        style={[
          styles.panel,
          {
            width: size.x,
            height: size.y,
            transform: [{ translateX: pos.x }, { translateY: pos.y }],
          },
        ]}
      >
        <View style={styles.dragBar} {...dragResponder.panHandlers}>
          <Feather name="more-horizontal" size={16} color={colors.textTertiary} />
          <View style={styles.dragTitles}>
            <AppText variant="label" numberOfLines={1} style={styles.dragTitle}>
              {context.bookTitle || context.lectureTitle || "学习助手"}
            </AppText>
            {subtitle ? (
              <AppText variant="caption" tone="tertiary" numberOfLines={1}>
                {subtitle}
              </AppText>
            ) : null}
          </View>
          <Pressable
            onPress={onClose}
            hitSlop={8}
            style={styles.closeBtn}
            accessibilityRole="button"
            accessibilityLabel="关闭"
          >
            <Feather name="x" size={18} color={colors.text} />
          </Pressable>
        </View>

        <View style={styles.tabBar}>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.tabBarContent}
          >
            {TABS.map((tab) => {
              const active = tab.key === activeTab;
              return (
                <Pressable
                  key={tab.key}
                  style={styles.tab}
                  onPress={() => {
                    haptics.selection();
                    setActiveTab(tab.key);
                  }}
                  accessibilityRole="tab"
                  accessibilityState={{ selected: active }}
                  accessibilityLabel={tab.label}
                >
                  <AppText
                    variant="label"
                    style={active ? styles.tabTextActive : styles.tabText}
                  >
                    {tab.label}
                  </AppText>
                  {active ? <View style={styles.tabUnderline} /> : null}
                </Pressable>
              );
            })}
          </ScrollView>
        </View>

        <View style={styles.body}>
          {TABS.map((tab) =>
            visited.has(tab.key) ? (
              <View
                key={tab.key}
                style={[styles.tabPane, tab.key !== activeTab && styles.tabPaneHidden]}
                pointerEvents={tab.key === activeTab ? "auto" : "none"}
              >
                {tab.key === "guide" ? <GuideTab context={context} /> : null}
                {tab.key === "ai" ? <AiTab context={context} /> : null}
                {tab.key === "quiz" ? <QuizTab context={context} /> : null}
                {tab.key === "knowledge" ? <KnowledgeTab context={context} /> : null}
                {tab.key === "progress" ? <ProgressTab context={context} /> : null}
              </View>
            ) : null,
          )}
        </View>

        {/* Resize handles — thin strips on each edge; content is inset past
            them so buttons/inputs are never covered (e.g. the AI send button). */}
        {handles.map((h) => (
          <View key={h.key} style={h.style} {...h.pr.panHandlers} />
        ))}
      </Animated.View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  overlay: {
    ...StyleSheet.absoluteFillObject,
  },
  scrim: {
    ...StyleSheet.absoluteFillObject,
    // Transparent: the scrim only captures taps-to-close now, so the reading
    // text behind the panel is no longer dimmed.
    backgroundColor: "transparent",
  },
  panel: {
    position: "absolute",
    left: 0,
    top: 0,
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    overflow: "hidden",
    ...shadow.xl,
  },
  dragBar: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.borderFaint,
  },
  dragTitles: {
    flex: 1,
    gap: 1,
  },
  dragTitle: {
    flexShrink: 1,
  },
  closeBtn: {
    width: 28,
    height: 28,
    alignItems: "center",
    justifyContent: "center",
  },
  tabBar: {
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  tabBarContent: {
    paddingHorizontal: spacing.md,
  },
  tab: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    alignItems: "center",
  },
  tabText: {
    color: colors.textTertiary,
  },
  tabTextActive: {
    color: colors.text,
  },
  tabUnderline: {
    position: "absolute",
    bottom: 0,
    height: 2,
    left: spacing.md,
    right: spacing.md,
    backgroundColor: colors.text,
    borderRadius: 1,
  },
  body: {
    flex: 1,
    overflow: "hidden",
  },
  tabPane: {
    ...StyleSheet.absoluteFillObject,
  },
  tabPaneHidden: {
    display: "none",
  },
  // Resize handle hit areas (transparent).
  hTop: {
    position: "absolute",
    left: 0,
    right: 0,
    top: 0,
    height: EDGE,
  },
  hBottom: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    height: EDGE,
  },
  hLeft: {
    position: "absolute",
    left: 0,
    top: 0,
    bottom: 0,
    width: EDGE,
  },
  hRight: {
    position: "absolute",
    right: 0,
    top: 0,
    bottom: 0,
    width: EDGE,
  },
});
