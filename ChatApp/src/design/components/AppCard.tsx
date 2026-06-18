import React from "react";
import { StyleSheet, View, ViewProps, StyleProp, ViewStyle } from "react-native";

import { colors, radius, shadow, spacing } from "../tokens";
import { AnimatedPressable } from "./AnimatedPressable";

type AppCardProps = ViewProps & {
  variant?: "elevated" | "outlined" | "muted" | "flat";
  padded?: boolean;
  /** When set, the card becomes a spring-pressed, haptic tappable surface. */
  onPress?: () => void;
  /** Highlight (selected) state — ink border + subtle lift. */
  active?: boolean;
  pressStyle?: StyleProp<ViewStyle>;
};

export function AppCard({
  variant = "elevated",
  padded = true,
  onPress,
  active = false,
  style,
  ...props
}: AppCardProps) {
  const composed = [
    styles.base,
    padded && styles.padded,
    variantStyles[variant],
    active && styles.active,
    style,
  ];

  if (onPress) {
    const { pressStyle, ...rest } = props as AppCardProps;
    return (
      <AnimatedPressable onPress={onPress} style={composed} press={{ pressedScale: 0.985 }} {...rest}>
        {props.children}
      </AnimatedPressable>
    );
  }

  return <View {...props} style={composed} />;
}

const styles = StyleSheet.create({
  base: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
  },
  padded: {
    padding: spacing.lg,
  },
  active: {
    borderColor: colors.primary,
    borderWidth: 1.5,
    ...shadow.md,
  },
});

const variantStyles = StyleSheet.create({
  elevated: {
    borderWidth: 1,
    borderColor: colors.border,
    ...shadow.sm,
  },
  outlined: {
    borderWidth: 1,
    borderColor: colors.border,
  },
  muted: {
    backgroundColor: colors.surfaceMuted,
  },
  flat: {
    backgroundColor: colors.surface,
  },
});
