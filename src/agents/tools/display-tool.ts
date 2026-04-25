import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { Type } from "typebox";
import { resolveCommandSecretRefsViaGateway } from "../../cli/command-secret-gateway.js";
import { getScopedChannelsCommandSecretTargets } from "../../cli/command-secret-targets.js";
import { resolveMessageSecretScope } from "../../cli/message-secret-scope.js";
import { loadConfig } from "../../config/config.js";
import type { OpenClawConfig } from "../../config/types.openclaw.js";
import type { AgentDisplayDocument, AgentDisplayInput } from "../../display/agent-display.js";
import {
  normalizeAgentDisplayDocument,
  renderA2UIV08,
  renderTelegramCard,
  renderTelegramPayload,
} from "../../display/agent-display.js";
import { GATEWAY_CLIENT_IDS, GATEWAY_CLIENT_MODES } from "../../gateway/protocol/client-info.js";
import { getToolResult, runMessageAction } from "../../infra/outbound/message-action-runner.js";
import { resolvePreferredOpenClawTmpDir } from "../../infra/tmp-openclaw-dir.js";
import { normalizeAccountId } from "../../routing/session-key.js";
import { normalizeOptionalString } from "../../shared/string-coerce.js";
import { resolveSessionAgentId } from "../agent-scope.js";
import { stringEnum } from "../schema/typebox.js";
import { type AnyAgentTool, jsonResult, readNumberParam, readStringParam } from "./common.js";
import { callGatewayTool, readGatewayCallOptions, resolveGatewayOptions } from "./gateway.js";
import { resolveNodeId } from "./nodes-utils.js";

const DISPLAY_TARGETS = ["preview", "canvas", "telegram"] as const;
const DISPLAY_BLOCK_TYPES = [
  "heading",
  "text",
  "list",
  "factList",
  "table",
  "timeline",
  "alert",
  "image",
  "actions",
] as const;
const DISPLAY_ACTION_STYLES = ["primary", "secondary", "success", "danger"] as const;
const DISPLAY_ALERT_TONES = ["info", "success", "warning", "danger"] as const;

type DisplayTarget = (typeof DISPLAY_TARGETS)[number];

type PushCanvasA2UIParams = {
  jsonl: string;
  node?: string;
  gatewayUrl?: string;
  gatewayToken?: string;
  timeoutMs?: number;
};

type SendTelegramDisplayParams = {
  cfg: OpenClawConfig;
  params: Record<string, unknown>;
  defaultAccountId?: string;
  requesterSenderId?: string | null;
  gateway?: ReturnType<typeof resolveGatewayOptions> & {
    clientName: typeof GATEWAY_CLIENT_IDS.GATEWAY_CLIENT;
    clientDisplayName: "agent";
    mode: typeof GATEWAY_CLIENT_MODES.BACKEND;
  };
  sessionKey?: string;
  sessionId?: string;
  agentId?: string;
  sandboxRoot?: string;
  abortSignal?: AbortSignal;
};

type DisplayToolOptions = {
  config?: OpenClawConfig;
  agentAccountId?: string;
  agentSessionKey?: string;
  sessionId?: string;
  sandboxRoot?: string;
  requesterSenderId?: string | null;
  loadConfig?: typeof loadConfig;
  resolveCommandSecretRefsViaGateway?: typeof resolveCommandSecretRefsViaGateway;
  pushCanvasA2UI?: (params: PushCanvasA2UIParams) => Promise<unknown>;
  sendTelegramDisplay?: (params: SendTelegramDisplayParams) => Promise<unknown>;
  writeCard?: (buffer: Buffer) => Promise<string>;
};

const AgentDisplayActionSchema = Type.Object(
  {
    label: Type.String({ description: "Button label shown to the user." }),
    value: Type.String({ description: "Opaque action value or callback identifier." }),
    style: Type.Optional(
      stringEnum(DISPLAY_ACTION_STYLES, {
        description: "Optional visual/action tone. Secondary is the neutral default.",
      }),
    ),
  },
  { description: "Source-neutral display action." },
);

const AgentDisplayFactSchema = Type.Object(
  {
    label: Type.String({ description: "Fact label." }),
    value: Type.String({ description: "Fact value." }),
  },
  { description: "Label/value fact for status, config, or result summaries." },
);

