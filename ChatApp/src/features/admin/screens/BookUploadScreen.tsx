import type { DocumentPickerAsset } from "expo-document-picker";
import * as DocumentPicker from "expo-document-picker";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Pressable, StyleSheet, TextInput, View } from "react-native";

import { useSession } from "../../../app/providers/SessionProvider";
import {
  AppButton,
  AppCard,
  AppText,
  colors,
  radius,
  Screen,
  spacing,
  StateView,
} from "../../../design";
import type { RootStackParamList } from "../../../navigation/types";
import { createBook, uploadBookFile } from "../../../services/bookService";
import { getMaterials } from "../../../services/frontendService";
import type { Book, LectureRow } from "../../../services/types";
import { normalizeError } from "../../../utils/errors";

type BookUploadScreenProps = NativeStackScreenProps<RootStackParamList, "BookUpload">;

const SUPPORTED_FILE_TYPES = [
  "application/pdf",
  "text/plain",
  "text/markdown",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/epub+zip",
  "text/x-c",
  "text/x-python",
  "*/*",
];

function getLectureTitle(row: LectureRow) {
  return String(row.lecture?.title || "").trim() || "未命名课程";
}

function getLectureMeta(row: LectureRow) {
  return [
    String(row.lecture?.category || "").trim(),
    String(row.lecture?.status || "").trim(),
    `${row.books_count ?? row.books?.length ?? 0} 本教材`,
  ]
    .filter(Boolean)
    .join(" · ");
}

function formatFileSize(size?: number) {
  if (!Number.isFinite(size || NaN) || !size) {
    return "未知大小";
  }
  const sizeMb = size / (1024 * 1024);
  if (sizeMb >= 1) {
    return `${sizeMb.toFixed(2)} MB`;
  }
  return `${Math.max(1, Math.round(size / 1024))} KB`;
}

function getBookStatusLabel(book: Book | null) {
  if (!book) {
    return "";
  }
  return [
    `文本：${String(book.text_status || "pending_extract")}`,
    `提炼：${String(book.refinement_status || "uploaded")}`,
    `粗读：${String(book.coarse_status || "idle")}`,
    `精读：${String(book.intensive_status || "idle")}`,
  ].join(" · ");
}

