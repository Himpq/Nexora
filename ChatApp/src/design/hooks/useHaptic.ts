import * as Haptics from "expo-haptics";
import { Platform } from "react-native";

// expo-haptics only fires on physical devices; on web / emulator no-ops.
// Wrapped so callers never need to think about availability.
const SUPPORTED = Platform.OS === "ios" || Platform.OS === "android";

export type HapticIntensity = "light" | "medium" | "heavy";

const intensityMap: Record<HapticIntensity, Haptics.ImpactFeedbackStyle> = {
  light: Haptics.ImpactFeedbackStyle.Light,
  medium: Haptics.ImpactFeedbackStyle.Medium,
  heavy: Haptics.ImpactFeedbackStyle.Heavy,
};

export const haptics = {
  /** Tap feedback for buttons, cards, list items. Default = light. */
  impact(intensity: HapticIntensity = "light") {
    if (!SUPPORTED) return;
    Haptics.impactAsync(intensityMap[intensity]).catch(() => {});
  },
  /** Selection changed — pills, tabs, segment switches. */
  selection() {
    if (!SUPPORTED) return;
    Haptics.selectionAsync().catch(() => {});
  },
  /** Confirm a committed action — login success, completed task. */
  notify(type: "success" | "warning" | "error") {
    if (!SUPPORTED) return;
    const mapped =
      type === "success"
        ? Haptics.NotificationFeedbackType.Success
        : type === "warning"
          ? Haptics.NotificationFeedbackType.Warning
          : Haptics.NotificationFeedbackType.Error;
    Haptics.notificationAsync(mapped).catch(() => {});
  },
};

/**
 * Convenience hook: returns the static `haptics` API plus bound helpers so
 * components can call `impact()` / `selection()` without importing the object.
 */
export function useHaptic() {
  return haptics;
}
