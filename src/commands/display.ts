import {
  normalizeAgentDisplayDocument,
  renderA2UIV08,
  renderTelegramCard,
  renderTelegramPayload,
} from "../display/agent-display.js";
import type { RuntimeEnv } from "../runtime.js";
import { writeRuntimeJson } from "../runtime.js";
import { normalizeLowercaseStringOrEmpty } from "../shared/string-coerce.js";

const DISPLAY_SMOKE_TARGETS = ["a2ui", "telegram", "card"] as const;

type DisplaySmokeTarget = (typeof DISPLAY_SMOKE_TARGETS)[number];

function resolveSmokeTarget(value: unknown): DisplaySmokeTarget {
  const normalized = normalizeLowercaseStringOrEmpty(value) || "telegram";
  if (normalized === "canvas") {
    return "a2ui";
  }
  if ((DISPLAY_SMOKE_TARGETS as readonly string[]).includes(normalized)) {
    return normalized as DisplaySmokeTarget;
  }
  throw new Error(`Unknown display smoke target: ${String(value)}`);
}

function createSmokeDocument() {
  return normalizeAgentDisplayDocument({
    document: {
      title: "OpenClaw display smoke",
      blocks: [
        { type: "text", text: "Source-neutral display rendering is available." },
        {
          type: "factList",
          facts: [
            { label: "Canvas", value: "A2UI v0.8 JSONL" },
            { label: "Telegram", value: "HTML text, buttons, optional PNG cards" },
          ],
        },
      ],
      actions: [{ label: "Acknowledge", value: "display:ack", style: "primary" }],
    },
  });
}

export async function displaySmokeCommand(opts: Record<string, unknown>, runtime: RuntimeEnv) {
  const target = resolveSmokeTarget(opts.target);
  const document = createSmokeDocument();
  const json = opts.json === true;

  if (target === "a2ui") {
    const a2ui = renderA2UIV08(document);
    if (json) {
      writeRuntimeJson(runtime, { target, a2ui });
      return;
    }
    runtime.log(a2ui);
    return;
  }

  if (target === "telegram") {
    const telegram = renderTelegramPayload(document);
    if (json) {
      writeRuntimeJson(runtime, { target, telegram });
      return;
    }
    runtime.log(telegram.text);
    return;
  }

  const card = await renderTelegramCard(document);
  const payload = {
    target,
    card: {
      mimeType: card.mimeType,
      fileName: card.fileName,
      byteLength: card.buffer.byteLength,
      pngSignature: card.buffer.subarray(0, 8).toString("hex"),
    },
  };
  if (json) {
    writeRuntimeJson(runtime, payload);
    return;
  }
  runtime.log(`${payload.card.fileName} ${payload.card.mimeType} ${payload.card.byteLength} bytes`);
}
