import React, { useState } from "react";
import {
  StyleSheet,
  TextInput,
  TextInputProps,
  View,
  StyleProp,
  ViewStyle,
} from "react-native";

import { colors, radius, spacing, typography } from "../tokens";
import { AppText } from "./AppText";

type AppInputProps = TextInputProps & {
  label?: string;
  containerStyle?: StyleProp<ViewStyle>;
  leading?: React.ReactNode;
  trailing?: React.ReactNode;
  invalid?: boolean;
};

export function AppInput({
  label,
  containerStyle,
  leading,
  trailing,
  invalid,
  style,
  multiline,
  onFocus,
  onBlur,
  ...props
}: AppInputProps) {
  const [focused, setFocused] = useState(false);

  return (
    <View style={[styles.wrapper, containerStyle]}>
      {label ? (
        <AppText variant="label" tone="secondary" style={styles.label}>
          {label}
        </AppText>
      ) : null}
      <View
        style={[
          styles.field,
          multiline && styles.fieldMultiline,
          focused && styles.fieldFocused,
          invalid && styles.fieldInvalid,
        ]}
      >
        {leading ? <View style={styles.leading}>{leading}</View> : null}
        <TextInput
          {...props}
          multiline={multiline}
          placeholderTextColor={colors.textMuted}
          onFocus={(e) => {
            setFocused(true);
            onFocus?.(e);
          }}
          onBlur={(e) => {
            setFocused(false);
            onBlur?.(e);
          }}
          style={[styles.input, multiline && styles.inputMultiline, style]}
          textAlignVertical={multiline ? "top" : "center"}
        />
        {trailing ? <View style={styles.trailing}>{trailing}</View> : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    gap: spacing.sm,
  },
  label: {
    marginLeft: spacing.xs,
  },
  field: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    flexDirection: "row",
    alignItems: "center",
    minHeight: 48,
  },
  fieldMultiline: {
    minHeight: 110,
    alignItems: "stretch",
    paddingVertical: spacing.sm,
  },
  fieldFocused: {
    borderColor: colors.focus,
  },
  fieldInvalid: {
    borderColor: colors.danger,
  },
  leading: {
    marginRight: spacing.sm,
  },
  trailing: {
    marginLeft: spacing.sm,
  },
  input: {
    flex: 1,
    fontSize: typography.body.fontSize,
    color: colors.text,
    paddingVertical: spacing.sm,
  },
  inputMultiline: {
    minHeight: 96,
  },
});
