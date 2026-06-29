import { useCallback, useEffect, useState } from "react";
import { ScrollView, StyleSheet, View } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";

import { AppButton, AppText, colors, radius, spacing } from "../../../design";
import { generateReaderGuide } from "../../../services/learningContentService";
import { normalizeError } from "../../../utils/errors";
import { MarkdownMessage } from "../../chat/components/MarkdownMessage";
import type { ReaderContext } from "../types";

function cacheKey(context: ReaderContext) {
  const chapter = context.chapter?.name || "_";
  return `nexora.reading.guide.${context.lectureId}.${context.bookId}.${chapter}`;
}

export function GuideTab({ context }: { context: ReaderContext }) {
  const [guide, setGuide] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const cached = await AsyncStorage.getItem(cacheKey(context));
        if (active && cached) {
          setGuide(cached);
        }
      } catch {
        // ignore
      }
    })();
    return () => {
      active = false;
    };
  }, [context]);

  const generate = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const result = await generateReaderGuide({
        lecture_id: context.lectureId,
        book_id: context.bookId,
        chapter_name: context.chapter?.name,
        guide_context:
          context.chapter?.summary ||
          context.chapter?.name ||
          context.bookTitle ||
          "本章内容",
      });
      const content = String(result.content || result.guide || "").trim();
      if (!content) {
        throw new Error("未能生成导读内容。");
      }
      setGuide(content);
      void AsyncStorage.setItem(cacheKey(context), content).catch(() => undefined);
    } catch (err) {
      setError(normalizeError(err).message);
    } finally {
      setLoading(false);
    }
  }, [context]);

  if (guide) {
    return (
      <ScrollView style={styles.flex} contentContainerStyle={styles.content}>
        <AppText variant="overline" tone="tertiary">
          阅读导读
        </AppText>
        <MarkdownMessage content={guide} />
        <AppButton
          title="重新生成导读"
          variant="outline"
          size="sm"
          loading={loading}
          onPress={() => void generate()}
          style={styles.regen}
        />
      </ScrollView>
    );
  }

  if (dismissed) {
    return (
      <View style={styles.center}>
        <AppButton title="生成导读" loading={loading} onPress={() => void generate()} />
      </View>
    );
  }

  return (
    <ScrollView style={styles.flex} contentContainerStyle={styles.content}>
      <View style={styles.card}>
        <AppText variant="overline" tone="tertiary">
          阅读导读
        </AppText>
        <AppText variant="title" style={styles.cardTitle}>
          {context.chapter?.name || context.bookTitle || "本章导读"}
        </AppText>
        <AppText tone="secondary" style={styles.cardBody}>
          是否根据当前内容生成一组阅读引导？导读会保存在本地缓存，不写入左侧对话历史。
        </AppText>
        {error ? (
          <AppText variant="caption" tone="danger">
            {error}
          </AppText>
        ) : null}
        <View style={styles.actions}>
          <AppButton title="生成导读" loading={loading} onPress={() => void generate()} />
          <AppButton
            title="稍后"
            variant="ghost"
            onPress={() => setDismissed(true)}
            disabled={loading}
          />
        </View>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  flex: {
    flex: 1,
  },
  content: {
    padding: spacing.lg,
    gap: spacing.md,
  },
  center: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: spacing.lg,
  },
  card: {
    gap: spacing.sm,
    paddingVertical: spacing.md,
  },
  cardTitle: {
    marginTop: spacing.xs,
  },
  cardBody: {
    lineHeight: 22,
  },
  actions: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    marginTop: spacing.sm,
  },
  regen: {
    alignSelf: "flex-start",
    marginTop: spacing.sm,
  },
});
