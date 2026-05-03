import { useState } from "react";
import { StyleSheet, TextInput } from "react-native";

import { useSession } from "../../../app/providers/SessionProvider";
import { AppButton, AppCard, AppText, Screen, colors, spacing } from "../../../design";

export function UserSetupScreen() {
  const { setUsername } = useSession();
  const [draftUsername, setDraftUsername] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  async function submitUsername() {
    const normalized = draftUsername.trim();
    if (!normalized) {
      setError("请输入 username。");
      return;
    }

    setSubmitting(true);
    setError("");
    try {
      await setUsername(normalized);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setError(message || "保存 username 失败。");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Screen>
      <AppCard style={styles.card}>
        <AppText variant="title">Nexora</AppText>
        <AppText tone="secondary">输入 username 后继续学习。</AppText>
        <TextInput
          placeholder="username"
          placeholderTextColor={colors.textMuted}
          value={draftUsername}
          onChangeText={setDraftUsername}
          onSubmitEditing={submitUsername}
          autoCapitalize="none"
          autoCorrect={false}
          editable={!submitting}
          returnKeyType="done"
          style={styles.input}
        />
        {error ? <AppText tone="danger">{error}</AppText> : null}
        <AppButton title="继续" loading={submitting} onPress={submitUsername} />
      </AppCard>
    </Screen>
  );
}

const styles = StyleSheet.create({
  card: {
    gap: spacing.lg,
  },
  input: {
    minHeight: 46,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    borderRadius: 8,
    paddingHorizontal: spacing.md,
    backgroundColor: colors.surface,
  },
});
