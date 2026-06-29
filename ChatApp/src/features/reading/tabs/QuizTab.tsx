import { useCallback, useState } from "react";
import { Pressable, ScrollView, StyleSheet, View } from "react-native";
import { Feather } from "@expo/vector-icons";

import { AppButton, AppText, colors, radius, spacing } from "../../../design";
import { getChapterQuiz } from "../../../services/learningExperienceService";
import { submitQuizAnswerBatch } from "../../../services/learningContentService";
import { normalizeError } from "../../../utils/errors";
import type { ReaderContext } from "../types";

type QuizOption = { key: string; text: string };
type QuizQuestion = {
  id: string;
  text: string;
  options: QuizOption[];
  correctIndex: number | null;
};

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

function buildOptions(raw: unknown): QuizOption[] {
  const list = Array.isArray(raw) ? raw : [];
  return list.map((item, index) => {
    const key = String.fromCharCode(65 + index);
    if (typeof item === "string") {
      return { key, text: item };
    }
    const obj = asRecord(item);
    return {
      key: String(obj.key || obj.label || key),
      text: String(obj.text || obj.content || obj.value || obj.option || ""),
    };
  });
}

function normalizeCorrect(correct: unknown, options: QuizOption[]): number | null {
  if (correct == null) {
    return null;
  }
  if (typeof correct === "number" && Number.isInteger(correct)) {
    return correct;
  }
  const text = String(correct).trim();
  if (/^[A-Za-z]$/.test(text)) {
    return text.toUpperCase().charCodeAt(0) - 65;
  }
  const asNumber = Number(text);
  if (Number.isInteger(asNumber)) {
    return asNumber;
  }
  const idx = options.findIndex((o) => o.text === text || o.key === text);
  return idx >= 0 ? idx : null;
}

function parseQuestions(
  questions: Array<Record<string, unknown>>,
  answers: Record<string, unknown>,
): QuizQuestion[] {
  return questions.map((rawQuestion, index) => {
    const q = asRecord(rawQuestion);
    const id = String(q.id || q.question_id || index);
    const options = buildOptions(q.options || q.choices);
    const correctRaw =
      answers?.[id] ?? q.answer ?? q.correct ?? q.correct_option ?? q.correct_answer;
    return {
      id,
      text: String(q.question || q.stem || q.text || q.title || q.content || `第 ${index + 1} 题`),
      options,
      correctIndex: normalizeCorrect(correctRaw, options),
    };
  });
}

