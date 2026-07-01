import { useCallback, useEffect, useRef, useState } from "react";
import {
  Keyboard,
  Modal,
  type NativeSyntheticEvent,
  Platform,
  Pressable,
  StyleSheet,
  TextInput,
  type TextInputSelectionChangeEventData,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Feather } from "@expo/vector-icons";
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";

import { AnimatedPressable, AppButton, colors, radius, shadow, spacing } from "../../../design";
import {
  filterMentionCandidates,
  getActiveMentionQuery,
  type MentionDirectory,
  type MentionUser,
} from "../mentions";
import { MentionInput } from "./MentionInput";
import { MentionUserPicker } from "./MentionUserPicker";

type CommentComposerProps = {
  visible: boolean;
  /** Full directory used to tint confirmed mentions inside the input. */
  directory: MentionDirectory;
  /** Candidates shown in the "@" picker (typically the directory minus self). */
  candidates: ReadonlyArray<MentionUser>;
  placeholder: string;
  submitting: boolean;
  onClose: () => void;
  onSubmit: (text: string) => void;
};

/**
 * Xiaohongshu / Bilibili-style comment bar that docks to the top of the keyboard
 * rather than dropping an inline box into the card. Implemented as a transparent
 * Modal so it floats above everything; the bar is hand-driven off the Keyboard
 * events (no KeyboardAvoidingView, which is unreliable inside an Android Modal).
 * The single tool on the bar is the "@" trigger — the rest of the toolbar from
 * the reference apps is omitted until the backend supports it.
 */
export function CommentComposer({
  visible,
  directory,
  candidates,
  placeholder,
  submitting,
  onClose,
  onSubmit,
}: CommentComposerProps) {
  const insets = useSafeAreaInsets();
  const bottomInset = insets.bottom;
  const [text, setText] = useState("");
  const [selection, setSelection] = useState({ start: 0, end: 0 });
  const inputRef = useRef<TextInput | null>(null);
  const keyboardHeight = useSharedValue(0);

  // Start each open with a clean draft and the caret at the top.
  useEffect(() => {
    if (visible) {
      setText("");
      setSelection({ start: 0, end: 0 });
      // autoFocus is flaky inside a freshly-mounted Modal; focus explicitly.
      const timer = setTimeout(() => inputRef.current?.focus(), 60);
      return () => clearTimeout(timer);
    }
    return undefined;
  }, [visible]);

  // Track the keyboard so the bar rides exactly on top of it.
  useEffect(() => {
    const showEvent = Platform.OS === "ios" ? "keyboardWillShow" : "keyboardDidShow";
    const hideEvent = Platform.OS === "ios" ? "keyboardWillHide" : "keyboardDidHide";
    const showSub = Keyboard.addListener(showEvent, (event) => {
      keyboardHeight.value = withTiming(event.endCoordinates?.height ?? 0, {
        duration: 220,
        easing: Easing.out(Easing.quad),
      });
    });
    const hideSub = Keyboard.addListener(hideEvent, () => {
      keyboardHeight.value = withTiming(0, { duration: 180, easing: Easing.out(Easing.quad) });
    });
    return () => {
      showSub.remove();
      hideSub.remove();
    };
  }, [keyboardHeight]);

  const activeQuery = getActiveMentionQuery(text, selection.start);
  const pickerUsers = activeQuery ? filterMentionCandidates(candidates, activeQuery.query) : [];

  const handleSelectionChange = useCallback(
    (event: NativeSyntheticEvent<TextInputSelectionChangeEventData>) => {
      setSelection(event.nativeEvent.selection);
    },
    [],
  );

  // The "@" button: drop an "@" at the caret (with a leading space if needed so
  // it actually starts a mention token) and let the picker take over.
  const handleMentionTrigger = useCallback(() => {
    const start = Math.max(0, Math.min(selection.start, text.length));
    const before = text.slice(0, start);
    const after = text.slice(start);
    const needsSpace = before.length > 0 && !/\s$/.test(before);
    const inserted = `${needsSpace ? " " : ""}@`;
    const caret = before.length + inserted.length;
    setText(before + inserted + after);
    setSelection({ start: caret, end: caret });
    inputRef.current?.focus();
  }, [selection.start, text]);

  // Replace the in-progress "@query" with the chosen "@handle ".
  const handleSelectMention = useCallback(
    (user: MentionUser) => {
      if (!activeQuery) return;
      const cursor = Math.max(0, Math.min(selection.start, text.length));
      const before = text.slice(0, activeQuery.start);
      const after = text.slice(cursor);
      const inserted = `@${user.handle} `;
      const caret = before.length + inserted.length;
      setText(before + inserted + after);
      setSelection({ start: caret, end: caret });
    },
    [activeQuery, selection.start, text],
  );

  const handleSubmit = useCallback(() => {
    if (submitting || !text.trim()) return;
    onSubmit(text);
  }, [submitting, text, onSubmit]);

  const barStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: -keyboardHeight.value }],
    // Leave a comfortable gap above the keyboard so the bar doesn't feel cramped;
    // clear the home indicator when the keyboard is down.
    paddingBottom: keyboardHeight.value > 0 ? spacing.lg : bottomInset + spacing.sm,
  }));

  return (
    <Modal visible={visible} transparent animationType="fade" statusBarTranslucent onRequestClose={onClose}>
      <View style={styles.root}>
        <Pressable style={styles.backdrop} onPress={onClose} />
        <Animated.View style={[styles.bar, barStyle]}>
          {activeQuery ? <MentionUserPicker users={pickerUsers} onSelect={handleSelectMention} /> : null}
          <MentionInput
            ref={inputRef}
            directory={directory}
            value={text}
            onChangeText={setText}
            selection={selection}
            onSelectionChange={handleSelectionChange}
            multiline
            placeholder={placeholder}
            placeholderTextColor={colors.textMuted}
            style={styles.input}
            textAlignVertical="top"
          />
          <View style={styles.actions}>
            <AnimatedPressable
              onPress={handleMentionTrigger}
              hitSlop={8}
              press={{ pressedScale: 0.9 }}
              style={styles.atButton}
            >
              <Feather name="at-sign" size={19} color={colors.textSecondary} />
            </AnimatedPressable>
            <View style={styles.spacer} />
            <AppButton
              title="发送"
              size="sm"
              loading={submitting}
              disabled={!text.trim()}
              onPress={handleSubmit}
              style={styles.sendButton}
            />
          </View>
        </Animated.View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    justifyContent: "flex-end",
  },
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(10,10,10,0.4)",
  },
  bar: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: radius.lg,
    borderTopRightRadius: radius.lg,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    gap: spacing.sm,
    ...shadow.lg,
  },
  input: {
    minHeight: 40,
    maxHeight: 140,
    color: colors.text,
    fontSize: 15,
    lineHeight: 22,
    padding: 0,
  },
  actions: {
    flexDirection: "row",
    alignItems: "center",
  },
  atButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.surfaceMuted,
  },
  spacer: {
    flex: 1,
  },
  sendButton: {
    minWidth: 72,
  },
});
