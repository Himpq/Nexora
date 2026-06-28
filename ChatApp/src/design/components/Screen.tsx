import React from "react";
import {
  KeyboardAvoidingView,
  Platform,
  RefreshControl,
  ScrollView,
  StyleSheet,
  View,
  ViewProps,
} from "react-native";
import { SafeAreaView, type Edge } from "react-native-safe-area-context";

import { colors, spacing } from "../tokens";

type ScreenProps = ViewProps & {
  scroll?: boolean;
  edges?: ReadonlyArray<Edge>;
  avoidKeyboard?: boolean;
  /** Reserve bottom space for the floating tab bar (tab-level screens only). */
  tabBarSpace?: boolean;
  /** When provided (with `scroll`), enables pull-to-refresh. */
  onRefresh?: () => void;
  refreshing?: boolean;
};

// Wide-screen content ceiling: on phones (<760px) this is a no-op; on tablets
// and web it keeps text columns readable instead of stretching edge-to-edge.
const CONTENT_MAX_WIDTH = 760;

export function Screen({
  scroll = false,
  edges = ["top", "left", "right"],
  avoidKeyboard = true,
  tabBarSpace = false,
  onRefresh,
  refreshing = false,
  style,
  children,
  ...props
}: ScreenProps) {
  const bottomSpace = tabBarSpace ? styles.tabBarSpace : null;
  const canRefresh = scroll && typeof onRefresh === "function";
  const refreshControl = canRefresh ? (
    <RefreshControl
      refreshing={refreshing}
      onRefresh={onRefresh}
      tintColor={colors.textTertiary}
      colors={[colors.text]}
    />
  ) : undefined;

  const content = scroll ? (
    <ScrollView
      contentContainerStyle={[styles.scrollContent, bottomSpace, style]}
      showsVerticalScrollIndicator={false}
      keyboardShouldPersistTaps="handled"
      refreshControl={refreshControl}
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
    width: "100%",
    maxWidth: CONTENT_MAX_WIDTH,
    alignSelf: "center",
  },
  scrollContent: {
    flexGrow: 1,
    padding: spacing.lg,
    gap: spacing.lg,
    width: "100%",
    maxWidth: CONTENT_MAX_WIDTH,
    alignSelf: "center",
  },
  // Clear the floating tab bar (~64 bar + safe-area padding).
  tabBarSpace: {
    paddingBottom: 96,
  },
});
