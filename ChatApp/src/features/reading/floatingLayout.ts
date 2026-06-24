import AsyncStorage from "@react-native-async-storage/async-storage";

import type { AssistantTabKey } from "./types";

/** Persisted geometry for the draggable/resizable reading assistant panel. */
export type FloatingLayout = { x: number; y: number; w: number; h: number };
/** Persisted position for the draggable reading bubble. */
export type BubblePosition = { x: number; y: number };

const PANEL_KEY = "nexora.reading.floatingPanel.v1";
const BUBBLE_KEY = "nexora.reading.bubble.v1";
const TAB_KEY = "nexora.reading.assistant.tab.v1";

export const PANEL_MIN_W = 280;
export const PANEL_MIN_H = 320;
const MARGIN = 8;

// ---------------------------------------------------------------------------
// Panel layout
// ---------------------------------------------------------------------------

export async function loadFloatingLayout(): Promise<FloatingLayout | null> {
  try {
    const raw = await AsyncStorage.getItem(PANEL_KEY);
    if (!raw) {
      return null;
    }
    const obj = JSON.parse(raw);
    const values = [obj?.x, obj?.y, obj?.w, obj?.h].map((n) => Number(n));
    if (values.every((n) => Number.isFinite(n))) {
      return { x: values[0], y: values[1], w: values[2], h: values[3] };
    }
  } catch {
    // Ignore malformed cache.
  }
  return null;
}

export async function saveFloatingLayout(layout: FloatingLayout) {
  try {
    await AsyncStorage.setItem(
      PANEL_KEY,
      JSON.stringify({
        x: Math.round(layout.x),
        y: Math.round(layout.y),
        w: Math.round(layout.w),
        h: Math.round(layout.h),
      }),
    );
  } catch {
    // Best-effort persistence.
  }
}

export function clampLayout(
  layout: FloatingLayout,
  screenW: number,
  screenH: number,
  top = 0,
  bottom = 0,
): FloatingLayout {
  const maxW = Math.max(PANEL_MIN_W, screenW - MARGIN * 2);
  const maxH = Math.max(PANEL_MIN_H, screenH - top - bottom - MARGIN * 2);
  const w = Math.min(maxW, Math.max(PANEL_MIN_W, layout.w));
  const h = Math.min(maxH, Math.max(PANEL_MIN_H, layout.h));
  const x = Math.min(Math.max(MARGIN, layout.x), Math.max(MARGIN, screenW - w - MARGIN));
  const y = Math.min(
    Math.max(top + MARGIN, layout.y),
    Math.max(top + MARGIN, screenH - h - bottom - MARGIN),
  );
  return { x, y, w, h };
}

export function defaultLayout(
  screenW: number,
  screenH: number,
  top = 0,
  bottom = 0,
): FloatingLayout {
  // Kept compact so it doesn't dominate the reader on phones; still resizable.
  const w = Math.min(screenW - MARGIN * 2, 380);
  const h = Math.min(screenH - top - bottom - 32, 480);
  return clampLayout(
    { x: screenW - w - MARGIN, y: top + 16, w, h },
    screenW,
    screenH,
    top,
    bottom,
  );
}

// ---------------------------------------------------------------------------
// Bubble position
// ---------------------------------------------------------------------------

export async function loadBubblePosition(): Promise<BubblePosition | null> {
  try {
    const raw = await AsyncStorage.getItem(BUBBLE_KEY);
    if (!raw) {
      return null;
    }
    const obj = JSON.parse(raw);
    const x = Number(obj?.x);
    const y = Number(obj?.y);
    if (Number.isFinite(x) && Number.isFinite(y)) {
      return { x, y };
    }
  } catch {
    // Ignore malformed cache.
  }
  return null;
}

export async function saveBubblePosition(pos: BubblePosition) {
  try {
    await AsyncStorage.setItem(
      BUBBLE_KEY,
      JSON.stringify({ x: Math.round(pos.x), y: Math.round(pos.y) }),
    );
  } catch {
    // Best-effort persistence.
  }
}

/**
 * Clamp a bubble position inside the usable area. `top`/`bottom` are the
 * vertical bounds (e.g. safe-area + padding); `size` is the bubble edge;
 * `margin` the horizontal inset. Used both on restore and on rotation.
 */
export function clampBubblePosition(
  pos: BubblePosition,
  screenW: number,
  top: number,
  bottom: number,
  size: number,
  margin: number,
): BubblePosition {
  const x = Math.min(Math.max(margin, pos.x), Math.max(margin, screenW - size - margin));
  const y = Math.min(Math.max(top, pos.y), Math.max(top, bottom - size));
  return { x, y };
}

// ---------------------------------------------------------------------------
// Active tab memory
// ---------------------------------------------------------------------------

const VALID_TABS: ReadonlyArray<AssistantTabKey> = ["guide", "ai", "quiz", "knowledge", "progress"];

export async function loadActiveTab(): Promise<AssistantTabKey | null> {
  try {
    const raw = await AsyncStorage.getItem(TAB_KEY);
    if (raw && (VALID_TABS as ReadonlyArray<string>).includes(raw)) {
      return raw as AssistantTabKey;
    }
  } catch {
    // Ignore malformed cache.
  }
  return null;
}

export async function saveActiveTab(tab: AssistantTabKey) {
  try {
    await AsyncStorage.setItem(TAB_KEY, tab);
  } catch {
    // Best-effort persistence.
  }
}
