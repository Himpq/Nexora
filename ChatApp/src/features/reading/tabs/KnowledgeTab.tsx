import { useCallback, useEffect, useState } from "react";
import { ScrollView, StyleSheet, View } from "react-native";
import { Feather } from "@expo/vector-icons";

import { AppButton, AppText, colors, radius, spacing } from "../../../design";
import {
  generateKnowledgeGraph,
  getKnowledgeGraph,
  type KnowledgeGraphNode,
} from "../../../services/learningExperienceService";
import { normalizeError } from "../../../utils/errors";
import type { ReaderContext } from "../types";

function nodeTitle(node: KnowledgeGraphNode) {
  return String(node.title || node.name || node.label || "").trim();
}

function nodeSummary(node: KnowledgeGraphNode) {
  return String(node.summary || node.content || "").trim();
}

function nodeChildren(node: KnowledgeGraphNode): KnowledgeGraphNode[] {
  const children = node.children || node.concepts || node.key_points;
  return Array.isArray(children) ? children : [];
}

function collectTopNodes(graph: {
  chapters?: KnowledgeGraphNode[];
  nodes?: KnowledgeGraphNode[];
} | null | undefined): KnowledgeGraphNode[] {
  if (!graph) {
    return [];
  }
  if (Array.isArray(graph.chapters) && graph.chapters.length > 0) {
    return graph.chapters;
  }
  return Array.isArray(graph.nodes) ? graph.nodes : [];
}

function NodeView({ node, depth }: { node: KnowledgeGraphNode; depth: number }) {
  const title = nodeTitle(node);
  const summary = nodeSummary(node);
  const children = nodeChildren(node);
  return (
    <View style={[styles.node, depth > 0 && styles.nodeChild]}>
      {title ? (
        <View style={styles.nodeTitleRow}>
          <View style={[styles.dot, depth === 0 && styles.dotTop]} />
          <AppText variant={depth === 0 ? "bodyStrong" : "label"} style={styles.nodeTitle}>
            {title}
          </AppText>
        </View>
      ) : null}
      {summary ? (
        <AppText variant="caption" tone="secondary" style={styles.nodeSummary}>
          {summary}
        </AppText>
      ) : null}
      {depth < 2
        ? children.map((child, index) => (
            <NodeView key={`${depth}-${index}`} node={child} depth={depth + 1} />
          ))
        : null}
    </View>
  );
}

export function KnowledgeTab({ context }: { context: ReaderContext }) {
  const [nodes, setNodes] = useState<KnowledgeGraphNode[]>([]);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState("");

  const fetchGraph = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const result = await getKnowledgeGraph(context.lectureId, context.bookId);
      setNodes(collectTopNodes(result.graph));
    } catch (err) {
      setError(normalizeError(err).message);
    } finally {
      setLoading(false);
    }
  }, [context.lectureId, context.bookId]);

  const generate = useCallback(async () => {
    setGenerating(true);
    setError("");
    try {
      const result = await generateKnowledgeGraph(context.lectureId, context.bookId);
      setNodes(collectTopNodes(result.graph));
    } catch (err) {
      setError(normalizeError(err).message);
    } finally {
      setGenerating(false);
    }
  }, [context.lectureId, context.bookId]);

  useEffect(() => {
    void fetchGraph();
  }, [fetchGraph]);

  if (loading) {
    return (
      <View style={styles.center}>
        <AppText tone="muted">正在加载知识点…</AppText>
      </View>
    );
  }

  if (nodes.length === 0) {
    return (
      <View style={styles.center}>
        <Feather name="share-2" size={32} color={colors.textTertiary} />
        <AppText tone="secondary" style={styles.centerText}>
          还没有本书的知识点图谱，立即生成。
        </AppText>
        {error ? (
          <AppText variant="caption" tone="danger">
            {error}
          </AppText>
        ) : null}
        <AppButton title="生成知识点" loading={generating} onPress={() => void generate()} />
      </View>
    );
  }

  return (
    <ScrollView style={styles.flex} contentContainerStyle={styles.content}>
      {nodes.map((node, index) => (
        <NodeView key={index} node={node} depth={0} />
      ))}
      <AppButton
        title="重新生成"
        variant="ghost"
        size="sm"
        loading={generating}
        onPress={() => void generate()}
        style={styles.regen}
      />
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
  node: {
    gap: spacing.xs,
  },
  nodeChild: {
    marginLeft: spacing.md,
    paddingLeft: spacing.md,
    borderLeftWidth: 1,
    borderLeftColor: colors.border,
  },
  nodeTitleRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
  },
  dot: {
    width: 5,
    height: 5,
    borderRadius: 3,
    backgroundColor: colors.textTertiary,
  },
  dotTop: {
    width: 7,
    height: 7,
    borderRadius: 4,
    backgroundColor: colors.primary,
  },
  nodeTitle: {
    flex: 1,
  },
  nodeSummary: {
    lineHeight: 18,
    marginLeft: spacing.md,
  },
  regen: {
    alignSelf: "flex-start",
    marginTop: spacing.sm,
  },
});
