import fs from "node:fs/promises";
import { describe, expect, it, vi } from "vitest";
import { resolvePreferredOpenClawTmpDir } from "../../infra/tmp-openclaw-dir.js";
import { resolveSandboxedMediaSource } from "../sandbox-paths.js";
import { createDisplayTool } from "./display-tool.js";

function firstText(result: Awaited<ReturnType<ReturnType<typeof createDisplayTool>["execute"]>>) {
  const content = result.content[0];
  return content?.type === "text" ? content.text : "";
}

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

describe("display tool", () => {
  it("describes available document blocks and target selection to agents", () => {
    const tool = createDisplayTool();

    expect(tool.description).toContain("AgentDisplayDocument");
    expect(tool.description).toContain("card=true");
    for (const target of ["preview", "canvas", "telegram"]) {
      expect(tool.description).toContain(target);
    }
    for (const blockType of DISPLAY_BLOCK_TYPES) {
      expect(tool.description).toContain(blockType);
    }
    for (const guidance of ["status", "comparisons", "ordered events", "warnings"]) {
      expect(tool.description).toContain(guidance);
    }
  });

  it("exposes the AgentDisplayDocument block vocabulary in the native tool schema", () => {
    const tool = createDisplayTool();
    const parameters = tool.parameters as {
      properties?: Record<string, unknown>;
    };
    const documentSchema = parameters.properties?.document;
    const encodedDocumentSchema = JSON.stringify(documentSchema);

    expect(encodedDocumentSchema).toContain('"blocks"');
    expect(encodedDocumentSchema).toContain('"actions"');
    for (const blockType of DISPLAY_BLOCK_TYPES) {
      expect(encodedDocumentSchema).toContain(`"${blockType}"`);
    }
  });

  it("previews source-neutral content for Canvas and Telegram without sending", async () => {
    const tool = createDisplayTool();

    const result = await tool.execute("call-1", {
      target: "preview",
      markdown: "# Kyoto\n\n- Tea\n- Rail",
    });

    expect(result.details).toMatchObject({
      ok: true,
      target: "preview",
      document: {
        title: "Kyoto",
        blocks: [
          { type: "heading", text: "Kyoto" },
          { type: "list", items: ["Tea", "Rail"] },
        ],
      },
    });
    expect(firstText(result)).toContain("surfaceUpdate");
    expect(firstText(result)).toContain("<b>Kyoto</b>");
  });

  it("rejects ambiguous display input forms instead of silently choosing one", async () => {
    const tool = createDisplayTool();

    await expect(
      tool.execute("call-1", {
        target: "preview",
        markdown: "# Kyoto",
        text: "Plain fallback",
      }),
    ).rejects.toThrow("Provide exactly one of document, markdown, text, or json");
  });

  it("pushes A2UI v0.8 JSONL through the Canvas gateway adapter", async () => {
    const pushed: Array<{ jsonl: string }> = [];
    const pushCanvasA2UI = vi.fn(async (params: { jsonl: string }) => {
      pushed.push(params);
      return { ok: true };
    });
    const tool = createDisplayTool({ pushCanvasA2UI });

    const result = await tool.execute("call-1", {
      target: "canvas",
      markdown: "# Kyoto",
      node: "canvas-node",
      gatewayUrl: "http://127.0.0.1:5333",
      gatewayToken: "dev-token",
    });

    expect(pushCanvasA2UI).toHaveBeenCalledWith(
      expect.objectContaining({
        jsonl: expect.stringContaining('"surfaceUpdate"'),
        node: "canvas-node",
        gatewayUrl: "http://127.0.0.1:5333",
        gatewayToken: "dev-token",
      }),
    );
    const canvasCall = pushed[0];
    expect(canvasCall).toBeDefined();
    expect(canvasCall?.jsonl).not.toContain("createSurface");
    expect(result.details).toMatchObject({ ok: true, target: "canvas" });
  });

  it("sends Telegram-native HTML and inline actions through the message adapter", async () => {
    const sendTelegramDisplay = vi.fn(async () => ({ ok: true, id: "message-1" }));
    const tool = createDisplayTool({ sendTelegramDisplay });

    const result = await tool.execute("call-1", {
      target: "telegram",
      to: "telegram:group:123",
      document: {
        title: "Route options",
        blocks: [{ type: "text", text: "Choose one." }],
        actions: [{ label: "Pick A", value: "route:a", style: "primary" }],
      },
    });

    expect(sendTelegramDisplay).toHaveBeenCalledWith(
      expect.objectContaining({
        params: expect.objectContaining({
          channel: "telegram",
          target: "telegram:group:123",
          message: expect.stringContaining("<b>Route options</b>"),
          interactive: {
            blocks: [
              {
                type: "buttons",
                buttons: [{ label: "Pick A", value: "route:a", style: "primary" }],
              },
            ],
          },
          channelData: {
            telegram: {
              parseMode: "HTML",
              buttons: [[expect.objectContaining({ text: "Pick A", callback_data: "route:a" })]],
            },
          },
        }),
      }),
    );
    expect(result.details).toMatchObject({ ok: true, target: "telegram" });
  });

  it("attaches a PNG card for layout-heavy Telegram displays", async () => {
    const sendTelegramDisplay = vi.fn(async () => ({ ok: true }));
    const writeCard = vi.fn(async () => "/tmp/openclaw-display-card.png");
    const tool = createDisplayTool({ sendTelegramDisplay, writeCard });

    await tool.execute("call-1", {
      target: "telegram",
      to: "telegram:group:123",
      card: true,
      markdown: "# Status\n\nEverything is green.",
    });

    expect(writeCard).toHaveBeenCalledWith(expect.any(Buffer));
    expect(sendTelegramDisplay).toHaveBeenCalledWith(
      expect.objectContaining({
        params: expect.objectContaining({
          media: "/tmp/openclaw-display-card.png",
          mimeType: "image/png",
          caption: expect.stringContaining("<b>Status</b>"),
        }),
      }),
    );
  });

  it("writes default Telegram cards under the media-approved OpenClaw temp root", async () => {
    let mediaPath: string | undefined;
    const sandboxRoot = "/tmp/openclaw-display-sandbox";
    const sendTelegramDisplay = vi.fn(async ({ params }: { params: Record<string, unknown> }) => {
      mediaPath = typeof params.media === "string" ? params.media : undefined;
      return { ok: true };
    });
    const tool = createDisplayTool({ sendTelegramDisplay, sandboxRoot });

    await tool.execute("call-1", {
      target: "telegram",
      to: "telegram:group:123",
      card: true,
      markdown: "# Status\n\nEverything is green.",
    });

    expect(mediaPath).toBeDefined();
    expect(mediaPath?.startsWith(resolvePreferredOpenClawTmpDir())).toBe(true);
    await expect(resolveSandboxedMediaSource({ media: mediaPath!, sandboxRoot })).resolves.toBe(
      mediaPath,
    );

    await fs.unlink(mediaPath!).catch(() => undefined);
  });
});
