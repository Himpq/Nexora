import { getJson, postJson } from "./apiClient";

/** ─────────────────────────────────────────────
 *  Runtime API (/api/runtime/*)
 *
 *  These endpoints are authenticated with the NexoraLearning runtime API key
 *  (injected as `X-API-Key` by `learningApiClient`). They expose the long
 *  context / memory subsystem that the learning chat runtime drives; the admin
 *  screen uses them as a diagnostics + manual-control surface.
 *  ───────────────────────────────────────────── */

export type RuntimeConfigResponse = {
  success: boolean;
  runtime_api?: {
    enabled?: boolean;
    base_path?: string;
    frontend_url?: string;
    request_timeout?: number;
    [key: string]: unknown;
  };
  [key: string]: unknown;
};

export type RuntimeToolSpec = {
  name?: string;
  description?: string;
  [key: string]: unknown;
};

export type RuntimeToolsResponse = {
  success: boolean;
  tools?: RuntimeToolSpec[];
  [key: string]: unknown;
};

export type RuntimeToolExecuteResponse = {
  success: boolean;
  result?: unknown;
  [key: string]: unknown;
};

export type RuntimeMemoryBlock = {
  [key: string]: unknown;
};

export type RuntimeMemoryBlocksResponse = {
  success: boolean;
  blocks?: RuntimeMemoryBlock[];
  [key: string]: unknown;
};

export type RuntimeMemoryQueueJob = {
  job_id?: string;
  user_id?: string;
  lecture_id?: string;
  reason?: string;
  status?: string;
  [key: string]: unknown;
};

export type RuntimeMemoryQueueResponse = {
  success: boolean;
  queue?: RuntimeMemoryQueueJob[] | Record<string, unknown>;
  [key: string]: unknown;
};

export type RuntimeMemoryTriggerResponse = {
  success: boolean;
  result?: Record<string, unknown>;
  [key: string]: unknown;
};

export type RuntimeMemoryTurnResponse = {
  success: boolean;
  state?: Record<string, unknown>;
  enqueue?: Record<string, unknown>;
  [key: string]: unknown;
};

/** 获取 Runtime API 配置。 */
export function getRuntimeConfig() {
  return getJson<RuntimeConfigResponse>("/api/runtime/config");
}

/** 获取已注册的外部工具规格列表。 */
export function getRuntimeTools() {
  return getJson<RuntimeToolsResponse>("/api/runtime/tools");
}

/** 按 tool_name + arguments 执行外部工具。 */
export function executeRuntimeTool(payload: {
  username: string;
  toolName: string;
  arguments?: Record<string, unknown>;
}) {
  return postJson<RuntimeToolExecuteResponse>("/api/runtime/tool/execute", {
    username: payload.username,
    tool_name: payload.toolName,
    arguments: payload.arguments || {},
  });
}

/** 构建指定用户/课程的记忆块。 */
export function getRuntimeMemoryBlocks(payload: {
  username: string;
  lectureId: string;
}) {
  return postJson<RuntimeMemoryBlocksResponse>("/api/runtime/memory-blocks", {
    username: payload.username,
    lecture_id: payload.lectureId,
  });
}

/** 触发记忆/学习画像分析任务入队。 */
export function triggerRuntimeMemory(payload: {
  username: string;
  lectureId: string;
  reason?: string;
  payload?: Record<string, unknown>;
}) {
  return postJson<RuntimeMemoryTriggerResponse>("/api/runtime/memory/trigger", {
    username: payload.username,
    lecture_id: payload.lectureId,
    reason: payload.reason || "manual",
    payload: payload.payload || {},
  });
}

/** 标记上下文压缩任务完成。 */
export function completeRuntimeMemoryContextCompression(payload: {
  username: string;
  lectureId: string;
  jobId?: string;
}) {
  return postJson<{ success: boolean; result?: Record<string, unknown>; [key: string]: unknown }>(
    "/api/runtime/memory/context-compression",
    {
      username: payload.username,
      lecture_id: payload.lectureId,
      job_id: payload.jobId || "",
    },
  );
}

/** 增加学习轮次并按间隔触发分析。 */
export function recordRuntimeMemoryTurn(payload: {
  username: string;
  lectureId: string;
  payload?: Record<string, unknown>;
}) {
  return postJson<RuntimeMemoryTurnResponse>("/api/runtime/memory/turn", {
    username: payload.username,
    lecture_id: payload.lectureId,
    payload: payload.payload || {},
  });
}

/** 获取记忆任务队列快照。 */
export function getRuntimeMemoryQueue() {
  return getJson<RuntimeMemoryQueueResponse>("/api/runtime/memory/queue");
}
