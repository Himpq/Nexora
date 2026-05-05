import React from "react";
import {
  ActivityIndicator,
  Pressable,
  PressableProps,
  StyleSheet,
  StyleProp,
  ViewStyle,
} from "react-native";

import { colors, radius, spacing } from "../tokens";
import { AppText } from "./AppText";

type AppButtonProps = Omit<PressableProps, "style"> & {
  title: string;
  variant?: "primary" | "secondary" | "ghost";
  loading?: boolean;
  style?: StyleProp<ViewStyle>;
};

export function AppButton({
  title,
  variant = "primary",
  loading = false,
  disabled,
  style,
  ...props
}: AppButtonProps) {
  const isDisabled = disabled || loading;
  return (
    <Pressable
      {...props}
      disabled={isDisabled}
      style={({ pressed }) => [
        styles.base,
        variantStyles[variant],
        isDisabled && styles.disabled,
        pressed && !isDisabled && styles.pressed,
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator color={variant === "primary" ? "#FFFFFF" : colors.primary} />
      ) : (
        <AppText
          variant="body"
          style={[
            styles.label,
            variant === "primary" ? styles.primaryLabel : styles.secondaryLabel,
          ]}
        >
          {title}
        </AppText>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    minHeight: 44,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radius.md,
    paddingHorizontal: spacing.lg,
  },
  label: {
    fontWeight: "700",
  },
  primaryLabel: {
    color: "#FFFFFF",
  },
  secondaryLabel: {
    color: colors.primary,
  },
  disabled: {
    opacity: 0.55,
  },
  pressed: {
    opacity: 0.82,
  },
});

const variantStyles = StyleSheet.create({
  primary: {
    backgroundColor: colors.primary,
  },
  secondary: {
    backgroundColor: colors.primaryMuted,
  },
  ghost: {
    backgroundColor: "transparent",
  },
});
