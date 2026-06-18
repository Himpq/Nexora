import React from "react";
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, View, ViewProps } from "react-native";
import { SafeAreaView, type Edge } from "react-native-safe-area-context";

import { colors, spacing } from "../tokens";

type ScreenProps = ViewProps & {
  scroll?: boolean;
  edges?: ReadonlyArray<Edge>;
  avoidKeyboard?: boolean;
  /** Reserve bottom space for the floating tab bar (tab-level screens only). */
  tabBarSpace?: boolean;
};

export function Screen({
  scroll = false,
  edges = ["top", "left", "right"],
  avoidKeyboard = true,
  tabBarSpace = false,
  style,
  children,
  ...props
}: ScreenProps) {
  const bottomSpace = tabBarSpace ? styles.tabBarSpace : null;
  const content = scroll ? (
    <ScrollView
      contentContainerStyle={[styles.scrollContent, bottomSpace, style]}
      showsVerticalScrollIndicator={false}
      keyboardShouldPersistTaps="handled"
      {...props}
    >
      {children}
    </ScrollView>
  ) : (
    <View {...props} style={[styles.content, bottomSpace, style]}>
      {children}
    </View>
  );

  return (
    <SafeAreaView style={styles.safeArea} edges={edges}>
      {avoidKeyboard ? (
        <KeyboardAvoidingView
          style={styles.flex}
          behavior={Platform.OS === "ios" ? "padding" : "height"}
        >
          {content}
        </KeyboardAvoidingView>
      ) : (
        content
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: colors.background,
  },
  flex: {
    flex: 1,
  },
  content: {
    flex: 1,
    padding: spacing.lg,
    gap: spacing.lg,
  },
  scrollContent: {
    flexGrow: 1,
    padding: spacing.lg,
    gap: spacing.lg,
  },
  // Clear the floating tab bar (~64 bar + safe-area padding).
  tabBarSpace: {
    paddingBottom: 96,
  },
});
