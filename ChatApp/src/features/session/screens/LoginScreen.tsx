import React, { useState, useEffect, useRef } from "react";
import {
  StyleSheet,
  View,
  Text,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  Animated,
  Easing,
  ScrollView,
  StatusBar,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { useSession } from "../../../app/providers/SessionProvider";
import { ApiClientError, chatApiClient } from "../../../services/apiClient";
import {
  AppButton,
  AppInput,
  AppText,
  colors,
  radius,
  shadow,
  spacing,
} from "../../../design";

// 0..3 trailing dots cycling, echoing Nexora web's multi-phase dot animation.
const DOT_PHASES = [1, 1, 2, 3, 3, 3, 2, 1, 0];

function BrandPanel() {
  const [dotCount, setDotCount] = useState(1);

  useEffect(() => {
    let tick = 0;
    const interval = setInterval(() => {
      setDotCount(DOT_PHASES[tick % DOT_PHASES.length]);
      tick++;
    }, 340);
    return () => clearInterval(interval);
  }, []);

  return (
    <View style={styles.brandPanel}>
      <View style={styles.brandMark}>
        <Text style={styles.brandMarkText}>N</Text>
      </View>
      <Text style={styles.wordmark}>
        Nexora
        <Text style={[styles.wordmarkDot, { opacity: dotCount > 0 ? 1 : 0.18 }]}>.</Text>
        <Text style={[styles.wordmarkDot, { opacity: dotCount > 1 ? 1 : 0.18 }]}>.</Text>
        <Text style={[styles.wordmarkDot, { opacity: dotCount > 2 ? 1 : 0.18 }]}>.</Text>
      </Text>
      <Text style={styles.tagline}>CONNECT · REMEMBER · KNOW</Text>
    </View>
  );
}

export function LoginScreen() {
  const { setUsername } = useSession();

  const [draftUsername, setDraftUsername] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  const fadeAnim = useRef(new Animated.Value(0)).current;
  const slideAnim = useRef(new Animated.Value(24)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.timing(fadeAnim, {
        toValue: 1,
        duration: 560,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }),
      Animated.timing(slideAnim, {
        toValue: 0,
        duration: 560,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }),
    ]).start();
  }, [fadeAnim, slideAnim]);

  async function handleLogin() {
    const normalizedUsername = draftUsername.trim();
    if (!normalizedUsername || !password) {
      setError("请输入用户名和密码");
      return;
    }

    setSubmitting(true);
    setError("");

    try {
      const response = await chatApiClient.postJson<any>("/login", {
        username: normalizedUsername,
        password,
      });

      if (response.success) {
        await setUsername(normalizedUsername);
      } else {
        setError(response.message || "登录失败");
      }
    } catch (err) {
      if (err instanceof ApiClientError) {
        setError(err.message || "登录失败");
      } else {
        setError("网络错误，请稍后重试");
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <SafeAreaView style={styles.screen} edges={["top", "bottom", "left", "right"]}>
      <StatusBar barStyle="dark-content" backgroundColor={colors.background} />
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        style={styles.flex}
      >
        <ScrollView
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <Animated.View
            style={[
              styles.content,
              { opacity: fadeAnim, transform: [{ translateY: slideAnim }] },
            ]}
          >
            <BrandPanel />

            <View style={styles.formCard}>
              <View style={styles.header}>
                <AppText variant="title">欢迎回来</AppText>
                <AppText variant="body" tone="secondary">
                  登录以继续你的学习旅程
                </AppText>
              </View>

              {error ? (
                <View style={styles.errorBox}>
                  <Text style={styles.errorMark}>!</Text>
                  <AppText variant="caption" tone="danger" style={styles.errorText}>
                    {error}
                  </AppText>
                </View>
              ) : null}

              <AppInput
                label="用户名"
                placeholder="输入您的用户名"
                value={draftUsername}
                onChangeText={(text) => {
                  setDraftUsername(text);
                  if (error) setError("");
                }}
                autoCapitalize="none"
                autoCorrect={false}
                editable={!submitting}
                returnKeyType="next"
                invalid={Boolean(error)}
              />

              <AppInput
                label="密码"
                placeholder="输入您的密码"
                value={password}
                onChangeText={(text) => {
                  setPassword(text);
                  if (error) setError("");
                }}
                secureTextEntry={!showPassword}
                autoCapitalize="none"
                editable={!submitting}
                returnKeyType="done"
                onSubmitEditing={handleLogin}
                invalid={Boolean(error)}
                trailing={
                  <Pressable
                    hitSlop={8}
                    onPress={() => setShowPassword((value) => !value)}
                  >
                    <AppText variant="caption" tone="muted">
                      {showPassword ? "隐藏" : "显示"}
                    </AppText>
                  </Pressable>
                }
              />

              <AppButton
                title="登 录"
                onPress={handleLogin}
                loading={submitting}
                fullWidth
                style={styles.submit}
              />
            </View>

            <AppText variant="caption" tone="muted" style={styles.footnote}>
              登录即表示同意 Nexora 的服务条款与隐私政策
            </AppText>
          </Animated.View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.background,
  },
  flex: {
    flex: 1,
  },
  scrollContent: {
    flexGrow: 1,
    justifyContent: "center",
    padding: spacing.xl,
  },
  content: {
    width: "100%",
    maxWidth: 420,
    alignSelf: "center",
    gap: spacing.xl,
  },
  brandPanel: {
    alignItems: "center",
    backgroundColor: colors.surfaceInverse,
    borderRadius: radius.xl,
    paddingVertical: spacing.xxl,
    paddingHorizontal: spacing.xl,
    gap: spacing.md,
    ...shadow.lg,
  },
  brandMark: {
    width: 56,
    height: 56,
    borderRadius: radius.lg,
    backgroundColor: colors.surface,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: spacing.xs,
  },
  brandMarkText: {
    color: colors.surfaceInverse,
    fontSize: 30,
    fontWeight: "800",
    includeFontPadding: false,
  },
  wordmark: {
    color: colors.textInverse,
    fontSize: 40,
    fontWeight: "800",
    letterSpacing: -1,
    includeFontPadding: false,
    textAlign: "center",
  },
  wordmarkDot: {
    color: colors.textMuted,
  },
  tagline: {
    color: "rgba(255,255,255,0.6)",
    fontSize: 11,
    letterSpacing: 3,
    textTransform: "uppercase",
    fontWeight: "600",
  },
  formCard: {
    backgroundColor: colors.surface,
    borderRadius: radius.xl,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.xl,
    gap: spacing.lg,
    ...shadow.md,
  },
  header: {
    gap: spacing.xs,
    marginBottom: spacing.xs,
  },
  errorBox: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    backgroundColor: colors.dangerMuted,
    borderRadius: radius.md,
    padding: spacing.md,
  },
  errorMark: {
    width: 18,
    height: 18,
    borderRadius: 9,
    textAlign: "center",
    lineHeight: 18,
    fontSize: 12,
    fontWeight: "800",
    color: colors.surface,
    backgroundColor: colors.danger,
    overflow: "hidden",
  },
  errorText: {
    flex: 1,
  },
  submit: {
    marginTop: spacing.sm,
  },
  footnote: {
    textAlign: "center",
  },
});
