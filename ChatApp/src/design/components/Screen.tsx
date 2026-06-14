import React from "react";
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, View, ViewProps } from "react-native";
import { SafeAreaView, type Edge } from "react-native-safe-area-context";

import { colors, spacing } from "../tokens";

type ScreenProps = ViewProps & {
  scroll?: boolean;
  edges?: ReadonlyArray<Edge>;
  avoidKeyboard?: boolean;
};

export function Screen({
  scroll = false,
  edges = ["top", "left", "right"],
  avoidKeyboard = true,
  style,
  children,
  ...props
}: ScreenProps) {
  const content = scroll ? (
    <ScrollView
      contentContainerStyle={[styles.scrollContent, style]}
      showsVerticalScrollIndicator={false}
      keyboardShouldPersistTaps="handled"
      {...props}
    >
      {children}
    </ScrollView>
  ) : (
    <View {...props} style={[styles.content, style]}>
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
});
