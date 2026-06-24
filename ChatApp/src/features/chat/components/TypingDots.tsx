import { useEffect } from "react";
import { StyleSheet, View } from "react-native";
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withRepeat,
  withSequence,
  withTiming,
} from "react-native-reanimated";

import { colors, spacing } from "../../../design";

/** Three pulsing dots shown while the assistant spins up its first token. */
export function TypingDots() {
  const a = useSharedValue(0.3);
  const b = useSharedValue(0.3);
  const c = useSharedValue(0.3);

  useEffect(() => {
    const loop = () =>
      withRepeat(
        withSequence(withTiming(1, { duration: 380 }), withTiming(0.3, { duration: 380 })),
        -1,
        false,
      );
    a.value = loop();
    b.value = withDelay(140, loop());
    c.value = withDelay(280, loop());
  }, [a, b, c]);

  const s1 = useAnimatedStyle(() => ({ opacity: a.value }));
  const s2 = useAnimatedStyle(() => ({ opacity: b.value }));
  const s3 = useAnimatedStyle(() => ({ opacity: c.value }));

  return (
    <View style={styles.row}>
      <Animated.View style={[styles.dot, s1]} />
      <Animated.View style={[styles.dot, s2]} />
      <Animated.View style={[styles.dot, s3]} />
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    gap: 5,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.xs,
  },
  dot: {
    width: 7,
    height: 7,
    borderRadius: 4,
    backgroundColor: colors.textTertiary,
  },
});
