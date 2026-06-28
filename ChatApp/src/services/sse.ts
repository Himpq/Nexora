/**
 * Generic Server-Sent Events (SSE) reader for `fetch` ReadableStream responses.
 *
 * Backends in this app speak two different SSE payload dialects (OpenAI-style
 * chunks vs Nexora's `{type,...}` runtime chunks), so this util stays dialect
 * agnostic: it only handles framing + `data:` extraction and hands each parsed
 * JSON object to the caller. The `[DONE]` sentinel and natural stream end both
 * resolve through `onDone`.
 */

export type SseHandlers = {
  signal?: AbortSignal;
  /**
   * Called for each parsed JSON data object (excluding the `[DONE]` sentinel).
   * May be async — the reader awaits it before consuming the next frame, so a
   * handler that needs to await something (e.g. a tool call) won't race ahead.
   * A thrown error aborts the read loop and propagates to the caller.
   *
   * Ignored when `onEvent` is provided — in that case `onEvent` receives both
   * the SSE event name and the parsed data, and `onData` is not called.
   */
  onData?: (data: unknown) => unknown;
  /**
   * Called for each parsed JSON data object together with its SSE `event:`
   * name (defaulting to `"message"` when the frame has no event line). When
   * provided, this replaces `onData` so callers of named-event streams (e.g.
   * `/frontend/outline/<id>/generate-stream` with `status`/`delta`/`done`) can
   * dispatch by event name. May be async.
   */
  onEvent?: (event: string, data: unknown) => unknown;
  /** Called once when `[DONE]` arrives or the stream ends without an abort. */
  onDone?: () => void;
};

function splitSseFrames(buffer: string) {
  const parts = buffer.split(/\r?\n\r?\n/);
  return {
    frames: parts.slice(0, -1),
    rest: parts[parts.length - 1] || "",
  };
}

type ParsedSseFrame = {
  event: string;
  data: string;
};

function parseSseFrame(frame: string): ParsedSseFrame {
  let event = "";
  const dataLines: string[] = [];
  for (const line of frame.split(/\r?\n/)) {
    const trimmed = line.trimEnd();
    if (trimmed.startsWith("event:")) {
      event = trimmed.slice(6).trimStart();
    } else if (trimmed.startsWith("data:")) {
      dataLines.push(trimmed.slice(5).trimStart());
    }
  }
  return { event: event || "message", data: dataLines.join("\n").trim() };
}

export async function readSseStream(response: Response, handlers: SseHandlers) {
  const reader = response.body?.getReader?.();
  if (!reader) {
    throw new Error("当前运行环境不支持 ReadableStream 流式读取。");
  }

  const decoder = new TextDecoder();
  let buffer = "";
  let done = false;
  let aborted = false;

  const handleFrame = async (frame: string) => {
    const { event, data: dataText } = parseSseFrame(frame);
    if (!dataText) {
      return;
    }
    if (dataText === "[DONE]") {
      done = true;
      handlers.onDone?.();
      return;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(dataText);
    } catch {
      // Tolerate non-JSON keepalive/comment frames.
      return;
    }
    if (handlers.onEvent) {
      await handlers.onEvent(event, parsed);
    } else if (handlers.onData) {
      await handlers.onData(parsed);
    }
  };

  while (!done) {
    if (handlers.signal?.aborted) {
      aborted = true;
      await reader.cancel().catch(() => undefined);
      break;
    }
    const { value, done: streamDone } = await reader.read();
    if (streamDone) {
      break;
    }
    buffer += decoder.decode(value, { stream: true });
    const split = splitSseFrames(buffer);
    buffer = split.rest;
    for (const frame of split.frames) {
      await handleFrame(frame);
      if (done) {
        break;
      }
    }
  }

  if (!done && !aborted) {
    buffer += decoder.decode();
    if (buffer.trim()) {
      await handleFrame(buffer);
    }
    if (!done) {
      handlers.onDone?.();
    }
  }
}
