import React, { useEffect } from "react";
import { StyleSheet, View, ViewStyle, StyleProp } from "react-native";
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withRepeat,
  withSequence,
  withTiming,
} from "react-native-reanimated";

import { colors, radius, spacing } from "../tokens";

// Shimmer: highlight sweeps left → right on a loop, on the UI thread.
function useShimmer() {
  const highlight = useSharedValue(0);
  useEffect(() => {
    highlight.value = withDelay(
      120,
      withRepeat(
        withSequence(
          withTiming(1, { duration: 750 }),
          withTiming(0, { duration: 750 }),
        ),
        -1,
        false,
      ),
    );
  }, [highlight]);

  return useAnimatedStyle(() => ({
    opacity: 0.55 + highlight.value * 0.45,
  }));
}

type SkeletonProps = {
  width?: number | string;
  height?: number | string;
  borderRadius?: number;
  style?: StyleProp<ViewStyle>;
};

export function Skeleton({ width = "100%", height = 16, borderRadius, style }: SkeletonProps) {
  const shimmer = useShimmer();
  const dimStyle: ViewStyle = {
    width: width as ViewStyle["width"],
    height: height as ViewStyle["height"],
    borderRadius: borderRadius ?? radius.sm,
  };
  return (
    <Animated.View
      // Wrap shimmer in an array so the static dims + animated opacity compose.
      style={[styles.base, dimStyle, shimmer, style]}
    />
  );
}

type SkeletonLineProps = { width?: number | string; last?: boolean; style?: StyleProp<ViewStyle> };

export function SkeletonLine({ width = "100%", last = false, style }: SkeletonLineProps) {
  return (
    <Skeleton
      width={width}
      height={13}
      style={[{ marginBottom: last ? 0 : spacing.sm }, style]}
    />
  );
}

type SkeletonCardProps = { lines?: number; style?: StyleProp<ViewStyle> };

export function SkeletonCard({ lines = 3, style }: SkeletonCardProps) {
  return (
    <View style={[styles.card, style]}>
      <Skeleton width="55%" height={18} />
      <View style={styles.spacer} />
      {Array.from({ length: lines }).map((_, index) => (
        <SkeletonLine
          key={index}
          width={index === lines - 1 ? "70%" : "100%"}
          last={index === lines - 1}
        />
      ))}
      <View style={styles.buttonRow}>
        <Skeleton width={92} height={36} borderRadius={radius.md} />
      </View>
    </View>
  );
}

type SkeletonListProps = { count?: number; style?: StyleProp<ViewStyle> };

export function SkeletonList({ count = 3, style }: SkeletonListProps) {
  return (
    <View style={[styles.list, style]}>
      {Array.from({ length: count }).map((_, index) => (
        <SkeletonCard key={index} />
      ))}
    </View>
  );
}

// Metric / stat placeholder used on dashboards.
export function SkeletonMetric() {
  return (
    <View style={styles.metric}>
      <Skeleton width={40} height={28} />
      <Skeleton width={56} height={12} />
    </View>
  );
}

const styles = StyleSheet.create({
  base: {
    backgroundColor: colors.shimmerBase,
  },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.lg,
  },
  spacer: {
    height: spacing.md,
  },
  buttonRow: {
    flexDirection: "row",
    marginTop: spacing.md,
  },
  list: {
    gap: spacing.md,
  },
  metric: {
    flex: 1,
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.lg,
    gap: spacing.xs,
    alignItems: "center",
  },
});
