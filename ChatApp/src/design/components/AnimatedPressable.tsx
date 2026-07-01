import React, { useCallback } from "react";
import { Pressable, type PressableProps } from "react-native";
import Animated from "react-native-reanimated";

import { useSpringPress, type SpringPressOptions } from "../hooks/useSpringPress";

const AnimatedPressableBase = Animated.createAnimatedComponent(Pressable);

type AnimatedPressableProps = PressableProps & {
  /** Pass through to useSpringPress to tune the press feel. */
  press?: Omit<SpringPressOptions, "haptic">;
  /** Disable haptic on press-in if you only want the visual feedback. */
  silent?: boolean;
};

/**
 * Pressable with a UI-thread spring press baked in. Use for list items,
 * cards, and any tappable surface that isn't an AppButton.
 *
 * Spreads the spring style + wires onPressIn/onPressOut, while forwarding all
 * normal Pressable props (onPress, disabled, hitSlop, style, children).
 */
export function AnimatedPressable({
  onPressIn,
  onPressOut,
  style,
  press,
  silent = false,
  disabled,
  ...props
}: AnimatedPressableProps) {
  const { pressStyle, onPressIn: handlePressIn, onPressOut: handlePressOut } = useSpringPress({
    ...press,
    haptic: silent ? false : "light",
  });

  // Only animate when enabled so disabled items don't "shrink" on tap.
  const enabled = disabled !== true;

  const handleIn = useCallback(
    (e: Parameters<NonNullable<PressableProps["onPressIn"]>>[0]) => {
      if (enabled) handlePressIn();
      onPressIn?.(e);
    },
    [enabled, handlePressIn, onPressIn],
  );

  const handleOut = useCallback(
    (e: Parameters<NonNullable<PressableProps["onPressOut"]>>[0]) => {
      if (enabled) handlePressOut();
      onPressOut?.(e);
    },
    [enabled, handlePressOut, onPressOut],
  );

  return (
    <AnimatedPressableBase
      {...props}
      disabled={disabled}
      onPressIn={handleIn}
      onPressOut={handleOut}
      style={[style, enabled && pressStyle]}
    />
  );
}
