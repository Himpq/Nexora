import { useEffect, useState } from "react";
import {
  Alert,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
  useWindowDimensions,
} from "react-native";
import { Feather } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";

import { AppButton, AppText, colors, haptics, radius, spacing } from "../../../design";
import type { ConversationSummary } from "../../../services/conversationService";
import { formatRelativeTime } from "../../../utils/format";

function formatStamp(value?: string) {
  const parsed = Date.parse(String(value || ""));
  return Number.isFinite(parsed) ? formatRelativeTime(parsed) : "";
}

export function ConversationDrawer({
  visible,
  onClose,
  conversations,
  activeId,
  loading,
  onSelect,
  onNew,
  onDelete,
  onRename,
  onPin,
}: {
  visible: boolean;
  onClose: () => void;
  conversations: ConversationSummary[];
  activeId: string;
  loading: boolean;
  onSelect: (id: string) => void;
  onNew: () => void;
  onDelete: (id: string) => void;
  onRename: (id: string, title: string) => void;
  onPin: (id: string, pin: boolean) => void;
}) {
  const { width } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const panelW = Math.min(340, width * 0.84);

  const tx = useSharedValue(-panelW);
  const fade = useSharedValue(0);
  const [query, setQuery] = useState("");
  const [menuId, setMenuId] = useState<string | null>(null);
  const [renameId, setRenameId] = useState<string | null>(null);
  const [renameText, setRenameText] = useState("");

  useEffect(() => {
    tx.value = withTiming(visible ? 0 : -panelW, { duration: 220 });
    fade.value = withTiming(visible ? 1 : 0, { duration: 220 });
  }, [visible, panelW, tx, fade]);

  const panelStyle = useAnimatedStyle(() => ({ transform: [{ translateX: tx.value }] }));
  const backdropStyle = useAnimatedStyle(() => ({ opacity: fade.value }));

  const normalizedQuery = query.trim().toLowerCase();
  const filtered = normalizedQuery
    ? conversations.filter((conv) =>
        String(conv.title || "").toLowerCase().includes(normalizedQuery),
      )
    : conversations;
  const menuConv = conversations.find((conv) => conv.conversation_id === menuId) || null;

  const confirmDelete = (id: string) => {
    setMenuId(null);
    Alert.alert("删除对话", "删除后无法恢复，确定删除这个对话吗？", [
      { text: "取消", style: "cancel" },
      { text: "删除", style: "destructive", onPress: () => onDelete(id) },
    ]);
  };

  const openRename = (conv: ConversationSummary) => {
    setMenuId(null);
    setRenameText(String(conv.title || ""));
    setRenameId(conv.conversation_id);
  };

  const submitRename = () => {
    const id = renameId;
    const title = renameText.trim();
    setRenameId(null);
    if (id && title) {
      onRename(id, title);
    }
  };

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents={visible ? "auto" : "none"}>
      <Animated.View style={[StyleSheet.absoluteFill, styles.backdrop, backdropStyle]}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} />
      </Animated.View>

      <Animated.View
        style={[
          styles.panel,
          {
            width: panelW,
            paddingTop: insets.top + spacing.md,
            paddingBottom: insets.bottom + spacing.sm,
          },
          panelStyle,
        ]}
      >
        <View style={styles.header}>
          <AppText variant="title">对话</AppText>
          <Pressable
            style={styles.newBtn}
            onPress={() => {
              haptics.selection();
              onNew();
            }}
            hitSlop={6}
          >
            <Feather name="edit" size={15} color={colors.onPrimary} />
            <AppText variant="label" style={styles.newBtnText}>
              新对话
            </AppText>
          </Pressable>
        </View>

        <View style={styles.searchBox}>
          <Feather name="search" size={15} color={colors.textMuted} />
          <TextInput
            value={query}
            onChangeText={setQuery}
            placeholder="搜索对话"
            placeholderTextColor={colors.textMuted}
            style={styles.searchInput}
          />
        </View>

        <ScrollView style={styles.list} showsVerticalScrollIndicator={false}>
          {loading ? (
            <AppText tone="muted" style={styles.hint}>
              加载中…
            </AppText>
          ) : null}
          {!loading && filtered.length === 0 ? (
            <AppText tone="muted" style={styles.hint}>
              {normalizedQuery ? "没有匹配的对话" : "还没有对话，点「新对话」开始。"}
            </AppText>
          ) : null}
          {filtered.map((conv) => {
            const active = conv.conversation_id === activeId;
            return (
              <Pressable
                key={conv.conversation_id}
                style={[styles.item, active && styles.itemActive]}
                onPress={() => onSelect(conv.conversation_id)}
              >
                {conv.pin ? (
                  <Feather name="bookmark" size={13} color={colors.textTertiary} />
                ) : null}
                <View style={styles.itemText}>
                  <AppText variant="label" numberOfLines={1}>
                    {conv.title || "未命名对话"}
                  </AppText>
                  <AppText variant="caption" tone="muted">
                    {formatStamp(conv.updated_at || conv.created_at)}
                  </AppText>
                </View>
                <Pressable hitSlop={10} onPress={() => setMenuId(conv.conversation_id)}>
                  <Feather name="more-horizontal" size={16} color={colors.textTertiary} />
                </Pressable>
              </Pressable>
            );
          })}
        </ScrollView>
      </Animated.View>

      {/* Per-conversation actions */}
      <Modal
        visible={Boolean(menuId)}
        transparent
        animationType="fade"
        onRequestClose={() => setMenuId(null)}
      >
        <Pressable style={styles.sheetBackdrop} onPress={() => setMenuId(null)} />
        <View style={[styles.sheet, { paddingBottom: insets.bottom + spacing.md }]}>
          <View style={styles.handle} />
          <AppText variant="label" tone="muted" numberOfLines={1} style={styles.sheetTitle}>
            {menuConv?.title || "对话"}
          </AppText>
          <Pressable
            style={styles.sheetRow}
            onPress={() => {
              if (menuConv) {
                onPin(menuConv.conversation_id, !menuConv.pin);
              }
              setMenuId(null);
            }}
          >
            <Feather name="bookmark" size={17} color={colors.text} />
            <AppText variant="body">{menuConv?.pin ? "取消置顶" : "置顶"}</AppText>
          </Pressable>
          <Pressable style={styles.sheetRow} onPress={() => menuConv && openRename(menuConv)}>
            <Feather name="edit-2" size={17} color={colors.text} />
            <AppText variant="body">重命名</AppText>
          </Pressable>
          <Pressable
            style={styles.sheetRow}
            onPress={() => menuConv && confirmDelete(menuConv.conversation_id)}
          >
            <Feather name="trash-2" size={17} color={colors.danger} />
            <AppText variant="body" tone="danger">
              删除
            </AppText>
          </Pressable>
        </View>
      </Modal>

      {/* Rename */}
      <Modal
        visible={Boolean(renameId)}
        transparent
        animationType="fade"
        onRequestClose={() => setRenameId(null)}
      >
        <Pressable style={styles.sheetBackdrop} onPress={() => setRenameId(null)} />
        <View style={styles.renameCard}>
          <AppText variant="heading" style={styles.renameTitle}>
            重命名对话
          </AppText>
          <TextInput
            value={renameText}
            onChangeText={setRenameText}
            placeholder="输入新标题"
            placeholderTextColor={colors.textMuted}
            style={styles.renameInput}
            autoFocus
            onSubmitEditing={submitRename}
            returnKeyType="done"
          />
          <View style={styles.renameActions}>
            <AppButton
              title="取消"
              variant="ghost"
              size="sm"
              onPress={() => setRenameId(null)}
            />
            <AppButton
              title="保存"
              size="sm"
              disabled={!renameText.trim()}
              onPress={submitRename}
            />
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    backgroundColor: "rgba(10,10,10,0.35)",
  },
  panel: {
    position: "absolute",
    left: 0,
    top: 0,
    bottom: 0,
    backgroundColor: colors.surface,
    borderRightWidth: 1,
    borderRightColor: colors.border,
    paddingHorizontal: spacing.md,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: spacing.md,
  },
  newBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
    backgroundColor: colors.primary,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  newBtnText: {
    color: colors.onPrimary,
  },
  searchBox: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    backgroundColor: colors.surfaceMuted,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    marginBottom: spacing.sm,
  },
  searchInput: {
    flex: 1,
    color: colors.text,
    fontSize: 14,
    paddingVertical: spacing.sm,
  },
  list: {
    flex: 1,
  },
  hint: {
    paddingVertical: spacing.lg,
    textAlign: "center",
  },
  item: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.md,
    borderRadius: radius.md,
  },
  itemActive: {
    backgroundColor: colors.surfaceMuted,
  },
  itemText: {
    flex: 1,
    gap: 2,
  },
  sheetBackdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(10,10,10,0.35)",
  },
  sheet: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: colors.surface,
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
  },
  handle: {
    alignSelf: "center",
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.borderStrong,
    marginBottom: spacing.sm,
  },
  sheetTitle: {
    marginBottom: spacing.sm,
  },
  sheetRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    paddingVertical: spacing.md,
  },
  renameCard: {
    position: "absolute",
    left: spacing.xl,
    right: spacing.xl,
    top: "32%",
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: spacing.lg,
    gap: spacing.md,
  },
  renameTitle: {
    textAlign: "center",
  },
  renameInput: {
    backgroundColor: colors.surfaceMuted,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    color: colors.text,
    fontSize: 15,
  },
  renameActions: {
    flexDirection: "row",
    justifyContent: "flex-end",
    gap: spacing.sm,
  },
});