export function BookUploadScreen({ navigation }: BookUploadScreenProps) {
  const { isAdmin } = useSession();
  const [rows, setRows] = useState<LectureRow[]>([]);
  const [selectedLectureId, setSelectedLectureId] = useState("");
  const [bookTitle, setBookTitle] = useState("");
  const [description, setDescription] = useState("");
  const [selectedFile, setSelectedFile] = useState<DocumentPickerAsset | null>(null);
  const [createdBook, setCreatedBook] = useState<Book | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const [operationError, setOperationError] = useState<Error | null>(null);
  const [successMessage, setSuccessMessage] = useState("");

  const selectedLecture = useMemo(
    () => rows.find((row) => String(row.lecture?.id || "") === selectedLectureId),
    [rows, selectedLectureId],
  );

  const loadMaterials = useCallback(async () => {
    setLoading(true);
    setError(null);
    setOperationError(null);
    try {
      const result = await getMaterials();
      const nextRows = Array.isArray(result.lectures) ? result.lectures : [];
      setRows(nextRows);
      setSelectedLectureId((current) => {
        if (current && nextRows.some((row) => String(row.lecture?.id || "") === current)) {
          return current;
        }
        return String(nextRows[0]?.lecture?.id || "");
      });
    } catch (err) {
      setRows([]);
      setSelectedLectureId("");
      setError(normalizeError(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadMaterials();
  }, [loadMaterials]);

  const pickFile = useCallback(async () => {
    setOperationError(null);
    setSuccessMessage("");
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: SUPPORTED_FILE_TYPES,
        multiple: false,
        copyToCacheDirectory: true,
        base64: false,
      });
      if (result.canceled) {
        return;
      }
      const asset = result.assets[0];
      if (!asset) {
        return;
      }
      setSelectedFile(asset);
      setBookTitle((current) => current || asset.name.replace(/\.[^.]+$/, ""));
      setCreatedBook(null);
    } catch (err) {
      setOperationError(normalizeError(err));
    }
  }, []);

  const submit = useCallback(async () => {
    const lectureId = selectedLectureId.trim();
    const title = bookTitle.trim();
    if (!lectureId || !title || !selectedFile || submitting) {
      return;
    }
    setSubmitting(true);
    setOperationError(null);
    setSuccessMessage("");
    setCreatedBook(null);
    try {
      const created = await createBook(lectureId, {
        title,
        description: description.trim(),
        source_type: "file",
      });
      const uploaded = await uploadBookFile(lectureId, created.book.id, {
        uri: selectedFile.uri,
        name: selectedFile.name,
        type: selectedFile.mimeType,
        file: selectedFile.file,
      });
      setCreatedBook(uploaded.book || created.book);
      setSuccessMessage("教材已上传，当前等待手动提炼；不会自动标记为粗读或精读完成。");
      setBookTitle("");
      setDescription("");
      setSelectedFile(null);
      await loadMaterials();
    } catch (err) {
      setOperationError(normalizeError(err));
    } finally {
      setSubmitting(false);
    }
  }, [bookTitle, description, loadMaterials, selectedFile, selectedLectureId, submitting]);

  if (!isAdmin) {
    return (
      <Screen>
        <StateView title="无管理权限" message="当前账号不是管理员，不能上传教材。" />
      </Screen>
    );
  }

  if (loading) {
    return (
      <Screen>
        <StateView title="正在加载课程" message="正在读取可上传教材的课程列表..." loading />
      </Screen>
    );
  }

  if (error) {
    return (
      <Screen>
        <StateView
          title="课程加载失败"
          message={error.message}
          actionLabel="重试"
          onAction={() => void loadMaterials()}
        />
      </Screen>
    );
  }

  if (rows.length === 0) {
    return (
      <Screen>
        <StateView
          title="暂无课程"
          message="需要先在后端创建课程，才能在课程下上传教材。"
          actionLabel="刷新"
          onAction={() => void loadMaterials()}
        />
      </Screen>
    );
  }

  const canSubmit = Boolean(selectedLectureId && bookTitle.trim() && selectedFile && !submitting);

  return (
    <Screen scroll>
      <View style={styles.header}>
        <View style={styles.titleBlock}>
          <AppText variant="title">上传教材</AppText>
          <AppText tone="secondary">
            创建教材元数据并上传原文件，随后在提炼队列中手动触发粗读、精读或分节。
          </AppText>
        </View>
        <AppButton title="刷新课程" variant="ghost" onPress={() => void loadMaterials()} />
      </View>

      {operationError ? (
        <AppCard style={styles.bannerCard}>
          <AppText tone="danger" style={styles.bannerText}>
            {operationError.message}
          </AppText>
          <AppButton title="关闭" variant="ghost" onPress={() => setOperationError(null)} />
        </AppCard>
      ) : null}

      {successMessage ? (
        <AppCard style={[styles.bannerCard, styles.successCard]}>
          <View style={styles.titleBlock}>
            <AppText>{successMessage}</AppText>
            {createdBook ? (
              <AppText variant="caption" tone="secondary">
                {String(createdBook.title || "未命名教材")} · {getBookStatusLabel(createdBook)}
              </AppText>
            ) : null}
          </View>
          <AppButton
            title="查看提炼"
            variant="secondary"
            onPress={() => navigation.navigate("RefinementQueue")}
          />
        </AppCard>
      ) : null}

      <View style={styles.sectionHeader}>
        <AppText variant="heading">选择课程</AppText>
        <AppText variant="caption" tone="secondary">
          教材会创建在选中的课程下。
        </AppText>
      </View>

      <View style={styles.lectureList}>
        {rows.map((row) => {
          const lectureId = String(row.lecture?.id || "").trim();
          const selected = lectureId === selectedLectureId;
          return (
            <Pressable
              key={lectureId || getLectureTitle(row)}
              disabled={submitting}
              onPress={() => setSelectedLectureId(lectureId)}
              style={({ pressed }) => [
                styles.lectureOption,
                selected && styles.lectureOptionSelected,
                pressed && styles.pressed,
              ]}
            >
              <View style={styles.titleBlock}>
                <AppText variant="heading">{getLectureTitle(row)}</AppText>
                <AppText variant="caption" tone="secondary">
                  {getLectureMeta(row)}
                </AppText>
              </View>
              <View style={[styles.badge, selected ? styles.selectedBadge : styles.mutedBadge]}>
                <AppText
                  variant="caption"
                  style={selected ? styles.selectedBadgeText : styles.mutedBadgeText}
                >
                  {selected ? "已选择" : "选择"}
                </AppText>
              </View>
            </Pressable>
          );
        })}
      </View>

      <AppCard style={styles.formCard}>
        <View style={styles.sectionHeader}>
          <AppText variant="heading">教材信息</AppText>
          {selectedLecture ? (
            <AppText variant="caption" tone="secondary">
              上传到 {getLectureTitle(selectedLecture)}
            </AppText>
          ) : null}
        </View>

        <View style={styles.field}>
          <AppText variant="caption" tone="secondary">
            教材标题
          </AppText>
          <TextInput
            value={bookTitle}
            onChangeText={setBookTitle}
            editable={!submitting}
            placeholder="输入教材名称"
            placeholderTextColor={colors.textMuted}
            style={styles.input}
          />
        </View>

        <View style={styles.field}>
          <AppText variant="caption" tone="secondary">
            描述
          </AppText>
          <TextInput
            value={description}
            onChangeText={setDescription}
            editable={!submitting}
            multiline
            placeholder="可选：补充教材用途或版本信息"
            placeholderTextColor={colors.textMuted}
            style={[styles.input, styles.textArea]}
            textAlignVertical="top"
          />
        </View>

        <View style={styles.fileRow}>
          <View style={styles.titleBlock}>
            <AppText variant="caption" tone="secondary">
              教材文件
            </AppText>
            {selectedFile ? (
              <>
                <AppText>{selectedFile.name}</AppText>
                <AppText variant="caption" tone="secondary">
                  {formatFileSize(selectedFile.size)} · {selectedFile.mimeType || "未知类型"}
                </AppText>
              </>
            ) : (
              <AppText tone="secondary">支持 EPUB、PDF、TXT、MD、DOCX、DOC、C、H、PY、RST。</AppText>
            )}
          </View>
          <AppButton
            title={selectedFile ? "更换文件" : "选择文件"}
            variant="secondary"
            disabled={submitting}
            onPress={() => void pickFile()}
            style={styles.fileButton}
          />
        </View>

        <AppButton
          title="创建并上传"
          loading={submitting}
          disabled={!canSubmit}
          onPress={() => void submit()}
        />
      </AppCard>

      <AppCard style={styles.noteCard}>
        <AppText variant="caption" tone="secondary">
          上传只会把教材标记为已上传和待提炼。粗读会生成 bookinfo，精读会生成 bookdetail，分节会生成章节结构，都需要在提炼队列中手动触发。
        </AppText>
      </AppCard>
    </Screen>
  );
}

