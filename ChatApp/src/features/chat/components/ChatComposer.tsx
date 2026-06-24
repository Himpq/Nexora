import { Platform, Pressable, StyleSheet, TextInput, View } from "react-native";
import type { NativeSyntheticEvent, TextInputKeyPressEventData } from "react-native";
import { Feather } from "@expo/vector-icons";

import { AppText, colors, haptics, radius, spacing } from "../../../design";

type ComposerChipProps = {
  icon: keyof typeof Feather.glyphMap;
  label: string;
  active?: boolean;
  trailingIcon?: keyof typeof Feather.glyphMap;
  onPress: () => void;
};

function ComposerChip({ icon, label, active, trailingIcon, onPress }: ComposerChipProps) {
  return (
    <Pressable
      style={[styles.chip, active && styles.chipActive]}
      onPress={() => {
        haptics.selection();
        onPress();
      }}
      hitSlop={4}
    >
      <Feather name={icon} size={13} color={active ? colors.onPrimary : colors.textSecondary} />
      <AppText
        variant="caption"
        style={[styles.chipText, active && styles.chipTextActive]}
        numberOfLines={1}
      >
        {label}
      </AppText>
      {trailingIcon ? (
        <Feather
          name={trailingIcon}
          size={12}
          color={active ? colors.onPrimary : colors.textTertiary}
        />
      ) : null}
    </Pressable>
  );
}

export function ChatComposer({
  value,
  onChangeText,
  onSend,
  onStop,
  busy,
  modelLabel,
  onPickModel,
  enableThinking,
  onToggleThinking,
  enableWebSearch,
  onToggleWebSearch,
  placeholder = "给 Nexora 发消息…",
}: {
  value: string;
  onChangeText: (text: string) => void;
  onSend: () => void;
  onStop: () => void;
  busy: boolean;
  modelLabel: string;
  onPickModel: () => void;
  enableThinking: boolean;
  onToggleThinking: () => void;
  enableWebSearch: boolean;
  onToggleWebSearch: () => void;
  placeholder?: string;
}) {
  const canSend = value.trim().length > 0 && !busy;

  // On web, Enter sends (Shift+Enter inserts a newline). On native the soft
  // keyboard's return inserts a newline as usual — sending stays on the button
  // so we don't fight the IME. blurOnSubmit=false keeps the field focused when
  // multiline submit is handled manually.
  const onKeyPress = (e: NativeSyntheticEvent<TextInputKeyPressEventData>) => {
    if (Platform.OS !== "web") {
      return;
    }
    if (e.nativeEvent.key !== "Enter") {
      return;
    }
    const shift = (e.nativeEvent as unknown as { shiftKey?: boolean }).shiftKey;
    if (shift) {
      return; // explicit newline
    }
    if (canSend) {
      haptics.impact("light");
      onSend();
    }
  };

  return (
    <View style={styles.wrap}>
      <TextInput
        value={value}
        onChangeText={onChangeText}
        multiline
        blurOnSubmit={false}
        onKeyPress={onKeyPress}
        placeholder={placeholder}
        placeholderTextColor={colors.textMuted}
        style={styles.input}
        textAlignVertical="top"
      />
      <View style={styles.row}>
        <View style={styles.chips}>
          <ComposerChip
            icon="cpu"
            label={modelLabel}
            trailingIcon="chevron-down"
            onPress={onPickModel}
          />
          <ComposerChip
            icon="zap"
            label="思考"
            active={enableThinking}
            onPress={onToggleThinking}
          />
          <ComposerChip
            icon="globe"
            label="联网"
            active={enableWebSearch}
            onPress={onToggleWebSearch}
          />
        </View>
        {busy ? (
          <Pressable
            style={styles.sendBtn}
            onPress={() => {
              haptics.selection();
              onStop();
            }}
            hitSlop={6}
          >
            <Feather name="square" size={16} color={colors.onPrimary} />
          </Pressable>
        ) : (
          <Pressable
            style={[styles.sendBtn, !canSend && styles.sendDisabled]}
            disabled={!canSend}
            onPress={() => {
              haptics.impact("light");
              onSend();
            }}
            hitSlop={6}
          >
            <Feather name="arrow-up" size={18} color={colors.onPrimary} />
          </Pressable>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.xl,
    padding: spacing.sm,
    gap: spacing.sm,
  },
  input: {
    color: colors.text,
    fontSize: 15,
    lineHeight: 21,
    minHeight: 24,
    maxHeight: 140,
    paddingHorizontal: spacing.sm,
    paddingTop: spacing.xs,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing.sm,
  },
  chips: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
  },
  chip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    maxWidth: 150,
    backgroundColor: colors.surfaceMuted,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.sm,
    paddingVertical: 6,
  },
  chipActive: {
    backgroundColor: colors.primary,
  },
  chipText: {
    color: colors.textSecondary,
    fontWeight: "600",
  },
  chipTextActive: {
    color: colors.onPrimary,
  },
  sendBtn: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: colors.primary,
    alignItems: "center",
    justifyContent: "center",
  },
  sendDisabled: {
    backgroundColor: colors.borderStrong,
  },
});
