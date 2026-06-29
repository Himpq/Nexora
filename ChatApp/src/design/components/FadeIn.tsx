import React, { useEffect } from "react";
import type { StyleProp, ViewStyle } from "react-native";
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withTiming,
  Easing,
} from "react-native-reanimated";

import { motion } from "../tokens";

type FadeInProps = {
  children: React.ReactNode;
  /** Stagger index — multiplied by `gap` to delay this item's entrance. */
  index?: number;
  /** Per-index delay in ms (default motion.stagger.normal). */
  gap?: number;
  /** Base delay before the sequence starts. */
  delay?: number;
  /** Vertical lift distance (default 14). */
  offset?: number;
  style?: StyleProp<ViewStyle>;
};

/**
 * UI-thread fade + lift entrance. Wrap list items / cards and pass an `index`
 * to stagger them. Cheap enough to use liberally; runs once on mount.
 */
export function FadeIn({ children, index = 0, gap, delay = 0, offset = 14, style }: FadeInProps) {
  const progress = useSharedValue(0);
  const totalDelay = delay + index * (gap ?? motion.stagger.normal);

  useEffect(() => {
    progress.value = withDelay(
      totalDelay,
      withTiming(1, { duration: motion.duration.entrance, easing: Easing.out(Easing.cubic) }),
    );
  }, [progress, totalDelay]);

  const animatedStyle = useAnimatedStyle(() => ({
    opacity: progress.value,
    transform: [{ translateY: (1 - progress.value) * offset }],
  }));

  return <Animated.View style={[animatedStyle, style]}>{children}</Animated.View>;
}
