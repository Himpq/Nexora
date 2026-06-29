import { useCallback, useEffect, useState } from "react";
import { ScrollView, StyleSheet, View } from "react-native";
import { Feather } from "@expo/vector-icons";

import { AppButton, AppText, colors, radius, spacing } from "../../../design";
import { completeLearningChapter } from "../../../services/frontendService";
import {
  getLearningReport,
  type LearningReportResponse,
} from "../../../services/learningContentService";
import { normalizeError } from "../../../utils/errors";
import type { ReaderContext } from "../types";

const METRIC_LABELS: Record<string, string> = {
  progress: "课程进度",
  completed_chapters: "已完成章节",
  total_chapters: "章节总数",
  study_hours: "学习时长",
  submitted: "已提交题目",
  submitted_questions: "已提交题目",
  total_questions: "题目总数",
  correct: "答对题目",
  correct_count: "答对题目",
  accuracy: "正确率",
  reading_minutes: "阅读时长(分)",
  read_chapters: "已读章节",
};

type Metric = { label: string; value: string };

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

function collectMetrics(report: LearningReportResponse | null): Metric[] {
  if (!report) {
    return [];
  }
  const sources = [
    report as Record<string, unknown>,
    asRecord(report.reading_stats),
    asRecord(report.question_stats),
    asRecord(report.profile_summary),
  ];
  const metrics: Metric[] = [];
  const seen = new Set<string>();
  for (const source of sources) {
    for (const [key, raw] of Object.entries(source)) {
      const label = METRIC_LABELS[key];
      if (!label || seen.has(label)) {
        continue;
      }
      if (typeof raw === "number" || typeof raw === "string") {
        const value = key === "accuracy" ? `${Math.round(Number(raw) * (Number(raw) <= 1 ? 100 : 1))}%` : String(raw);
        if (String(raw).trim() !== "") {
          metrics.push({ label, value });
          seen.add(label);
        }
      }
    }
  }
  return metrics;
}

export function ProgressTab({ context }: { context: ReaderContext }) {
  const [report, setReport] = useState<LearningReportResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [completing, setCompleting] = useState(false);
  const [completeMessage, setCompleteMessage] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const result = await getLearningReport({
        lecture_id: context.lectureId,
        book_id: context.bookId,
        chapter_index: context.chapter?.index,
      });
      setReport(result);
    } catch (err) {
      setError(normalizeError(err).message);
    } finally {
      setLoading(false);
    }
  }, [context]);

  useEffect(() => {
    void load();
  }, [load]);

  const completeChapter = useCallback(async () => {
    const chapter = context.chapter;
    if (!chapter?.name || !chapter?.range) {
      return;
    }
    setCompleting(true);
    setCompleteMessage("");
    try {
      const result = await completeLearningChapter({
        lecture_id: context.lectureId,
        book_id: context.bookId,
        chapter_name: chapter.name,
        chapter_range: chapter.range,
        chapter_context: chapter.summary || "",
        chapter_detail_xml: chapter.detailXml || "",
      });
      setCompleteMessage(result.already_completed ? "本章此前已完成。" : "已记录本章完成。");
      void load();
    } catch (err) {
      setCompleteMessage(normalizeError(err).message);
    } finally {
      setCompleting(false);
    }
  }, [context, load]);

  const metrics = collectMetrics(report);
  const canComplete = Boolean(context.chapter?.name && context.chapter?.range);

  return (
    <ScrollView style={styles.flex} contentContainerStyle={styles.content}>
      <AppText variant="overline" tone="tertiary">
        学习进度
      </AppText>

      {loading ? (
        <AppText tone="muted">正在加载学习报告…</AppText>
      ) : error ? (
        <View style={styles.errorBox}>
          <AppText variant="caption" tone="danger">
            {error}
          </AppText>
          <AppButton title="重试" variant="outline" size="sm" onPress={() => void load()} />
        </View>
      ) : metrics.length > 0 ? (
        <View style={styles.metrics}>
          {metrics.map((metric) => (
            <View key={metric.label} style={styles.metric}>
              <AppText variant="title">{metric.value}</AppText>
              <AppText variant="caption" tone="muted">
                {metric.label}
              </AppText>
            </View>
          ))}
        </View>
      ) : (
        <AppText tone="muted">完成阅读、提交测验后，这里会汇总你的学习状态。</AppText>
      )}

      {canComplete ? (
        <View style={styles.completeCard}>
          <View style={styles.completeCopy}>
            <AppText variant="overline" tone="tertiary">
              当前章节
            </AppText>
            <AppText variant="bodyStrong" numberOfLines={2}>
              {context.chapter?.name}
            </AppText>
            {completeMessage ? (
              <AppText variant="caption" tone="success">
                {completeMessage}
              </AppText>
            ) : null}
          </View>
          <AppButton
            title="标记完成"
            size="sm"
            variant="outline"
            loading={completing}
            onPress={() => void completeChapter()}
          />
        </View>
      ) : null}

      {Array.isArray(report?.recommendations) && report!.recommendations.length > 0 ? (
        <View style={styles.recommend}>
          <AppText variant="label" tone="secondary">
            学习建议
          </AppText>
          {report!.recommendations.slice(0, 4).map((rec, index) => {
            const item = asRecord(rec);
            const text = String(item.detail || item.text || item.title || item.message || "");
            if (!text) {
              return null;
            }
            return (
              <View key={index} style={styles.recommendRow}>
                <Feather name="arrow-right" size={13} color={colors.textTertiary} />
                <AppText variant="caption" tone="secondary" style={styles.recommendText}>
                  {text}
                </AppText>
              </View>
            );
          })}
        </View>
      ) : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  flex: {
    flex: 1,
  },
  content: {
    padding: spacing.md,
    gap: spacing.md,
  },
  errorBox: {
    gap: spacing.sm,
  },
  metrics: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.sm,
  },
  metric: {
    minWidth: "30%",
    flexGrow: 1,
    backgroundColor: colors.surfaceMuted,
    borderRadius: radius.md,
    padding: spacing.md,
    gap: 2,
  },
  completeCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    backgroundColor: colors.surfaceMuted,
    borderRadius: radius.md,
    padding: spacing.md,
  },
  completeCopy: {
    flex: 1,
    gap: 2,
  },
  recommend: {
    gap: spacing.sm,
    marginTop: spacing.sm,
  },
  recommendRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: spacing.sm,
  },
  recommendText: {
    flex: 1,
    lineHeight: 18,
  },
});