const AgentDisplayBlockSchema = Type.Object(
  {
    type: stringEnum(DISPLAY_BLOCK_TYPES, {
      description:
        "Block type: heading, text, list, factList, table, timeline, alert, image, or actions.",
    }),
    text: Type.Optional(Type.String({ description: "Heading, paragraph, or alert text." })),
    level: Type.Optional(
      Type.Integer({ minimum: 1, maximum: 3, description: "Heading level from 1 to 3." }),
    ),
    items: Type.Optional(
      Type.Array(Type.Unknown(), {
        description:
          "Items for list or timeline blocks. Use strings for list; use { title, detail? } objects for timeline.",
      }),
    ),
    facts: Type.Optional(
      Type.Array(AgentDisplayFactSchema, {
        description: "Label/value facts for factList blocks.",
      }),
    ),
    columns: Type.Optional(
      Type.Array(Type.String(), {
        description: "Column labels for table blocks.",
      }),
    ),
    rows: Type.Optional(
      Type.Array(Type.Array(Type.String()), {
        description: "Rows for table blocks.",
      }),
    ),
    tone: Type.Optional(
      stringEnum(DISPLAY_ALERT_TONES, {
        description: "Alert tone for alert blocks.",
      }),
    ),
    url: Type.Optional(Type.String({ description: "Image URL for image blocks." })),
    alt: Type.Optional(Type.String({ description: "Alternative text for image blocks." })),
    actions: Type.Optional(
      Type.Array(AgentDisplayActionSchema, {
        description: "Inline choices for actions blocks.",
      }),
    ),
  },
  {
    description:
      "AgentDisplayBlock. Use type to choose the block, then provide the matching fields.",
  },
);

const AgentDisplayDocumentSchema = Type.Object(
  {
    title: Type.Optional(Type.String({ description: "Optional display title." })),
    blocks: Type.Array(AgentDisplayBlockSchema, {
      description: "Ordered source-neutral display blocks.",
    }),
    actions: Type.Optional(
      Type.Array(AgentDisplayActionSchema, {
        description: "Top-level inline choices shown after the display content.",
      }),
    ),
  },
  { description: "Source-neutral rich display document." },
);

const DISPLAY_TOOL_DESCRIPTION = [
  "Render source-neutral rich displays for Canvas or Telegram.",
  "",
  "Use this when a response benefits from structured presentation instead of plain text: status summaries, comparisons, itineraries, ordered events, facts, warnings, image references, or user actions.",
  "",
  "Input forms: provide exactly one of document, markdown, text, or json. AgentDisplayDocument is { title?: string, blocks: AgentDisplayBlock[], actions?: AgentDisplayAction[] }.",
  "",
  "Supported AgentDisplayBlock types:",
  "- heading: section titles.",
  "- text: short paragraphs.",
  "- list: simple bullet lists.",
  "- factList: label/value facts for status, config, host checks, or result summaries.",
  "- table: comparisons or structured rows.",
  "- timeline: ordered events, itinerary steps, rollout history, or progress sequences.",
  "- alert: warnings, blockers, success/failure callouts, or important state.",
  "- image: image URL plus optional alt text.",
  "- actions: inline user choices, approvals, acknowledgements, or next steps.",
  "",
  "Targets: preview inspects Canvas and Telegram output without sending; canvas pushes A2UI v0.8 JSONL; telegram sends Telegram HTML/buttons. For Telegram, set card=true when layout density or visual hierarchy should be sent as a PNG card attachment.",
].join("\n");

