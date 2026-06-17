import React, { useEffect, useState } from "react";
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withSpring,
} from "react-native-reanimated";

import { useSession } from "../../../app/providers/SessionProvider";
import { ApiClientError, chatApiClient } from "../../../services/apiClient";
import {
  AppButton,
  AppInput,
  AppText,
  colors,
  haptics,
  motion,
  radius,
  spacing,
} from "../../../design";
import { BrandMark3D } from "../components/BrandMark3D";
import { BrandWordmark } from "../components/BrandWordmark";

type Mode = "landing" | "admin";

export function LoginScreen() {
  const { setUsername } = useSession();
  const { width } = useWindowDimensions();
  const insets = useSafeAreaInsets();

  const [mode, setMode] = useState<Mode>("landing");
  const [draftUsername, setDraftUsername] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [comingSoon, setComingSoon] = useState(false);

  // Horizontal page transition: 0 = landing, 1 = admin.
  const page = useSharedValue(0);
  useEffect(() => {
    page.value = withSpring(mode === "admin" ? 1 : 0, motion.spring.gentle);
  }, [mode, page]);

  // Staggered entrance on the landing page: greeting → mark → wordmark → actions.
  const greeting = useSharedValue(0);
  const mark = useSharedValue(0);
  const word = useSharedValue(0);
  const actions = useSharedValue(0);

  useEffect(() => {
    const enter = (v: typeof greeting, delay: number) => {
      v.value = withDelay(delay, withSpring(1, motion.spring.gentle));
    };
    enter(greeting, 60);
    enter(mark, 160);
    enter(word, 320);
    enter(actions, 460);
  }, [greeting, mark, word, actions]);

  const greetingStyle = useEntranceStyle(greeting);
  const markStyle = useEntranceStyle(mark);
  const wordStyle = useEntranceStyle(word);
  const actionsStyle = useEntranceStyle(actions);

  const landingStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: -page.value * width }],
    opacity: 1 - page.value * 0.4,
  }));
  const adminStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: (1 - page.value) * width }],
  }));

  async function handleLogin() {
    const normalizedUsername = draftUsername.trim();
    if (!normalizedUsername || !password) {
      setError("请输入账号和密码");
      haptics.notify("error");
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
        haptics.notify("success");
        await setUsername(normalizedUsername);
      } else {
        setError(response.message || "登录失败");
        haptics.notify("error");
      }
    } catch (err) {
      if (err instanceof ApiClientError) {
        setError(err.message || "登录失败");
      } else {
        setError("网络错误，请稍后重试");
      }
      haptics.notify("error");
    } finally {
      setSubmitting(false);
    }
  }

  function handleUserLogin() {
    haptics.impact("light");
    setComingSoon(true);
    setTimeout(() => setComingSoon(false), 2200);
  }

  function goAdmin() {
    haptics.impact("light");
    setComingSoon(false);
    setMode("admin");
  }

  function goLanding() {
    haptics.impact("light");
    setError("");
    setMode("landing");
  }

  return (
    <View style={styles.screen}>
      <StatusBar barStyle="dark-content" backgroundColor={colors.background} />

      {/* ---- Landing page ------------------------------------------------ */}
      <Animated.View
        style={[StyleSheet.absoluteFill, landingStyle]}
        pointerEvents={mode === "landing" ? "auto" : "none"}
      >
        <View
          style={[
            styles.landing,
            { paddingTop: insets.top + spacing.sm, paddingBottom: insets.bottom + spacing.md },
          ]}
        >
          <Animated.View style={[styles.header, greetingStyle]}>
            <Text style={styles.welcome}>欢迎回来</Text>
          </Animated.View>

          <View style={styles.spacerTop} />

          <View style={styles.brandZone}>
            <Animated.View style={markStyle}>
              <BrandMark3D />
            </Animated.View>
            <Animated.View style={[styles.wordmarkWrap, wordStyle]}>
              <BrandWordmark />
            </Animated.View>
          </View>

          <View style={styles.spacerMid} />

          <Animated.View style={[styles.actions, actionsStyle]}>
            <AppButton
              title="用户登录"
              variant="primary"
              fullWidth
              style={styles.pill}
              onPress={handleUserLogin}
            />
            <AppButton
              title="管理员登录"
              variant="outline"
              fullWidth
              style={styles.pill}
              onPress={goAdmin}
            />
            <View style={styles.hintSlot}>
              {comingSoon ? (
                <AppText variant="caption" tone="muted" style={styles.hintText}>
                  用户登录即将开放
                </AppText>
              ) : null}
            </View>
          </Animated.View>

          <View style={styles.spacerBottom} />
        </View>
      </Animated.View>

      {/* ---- Admin login page -------------------------------------------- */}
      <Animated.View
        style={[StyleSheet.absoluteFill, adminStyle]}
        pointerEvents={mode === "admin" ? "auto" : "none"}
      >
        <KeyboardAvoidingView
          behavior={Platform.OS === "ios" ? "padding" : undefined}
          style={[styles.flex, { paddingTop: insets.top }]}
        >
          <View style={styles.adminTopBar}>
            <Pressable onPress={goLanding} hitSlop={12} style={styles.backBtn}>
              <Ionicons name="chevron-back" size={26} color={colors.text} />
            </Pressable>
          </View>

          <ScrollView
            contentContainerStyle={[
              styles.adminContent,
              { paddingBottom: insets.bottom + spacing.xl },
            ]}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
          >
            <AppText variant="title" style={styles.adminTitle}>
              管理员登录
            </AppText>

            {error ? (
              <View style={styles.errorBox}>
                <Text style={styles.errorMark}>!</Text>
                <AppText variant="caption" style={styles.errorText}>
                  {error}
                </AppText>
              </View>
            ) : null}

            <AppInput
              placeholder="请输入账号"
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
              placeholder="请输入密码"
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
                <Pressable hitSlop={8} onPress={() => setShowPassword((v) => !v)}>
                  <AppText variant="caption" tone="tertiary">
                    {showPassword ? "隐藏" : "显示"}
                  </AppText>
                </Pressable>
              }
            />

            <AppButton
              title="登 录"
              onPress={handleLogin}
              loading={submitting}
              variant="primary"
              fullWidth
              style={styles.adminSubmit}
            />
          </ScrollView>
        </KeyboardAvoidingView>
      </Animated.View>
    </View>
  );
}

