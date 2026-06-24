import { Modal, Pressable, ScrollView, StyleSheet, View } from "react-native";
import { Feather } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { AppText, colors, haptics, radius, spacing } from "../../../design";
import type { ChatModel } from "../../../services/chatConfigService";

export function ModelPicker({
  visible,
  onClose,
  models,
  selectedModel,
  onSelect,
}: {
  visible: boolean;
  onClose: () => void;
  models: ChatModel[];
  selectedModel: string;
  onSelect: (modelId: string) => void;
}) {
  const insets = useSafeAreaInsets();

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose} />
      <View style={[styles.sheet, { paddingBottom: insets.bottom + spacing.md }]}>
        <View style={styles.handle} />
        <AppText variant="heading" style={styles.title}>
          选择模型
        </AppText>
        <ScrollView style={styles.list} showsVerticalScrollIndicator={false}>
          {models.map((model) => {
            const active = model.id === selectedModel;
            const name = model.name || model.id;
            return (
              <Pressable
                key={model.id}
                style={styles.item}
                onPress={() => {
                  haptics.selection();
                  onSelect(model.id);
                  onClose();
                }}
              >
                <View style={styles.itemText}>
                  <AppText variant="bodyStrong" numberOfLines={1}>
                    {name}
                  </AppText>
                  {name !== model.id ? (
                    <AppText variant="caption" tone="muted" numberOfLines={1}>
                      {model.id}
                    </AppText>
                  ) : null}
                </View>
                {active ? <Feather name="check" size={18} color={colors.text} /> : null}
              </Pressable>
            );
          })}
          {models.length === 0 ? (
            <AppText tone="muted" style={styles.empty}>
              暂无可用模型，将使用后端默认。
            </AppText>
          ) : null}
        </ScrollView>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(10,10,10,0.35)",
  },
  sheet: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    maxHeight: "70%",
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
    marginBottom: spacing.md,
  },
  title: {
    marginBottom: spacing.sm,
  },
  list: {
    flexGrow: 0,
  },
  item: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing.md,
    paddingVertical: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.borderFaint,
  },
  itemText: {
    flex: 1,
    gap: 2,
  },
  empty: {
    paddingVertical: spacing.lg,
    textAlign: "center",
  },
});