const styles = StyleSheet.create({
  header: {
    alignItems: "flex-start",
    flexDirection: "row",
    gap: spacing.md,
  },
  titleBlock: {
    flex: 1,
    gap: spacing.xs,
  },
  sectionHeader: {
    gap: spacing.xs,
  },
  bannerCard: {
    alignItems: "center",
    flexDirection: "row",
    gap: spacing.md,
  },
  bannerText: {
    flex: 1,
  },
  successCard: {
    borderColor: colors.success,
  },
  lectureList: {
    gap: spacing.sm,
  },
  lectureOption: {
    alignItems: "flex-start",
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    flexDirection: "row",
    gap: spacing.md,
    padding: spacing.md,
  },
  lectureOptionSelected: {
    borderColor: colors.primary,
  },
  pressed: {
    opacity: 0.82,
  },
  badge: {
    borderRadius: 999,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
  },
  selectedBadge: {
    backgroundColor: colors.primaryMuted,
  },
  mutedBadge: {
    backgroundColor: colors.surfaceMuted,
  },
  selectedBadgeText: {
    color: colors.primary,
    fontWeight: "700",
  },
  mutedBadgeText: {
    color: colors.textMuted,
    fontWeight: "700",
  },
  formCard: {
    gap: spacing.md,
  },
  field: {
    gap: spacing.xs,
  },
  input: {
    backgroundColor: colors.surfaceMuted,
    borderColor: colors.border,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    color: colors.text,
    minHeight: 44,
    paddingHorizontal: spacing.md,
  },
  textArea: {
    minHeight: 96,
    paddingTop: spacing.md,
  },
  fileRow: {
    alignItems: "center",
    flexDirection: "row",
    gap: spacing.md,
  },
  fileButton: {
    minWidth: 112,
  },
  noteCard: {
    backgroundColor: colors.surfaceMuted,
  },
});
