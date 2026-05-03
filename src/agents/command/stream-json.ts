import type { AgentEventPayload } from "../../infra/agent-events.js";
import { onAgentEvent } from "../../infra/agent-events.js";

type AgentCommandStreamLine = {
  type: "step_start" | "step_finish" | "tool_use" | "tool_result" | "thinking" | "text" | "error";
  runId: string;
  seq: number;
  ts: number;
  stream: string;
  content?: string;
  text?: string;
  tool?: string;
  callId?: string;
  input?: Record<string, unknown>;
  output?: string;
  status?: string;
  event?: Record<string, unknown>;
};

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

function objectValue(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }
  return value as Record<string, unknown>;
}

function textFromParts(...values: unknown[]): string | undefined {
  for (const value of values) {
    const text = stringValue(value);
    if (text) {
      return text;
    }
  }
  return undefined;
}

function baseLine(
  evt: AgentEventPayload,
  type: AgentCommandStreamLine["type"],
): AgentCommandStreamLine {
  return {
    type,
    runId: evt.runId,
    seq: evt.seq,
    ts: evt.ts,
    stream: evt.stream,
  };
}

function withText<T extends AgentCommandStreamLine>(line: T): T {
  if (line.content && !line.text) {
    return { ...line, text: line.content };
  }
  return line;
}

function mapLifecycleEvent(evt: AgentEventPayload): AgentCommandStreamLine | null {
  const phase = stringValue(evt.data.phase);
  if (phase === "start") {
    return withText({
      ...baseLine(evt, "step_start"),
      content: textFromParts(evt.data.title, "Agent run started"),
      event: evt.data,
    });
  }
  if (phase === "end") {
    return withText({
      ...baseLine(evt, "step_finish"),
      content: textFromParts(evt.data.stopReason, "Agent run finished"),
      status: "completed",
      event: evt.data,
    });
  }
  if (phase === "error") {
    return withText({
      ...baseLine(evt, "error"),
      content: textFromParts(evt.data.error, evt.data.message, "Agent run failed"),
      status: "failed",
      event: evt.data,
    });
  }
  return null;
}

function mapItemEvent(evt: AgentEventPayload): AgentCommandStreamLine | null {
  const phase = stringValue(evt.data.phase);
  const status = stringValue(evt.data.status);
  const tool = textFromParts(evt.data.name, evt.data.kind, "step");
  const content = textFromParts(evt.data.progressText, evt.data.summary, evt.data.title, tool);
  if (phase === "start") {
    return withText({
      ...baseLine(evt, "tool_use"),
      tool,
      callId: stringValue(evt.data.toolCallId) ?? stringValue(evt.data.itemId),
      content,
      status,
      input: {
        kind: evt.data.kind,
        title: evt.data.title,
        meta: evt.data.meta,
      },
      event: evt.data,
    });
  }
  if (phase === "end") {
    return withText({
      ...baseLine(evt, status === "failed" ? "error" : "tool_result"),
      tool,
      callId: stringValue(evt.data.toolCallId) ?? stringValue(evt.data.itemId),
      content,
      output: textFromParts(
        evt.data.error,
        evt.data.summary,
        evt.data.progressText,
        evt.data.title,
      ),
      status,
      event: evt.data,
    });
  }
  if (phase === "update") {
    return withText({
      ...baseLine(evt, "thinking"),
      content,
      status,
      event: evt.data,
    });
  }
  return null;
}

function mapCommandOutputEvent(evt: AgentEventPayload): AgentCommandStreamLine | null {
  const output = stringValue(evt.data.output);
  if (!output) {
    return null;
  }
  return withText({
    ...baseLine(evt, "tool_result"),
    tool: textFromParts(evt.data.name, "command"),
    callId: stringValue(evt.data.toolCallId) ?? stringValue(evt.data.itemId),
    content: textFromParts(evt.data.title, evt.data.name),
    text: output,
    output,
    status: stringValue(evt.data.status),
    event: evt.data,
  });
}

export function mapAgentEventToStreamLine(evt: AgentEventPayload): AgentCommandStreamLine | null {
  if (evt.stream === "lifecycle") {
    return mapLifecycleEvent(evt);
  }
  if (evt.stream === "assistant") {
    const content = textFromParts(evt.data.delta, evt.data.text);
    return content ? withText({ ...baseLine(evt, "text"), content, event: evt.data }) : null;
  }
  if (evt.stream === "item") {
    return mapItemEvent(evt);
  }
  if (evt.stream === "command_output" || evt.stream === "tool") {
    return mapCommandOutputEvent(evt);
  }
  if (evt.stream === "plan") {
    const content = textFromParts(
      evt.data.explanation,
      evt.data.title,
      Array.isArray(evt.data.steps) ? evt.data.steps.join("\n") : undefined,
    );
    return content ? withText({ ...baseLine(evt, "thinking"), content, event: evt.data }) : null;
  }
  if (evt.stream === "approval" || evt.stream === "compaction" || evt.stream === "patch") {
    const content = textFromParts(evt.data.message, evt.data.summary, evt.data.title);
    return content ? withText({ ...baseLine(evt, "thinking"), content, event: evt.data }) : null;
  }
  if (evt.stream === "error") {
    return withText({
      ...baseLine(evt, "error"),
      content: textFromParts(evt.data.error, evt.data.message, "Agent error"),
      event: evt.data,
    });
  }
  const genericEvent = objectValue(evt.data);
  return genericEvent ? { ...baseLine(evt, "thinking"), event: genericEvent } : null;
}

export function startAgentCommandStreamJson(params: { runId: string }): () => void {
  return onAgentEvent((evt) => {
    if (evt.runId !== params.runId) {
      return;
    }
    const line = mapAgentEventToStreamLine(evt);
    if (!line) {
      return;
    }
    process.stdout.write(`${JSON.stringify(line)}\n`);
  });
}