// Shared entrance transform (fade + lift) driven by a 0→1 spring value.
function useEntranceStyle(progress: { value: number }) {
  return useAnimatedStyle(() => ({
    opacity: progress.value,
    transform: [{ translateY: (1 - progress.value) * 18 }],
  }));
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.background,
  },
  flex: {
    flex: 1,
  },

  // Landing
  landing: {
    flex: 1,
    paddingHorizontal: spacing.xl,
  },
  header: {
    alignItems: "center",
  },
  welcome: {
    color: colors.text,
    fontSize: 18,
    fontWeight: "700",
    letterSpacing: -0.2,
  },
  // Vertical rhythm tuned to Doubao: brand sits ~37%, buttons ~73%.
  spacerTop: {
    flex: 1,
  },
  spacerMid: {
    flex: 1,
  },
  spacerBottom: {
    flex: 0.8,
  },
  brandZone: {
    alignItems: "center",
  },
  wordmarkWrap: {
    marginTop: spacing.sm,
  },
  actions: {
    gap: spacing.md,
  },
  pill: {
    minHeight: 54,
    borderRadius: radius.pill,
  },
  hintSlot: {
    height: 18,
    alignItems: "center",
    justifyContent: "center",
  },
  hintText: {
    textAlign: "center",
  },

  // Admin
  adminTopBar: {
    height: 48,
    justifyContent: "center",
    paddingHorizontal: spacing.sm,
  },
  backBtn: {
    width: 40,
    height: 40,
    alignItems: "center",
    justifyContent: "center",
  },
  adminContent: {
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.xl,
    gap: spacing.lg,
  },
  adminTitle: {
    textAlign: "center",
    marginBottom: spacing.lg,
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
    color: colors.danger,
  },
  adminSubmit: {
    marginTop: spacing.sm,
    minHeight: 52,
    borderRadius: radius.pill,
  },
});