export function QuizTab({ context }: { context: ReaderContext }) {
  const [questions, setQuestions] = useState<QuizQuestion[] | null>(null);
  const [quizId, setQuizId] = useState("");
  const [selections, setSelections] = useState<Record<string, number>>({});
  const [submitted, setSubmitted] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    setSubmitted(false);
    setSelections({});
    try {
      const result = await getChapterQuiz({
        lecture_id: context.lectureId,
        book_id: context.bookId,
        chapter_name: context.chapter?.name || "",
        chapter_index: context.chapter?.index ?? 0,
        chapter_range: context.chapter?.range,
        chapter_context: context.chapter?.summary,
        chapter_detail_xml: context.chapter?.detailXml,
      });
      const rawQuestions = Array.isArray(result.questions) ? result.questions : [];
      if (rawQuestions.length === 0) {
        throw new Error("本章暂未生成测验题目。");
      }
      setQuizId(String(result.quiz_id || ""));
      setQuestions(parseQuestions(rawQuestions, asRecord(result.answers)));
    } catch (err) {
      setError(normalizeError(err).message);
      setQuestions(null);
    } finally {
      setLoading(false);
    }
  }, [context]);

  const submit = useCallback(async () => {
    if (!questions) {
      return;
    }
    setSubmitted(true);
    try {
      await submitQuizAnswerBatch(
        questions.map((q) => {
          const selected = selections[q.id];
          return {
            quiz_id: quizId,
            question_id: q.id,
            selected_index: selected,
            is_correct: q.correctIndex != null ? selected === q.correctIndex : undefined,
            lecture_id: context.lectureId,
            book_id: context.bookId,
            chapter_name: context.chapter?.name,
          };
        }),
      );
    } catch {
      // Submission is best-effort; local scoring still shows.
    }
  }, [context, questions, quizId, selections]);

  if (!questions) {
    return (
      <View style={styles.center}>
        <Feather name="check-circle" size={32} color={colors.textTertiary} />
        <AppText tone="secondary" style={styles.centerText}>
          根据本章内容生成一组小测验，检验你的理解。
        </AppText>
        {error ? (
          <AppText variant="caption" tone="danger">
            {error}
          </AppText>
        ) : null}
        <AppButton title="开始测验" loading={loading} onPress={() => void load()} />
      </View>
    );
  }

  const scored = questions.filter((q) => q.correctIndex != null);
  const correctCount = scored.filter((q) => selections[q.id] === q.correctIndex).length;

  return (
    <ScrollView style={styles.flex} contentContainerStyle={styles.content}>
      {submitted && scored.length > 0 ? (
        <View style={styles.scoreCard}>
          <AppText variant="bodyStrong">
            得分 {correctCount} / {scored.length}
          </AppText>
        </View>
      ) : null}

      {questions.map((q, index) => {
        const selected = selections[q.id];
        return (
          <View key={q.id} style={styles.question}>
            <AppText variant="bodyStrong" style={styles.questionText}>
              {index + 1}. {q.text}
            </AppText>
            {q.options.map((option, optIndex) => {
              const isSelected = selected === optIndex;
              const isCorrect = submitted && q.correctIndex === optIndex;
              const isWrong = submitted && isSelected && q.correctIndex !== optIndex;
              return (
                <Pressable
                  key={option.key}
                  disabled={submitted}
                  onPress={() => setSelections((prev) => ({ ...prev, [q.id]: optIndex }))}
                  style={[
                    styles.option,
                    isSelected && styles.optionSelected,
                    isCorrect && styles.optionCorrect,
                    isWrong && styles.optionWrong,
                  ]}
                >
                  <AppText variant="label" style={styles.optionKey}>
                    {option.key}
                  </AppText>
                  <AppText style={styles.optionText}>{option.text}</AppText>
                  {isCorrect ? <Feather name="check" size={15} color={colors.success} /> : null}
                  {isWrong ? <Feather name="x" size={15} color={colors.danger} /> : null}
                </Pressable>
              );
            })}
          </View>
        );
      })}

      {!submitted ? (
        <AppButton title="提交" onPress={() => void submit()} style={styles.submitBtn} />
      ) : (
        <AppButton
          title="重新测验"
          variant="outline"
          onPress={() => void load()}
          style={styles.submitBtn}
        />
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  flex: {
    flex: 1,
  },
  content: {
    padding: spacing.md,
    gap: spacing.lg,
  },
  center: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.md,
    padding: spacing.lg,
  },
  centerText: {
    textAlign: "center",
  },
  scoreCard: {
    backgroundColor: colors.surfaceMuted,
    borderRadius: radius.md,
    padding: spacing.md,
    alignItems: "center",
  },
  question: {
    gap: spacing.sm,
  },
  questionText: {
    lineHeight: 22,
  },
  option: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  optionSelected: {
    borderColor: colors.primary,
    backgroundColor: colors.surfaceMuted,
  },
  optionCorrect: {
    borderColor: colors.success,
    backgroundColor: colors.successMuted,
  },
  optionWrong: {
    borderColor: colors.danger,
    backgroundColor: colors.dangerMuted,
  },
  optionKey: {
    width: 18,
  },
  optionText: {
    flex: 1,
  },
  submitBtn: {
    marginTop: spacing.sm,
  },
});
