import React, { useCallback } from "react";
import {
  ActivityIndicator,
  Pressable,
  PressableProps,
  StyleSheet,
  StyleProp,
  ViewStyle,
} from "react-native";
import Animated from "react-native-reanimated";

import { colors, radius, shadow, spacing } from "../tokens";
import { haptics, type HapticIntensity } from "../hooks/useHaptic";
import { useSpringPress } from "../hooks/useSpringPress";
import { AppText } from "./AppText";

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

type AppButtonProps = Omit<PressableProps, "style"> & {
  title: string;
  variant?: "primary" | "secondary" | "ghost" | "outline" | "danger" | "onInverse";
  size?: "sm" | "md";
  loading?: boolean;
  fullWidth?: boolean;
  /** Haptic fired on press-in. Pass false to disable. */
  haptic?: HapticIntensity | false;
  style?: StyleProp<ViewStyle>;
};

export function AppButton({
  title,
  variant = "primary",
  size = "md",
  loading = false,
  fullWidth = false,
  haptic = variant === "primary" || variant === "danger" || variant === "onInverse"
    ? "light"
    : false,
  disabled,
  style,
  onPressIn,
  onPressOut,
  ...props
}: AppButtonProps) {
  const isDisabled = disabled || loading;
  const spinnerColor =
    variant === "primary" || variant === "danger"
      ? colors.onPrimary
      : variant === "onInverse"
        ? colors.text
        : colors.text;
  const { pressStyle, onPressIn: springIn, onPressOut: springOut } = useSpringPress({
    pressedScale: 0.97,
    preset: "responsive",
    haptic,
  });

  const handlePressIn = useCallback(
    (e: Parameters<NonNullable<PressableProps["onPressIn"]>>[0]) => {
      if (!isDisabled) springIn();
      onPressIn?.(e);
    },
    [isDisabled, onPressIn, springIn],
  );

  const handlePressOut = useCallback(
    (e: Parameters<NonNullable<PressableProps["onPressOut"]>>[0]) => {
      if (!isDisabled) springOut();
      onPressOut?.(e);
    },
    [isDisabled, onPressOut, springOut],
  );

  return (
    <AnimatedPressable
      {...props}
      disabled={isDisabled}
      onPressIn={handlePressIn}
      onPressOut={handlePressOut}
      style={[
        styles.base,
        size === "sm" ? styles.sizeSm : styles.sizeMd,
        variantStyles[variant],
        variant === "primary" && shadow.sm,
        variant === "onInverse" && shadow.md,
        fullWidth && styles.fullWidth,
        isDisabled && styles.disabled,
        !isDisabled && pressStyle,
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator color={spinnerColor} size="small" />
      ) : (
        <AppText variant={size === "sm" ? "label" : "bodyStrong"} style={labelStyles[variant]}>
          {title}
        </AppText>
      )}
    </AnimatedPressable>
  );
}

// Fire a notification haptic from outside (e.g. after a successful login submit).
export const buttonHaptics = haptics;

const styles = StyleSheet.create({
  base: {
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "row",
    borderRadius: radius.md,
  },
  sizeMd: {
    minHeight: 48,
    paddingHorizontal: spacing.lg,
  },
  sizeSm: {
    minHeight: 36,
    paddingHorizontal: spacing.md,
    borderRadius: radius.sm,
  },
  fullWidth: {
    alignSelf: "stretch",
  },
  disabled: {
    opacity: 0.4,
  },
});

const variantStyles = StyleSheet.create({
  primary: {
    backgroundColor: colors.primary,
  },
  secondary: {
    backgroundColor: colors.surfaceMuted,
  },
  ghost: {
    backgroundColor: "transparent",
  },
  outline: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.borderStrong,
  },
  danger: {
    backgroundColor: colors.danger,
  },
  onInverse: {
    backgroundColor: colors.surface,
  },
});

const labelStyles = StyleSheet.create({
  primary: { color: colors.onPrimary },
  secondary: { color: colors.text },
  ghost: { color: colors.text },
  outline: { color: colors.text },
  danger: { color: colors.onPrimary },
  onInverse: { color: colors.text },
});
