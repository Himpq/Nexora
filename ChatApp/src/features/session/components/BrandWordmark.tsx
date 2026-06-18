import React, { useEffect } from "react";
import { StyleSheet, Text, View } from "react-native";
import Animated, {
  Easing,
  Extrapolation,
  interpolate,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from "react-native-reanimated";

import { colors } from "../../../design";

// One master clock (0→1, looped) drives the whole reveal so every element stays
// in sync with no React re-renders. Phases, as fractions of the loop:
//   dot1 appears, then blinks twice → settles on   (0.00 .. 0.26)
//   dot2 fades in                                   (0.30 .. 0.37)
//   dot3 fades in                                   (0.40 .. 0.47)
//   "?" fades in                                    (0.52 .. 0.60)
//   full mark holds                                 (.. 0.92)
//   everything fades out, loop restarts             (0.92 .. 0.99)
const PERIOD = 4600;

const DOT_SIZE = 9;

function useReveal(
  clock: { value: number },
  input: number[],
  output: number[],
) {
  return useAnimatedStyle(() => {
    const opacity = interpolate(clock.value, input, output, Extrapolation.CLAMP);
    return {
      opacity,
      transform: [{ scale: 0.7 + 0.3 * opacity }],
    };
  });
}

// "Nexora" with the signature reveal: round dots (first one blinks twice) and a
// trailing "?", echoing the brand's "still thinking" motion.
export function BrandWordmark() {
  const clock = useSharedValue(0);

  useEffect(() => {
    clock.value = 0;
    clock.value = withRepeat(
      withTiming(1, { duration: PERIOD, easing: Easing.linear }),
      -1,
      false,
    );
  }, [clock]);

  // dot1: appear → off → on → off → on, then hold, then fade out at loop end.
  const dot1 = useReveal(
    clock,
    [0, 0.05, 0.1, 0.15, 0.2, 0.26, 0.92, 0.99],
    [0, 1, 0, 1, 0, 1, 1, 0],
  );
  const dot2 = useReveal(clock, [0, 0.3, 0.37, 0.92, 0.99], [0, 0, 1, 1, 0]);
  const dot3 = useReveal(clock, [0, 0.4, 0.47, 0.92, 0.99], [0, 0, 1, 1, 0]);

  const question = useAnimatedStyle(() => ({
    opacity: interpolate(
      clock.value,
      [0, 0.52, 0.6, 0.92, 0.99],
      [0, 0, 1, 1, 0],
      Extrapolation.CLAMP,
    ),
  }));

  return (
    <View style={styles.row}>
      <Text style={styles.word}>Nexora</Text>
      <View style={styles.dots}>
        <Animated.View style={[styles.dot, dot1]} />
        <Animated.View style={[styles.dot, dot2]} />
        <Animated.View style={[styles.dot, dot3]} />
      </View>
      <Animated.Text style={[styles.question, question]}>?</Animated.Text>
    </View>
  );
}

// Dots trail along the baseline (bottom-right of the "a"), like an ellipsis.

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    alignItems: "flex-end",
    justifyContent: "center",
  },
  word: {
    color: colors.text,
    fontSize: 34,
    fontWeight: "800",
    letterSpacing: -0.5,
    includeFontPadding: false,
  },
  dots: {
    flexDirection: "row",
    alignItems: "flex-end",
    marginLeft: 10,
    marginBottom: 7,
  },
  dot: {
    width: DOT_SIZE,
    height: DOT_SIZE,
    borderRadius: DOT_SIZE / 2,
    backgroundColor: colors.text,
    marginHorizontal: 5,
  },
  question: {
    color: colors.text,
    fontSize: 34,
    fontWeight: "800",
    letterSpacing: -0.5,
    includeFontPadding: false,
    marginLeft: 8,
  },
});
