import { useEffect, useRef } from "react";
import { StyleSheet, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withSequence,
  withSpring,
  withTiming,
} from "react-native-reanimated";

import { AnimatedPressable, AppText, colors, motion, radius, spacing } from "../../../design";

type LikeButtonProps = {
  liked: boolean;
  count: number;
  size?: "sm" | "md";
  onPress: () => void;
};

/**
 * Thumbs-up like control with a satisfying tap response.
 *
 * On the not-liked → liked transition the thumb springs up with a slight
 * overshoot while a soft ink ring bursts outward and fades — the visual
 * payoff that makes a like feel committed. Un-liking is quiet on purpose.
 * Presentation only: the parent owns the (optimistic) state and the network.
 */
export function LikeButton({ liked, count, size = "md", onPress }: LikeButtonProps) {
  const iconSize = size === "sm" ? 15 : 18;
  const scale = useSharedValue(1);
  const burst = useSharedValue(0);
  const wasLiked = useRef(liked);

  useEffect(() => {
    if (liked && !wasLiked.current) {
      scale.value = withSequence(
        withTiming(1.36, { duration: 120, easing: Easing.out(Easing.quad) }),
        withSpring(1, motion.spring.snappy),
      );
      burst.value = 0;
      burst.value = withTiming(1, { duration: 460, easing: Easing.out(Easing.quad) });
    }
    wasLiked.current = liked;
  }, [liked, scale, burst]);

  const iconStyle = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));
  const burstStyle = useAnimatedStyle(() => ({
    opacity: burst.value > 0 ? (1 - burst.value) * 0.4 : 0,
    transform: [{ scale: 0.5 + burst.value * 1.5 }],
  }));

  const tint = liked ? colors.text : colors.textTertiary;
  const ringSize = iconSize + 8;

  return (
    <AnimatedPressable
      onPress={onPress}
      silent
      press={{ pressedScale: 0.86, preset: "snappy" }}
      hitSlop={6}
      style={[styles.btn, size === "sm" ? styles.btnSm : styles.btnMd, liked && styles.btnLiked]}
    >
      <View style={styles.iconWrap}>
        <Animated.View
          pointerEvents="none"
          style={[
            styles.burst,
            { width: ringSize, height: ringSize, borderRadius: ringSize / 2 },
            burstStyle,
          ]}
        />
        <Animated.View style={iconStyle}>
          <Ionicons name={liked ? "thumbs-up" : "thumbs-up-outline"} size={iconSize} color={tint} />
        </Animated.View>
      </View>
      {count > 0 ? (
        <AppText variant="caption" style={[styles.count, { color: tint }, liked && styles.countLiked]}>
          {count}
        </AppText>
      ) : null}
    </AnimatedPressable>
  );
}

const styles = StyleSheet.create({
  btn: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
    borderRadius: radius.pill,
  },
  btnMd: {
    paddingVertical: 6,
    paddingHorizontal: spacing.sm,
  },
  btnSm: {
    paddingVertical: 3,
    paddingHorizontal: spacing.xs,
  },
  btnLiked: {
    backgroundColor: colors.primaryMuted,
  },
  iconWrap: {
    alignItems: "center",
    justifyContent: "center",
  },
  burst: {
    position: "absolute",
    backgroundColor: colors.primary,
  },
  count: {
    fontWeight: "600",
    includeFontPadding: false,
  },
  countLiked: {
    fontWeight: "700",
  },
});