const DisplayToolSchema = Type.Object({
  target: stringEnum(DISPLAY_TARGETS, {
    description: "Render target: preview, canvas, or telegram.",
  }),
  document: Type.Optional(AgentDisplayDocumentSchema),
  markdown: Type.Optional(
    Type.String({ description: "Markdown-ish source content to normalize into display blocks." }),
  ),
  text: Type.Optional(
    Type.String({ description: "Plain text source content to render as a text block." }),
  ),
  json: Type.Optional(
    Type.Any({
      description:
        "Arbitrary JSON source content. Structured display documents are normalized; other JSON is shown as formatted text.",
    }),
  ),
  card: Type.Optional(
    Type.Boolean({
      description: "Telegram only. Attach a PNG card when layout density or hierarchy matters.",
    }),
  ),
  // Canvas routing.
  node: Type.Optional(Type.String({ description: "Canvas node id for target=canvas." })),
  gatewayUrl: Type.Optional(Type.String({ description: "Optional gateway URL override." })),
  gatewayToken: Type.Optional(Type.String({ description: "Optional gateway token override." })),
  timeoutMs: Type.Optional(Type.Number({ description: "Optional gateway timeout in ms." })),
  // Telegram routing.
  to: Type.Optional(Type.String({ description: "Telegram target for target=telegram." })),
  accountId: Type.Optional(Type.String({ description: "Optional Telegram account id override." })),
  threadId: Type.Optional(Type.String({ description: "Optional Telegram topic/thread id." })),
  replyTo: Type.Optional(Type.String({ description: "Optional message id to reply to." })),
  forceDocument: Type.Optional(
    Type.Boolean({ description: "Telegram only. Force document-style delivery when supported." }),
  ),
});

function readDisplayInput(params: Record<string, unknown>): AgentDisplayInput {
  if (params.document !== undefined) {
    return { document: params.document };
  }
  const markdown = readStringParam(params, "markdown", { allowEmpty: false });
  if (markdown) {
    return { markdown };
  }
  const text = readStringParam(params, "text", { allowEmpty: false });
  if (text) {
    return { text };
  }
  if (params.json !== undefined) {
    if (typeof params.json === "string") {
      try {
        return { json: JSON.parse(params.json) };
      } catch {
        return { text: params.json };
      }
    }
    return { json: params.json };
  }
  throw new Error("document, markdown, text, or json required");
}

async function defaultPushCanvasA2UI(params: PushCanvasA2UIParams): Promise<unknown> {
  const gatewayOpts = readGatewayCallOptions(params);
  const nodeId = await resolveNodeId(gatewayOpts, params.node, true);
  return await callGatewayTool("node.invoke", gatewayOpts, {
    nodeId,
    command: "canvas.a2ui.pushJSONL",
    params: { jsonl: params.jsonl },
    idempotencyKey: crypto.randomUUID(),
  });
}

async function defaultWriteCard(buffer: Buffer): Promise<string> {
  const filePath = path.join(
    resolvePreferredOpenClawTmpDir(),
    `openclaw-display-${crypto.randomUUID()}.png`,
  );
  await fs.writeFile(filePath, buffer);
  return filePath;
}

async function defaultSendTelegramDisplay(params: SendTelegramDisplayParams): Promise<unknown> {
  return await runMessageAction({
    cfg: params.cfg,
    action: "send",
    params: params.params,
    defaultAccountId: params.defaultAccountId,
    requesterSenderId: params.requesterSenderId,
    gateway: params.gateway,
    sessionKey: params.sessionKey,
    sessionId: params.sessionId,
    agentId: params.agentId,
    sandboxRoot: params.sandboxRoot,
    abortSignal: params.abortSignal,
  });
}

function buildPreviewResult(document: AgentDisplayDocument) {
  return {
    ok: true,
    target: "preview",
    document,
    a2ui: renderA2UIV08(document),
    telegram: renderTelegramPayload(document),
  };
}

