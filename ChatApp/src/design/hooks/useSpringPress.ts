import { useCallback } from "react";
import type { ViewStyle } from "react-native";
import {
  cancelAnimation,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withSpring,
  withTiming,
  type AnimatedStyle,
} from "react-native-reanimated";

import { motion } from "../tokens";
import { haptics, type HapticIntensity } from "./useHaptic";

export type SpringPressOptions = {
  /** Scale at rest (1) and while pressed (default 0.97). */
  pressedScale?: number;
  /** Spring preset from `motion.spring`. */
  preset?: keyof typeof motion.spring;
  /** Optional haptic fired on press-in. Pass false to disable. */
  haptic?: HapticIntensity | false;
};

type SpringPressReturn = {
  pressStyle: AnimatedStyle<ViewStyle>;
  onPressIn: () => void;
  onPressOut: () => void;
};

/**
 * UI-thread spring press feedback for any AnimatedPressable surface.
 * Replaces the legacy `transform: [{ scale: 0.98 }]` JS-thread press with a
 * Reanimated worklet so it stays smooth on Android.
 */
export function useSpringPress(options: SpringPressOptions = {}): SpringPressReturn {
  const { pressedScale = 0.97, preset = "responsive", haptic = "light" } = options;
  const scale = useSharedValue(1);

  const pressStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
  }));

  const onPressIn = useCallback(() => {
    if (haptic !== false) haptics.impact(haptic);
    scale.value = withSpring(pressedScale, motion.spring[preset]);
  }, [haptic, pressedScale, preset, scale]);

  const onPressOut = useCallback(() => {
    cancelAnimation(scale);
    scale.value = withSpring(1, motion.spring[preset]);
  }, [preset, scale]);

  return { pressStyle, onPressIn, onPressOut };
}

/**
 * One-shot shared value helper for entrance animations (fade + slide up).
 * Returns the value plus a `play` function you call in a useEffect.
 */
export function useEntrance(delayMs = 0) {
  const progress = useSharedValue(0);

  const style = useAnimatedStyle(() => ({
    opacity: progress.value,
    transform: [{ translateY: (1 - progress.value) * 16 }],
  }));

  const play = useCallback(() => {
    progress.value = withDelay(
      delayMs,
      withTiming(1, { duration: motion.duration.entrance }),
    );
  }, [delayMs, progress]);

  return { style, play };
}