export function createDisplayTool(options?: DisplayToolOptions): AnyAgentTool {
  const pushCanvasA2UI = options?.pushCanvasA2UI ?? defaultPushCanvasA2UI;
  const sendTelegramDisplay = options?.sendTelegramDisplay ?? defaultSendTelegramDisplay;
  const writeCard = options?.writeCard ?? defaultWriteCard;
  const loadConfigForTool = options?.loadConfig ?? loadConfig;
  const resolveSecretRefsForTool =
    options?.resolveCommandSecretRefsViaGateway ?? resolveCommandSecretRefsViaGateway;
  const normalizedAgentAccountId = normalizeOptionalString(options?.agentAccountId);
  const agentAccountId = normalizedAgentAccountId
    ? normalizeAccountId(normalizedAgentAccountId)
    : undefined;
  const resolvedAgentId = options?.agentSessionKey
    ? resolveSessionAgentId({
        sessionKey: options.agentSessionKey,
        config: options?.config,
      })
    : undefined;

  return {
    label: "Display",
    name: "display",
    displaySummary: "Render source-neutral rich displays for Canvas or Telegram.",
    description: DISPLAY_TOOL_DESCRIPTION,
    parameters: DisplayToolSchema,
    execute: async (_toolCallId, args, signal) => {
      const params = { ...(args as Record<string, unknown>) };
      const targetRaw = readStringParam(params, "target", { required: true });
      if (!DISPLAY_TARGETS.includes(targetRaw as DisplayTarget)) {
        throw new Error(`Unknown display target: ${targetRaw}`);
      }
      const target = targetRaw as DisplayTarget;
      const document = normalizeAgentDisplayDocument(readDisplayInput(params));

      if (target === "preview") {
        return jsonResult(buildPreviewResult(document));
      }

      if (target === "canvas") {
        const jsonl = renderA2UIV08(document);
        await pushCanvasA2UI({
          jsonl,
          node: readStringParam(params, "node", { trim: true }),
          gatewayUrl: readStringParam(params, "gatewayUrl", { trim: false }),
          gatewayToken: readStringParam(params, "gatewayToken", { trim: false }),
          timeoutMs: readNumberParam(params, "timeoutMs"),
        });
        return jsonResult({ ok: true, target: "canvas", document });
      }

      const to = readStringParam(params, "to", {
        required: true,
        label: "to",
      });
      const payload = renderTelegramPayload(document);
      const sendParams: Record<string, unknown> = {
        channel: "telegram",
        target: to,
        message: payload.text,
        caption: payload.text,
        parseMode: "HTML",
        channelData: payload.channelData,
        interactive: payload.interactive,
        accountId: readStringParam(params, "accountId") ?? agentAccountId,
        threadId: readStringParam(params, "threadId"),
        replyTo: readStringParam(params, "replyTo"),
        forceDocument: params.forceDocument === true,
      };
      for (const [key, value] of Object.entries(sendParams)) {
        if (value === undefined || value === false) {
          delete sendParams[key];
        }
      }

      let cardPath: string | undefined;
      if (params.card === true) {
        const card = await renderTelegramCard(document);
        cardPath = await writeCard(card.buffer);
        sendParams.media = cardPath;
        sendParams.mimeType = card.mimeType;
        sendParams.filename = card.fileName;
      }

      let cfg = options?.config;
      if (!cfg) {
        const loadedRaw = loadConfigForTool();
        const scope = resolveMessageSecretScope({
          channel: "telegram",
          target: to,
          accountId: sendParams.accountId,
        });
        const scopedTargets = getScopedChannelsCommandSecretTargets({
          config: loadedRaw,
          channel: scope.channel,
          accountId: scope.accountId,
        });
        cfg = (
          await resolveSecretRefsForTool({
            config: loadedRaw,
            commandName: "tools.display",
            targetIds: scopedTargets.targetIds,
            ...(scopedTargets.allowedPaths ? { allowedPaths: scopedTargets.allowedPaths } : {}),
            mode: "enforce_resolved",
          })
        ).resolvedConfig;
      }

      const gatewayResolved = resolveGatewayOptions({
        gatewayUrl: readStringParam(params, "gatewayUrl", { trim: false }),
        gatewayToken: readStringParam(params, "gatewayToken", { trim: false }),
        timeoutMs: readNumberParam(params, "timeoutMs"),
      });
      const gateway = {
        ...gatewayResolved,
        clientName: GATEWAY_CLIENT_IDS.GATEWAY_CLIENT,
        clientDisplayName: "agent" as const,
        mode: GATEWAY_CLIENT_MODES.BACKEND,
      };
      const result = await sendTelegramDisplay({
        cfg,
        params: sendParams,
        defaultAccountId: agentAccountId,
        requesterSenderId: options?.requesterSenderId,
        gateway,
        sessionKey: options?.agentSessionKey,
        sessionId: options?.sessionId,
        agentId: resolvedAgentId,
        sandboxRoot: options?.sandboxRoot,
        abortSignal: signal,
      });
      const toolResult = getToolResult(result as never);
      if (toolResult) {
        return toolResult;
      }
      return jsonResult({ ok: true, target: "telegram", document, cardPath, result });
    },
  };
}
