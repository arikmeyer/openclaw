import { describe, expect, it } from "vitest";
import {
  normalizeAgentDisplayDocument,
  renderA2UIV08,
  renderTelegramCard,
  renderTelegramPayload,
} from "./agent-display.js";

describe("AgentDisplayDocument", () => {
  it("normalizes markdown into source-neutral display blocks", () => {
    const doc = normalizeAgentDisplayDocument({
      markdown: [
        "# Kyoto day brief",
        "",
        "Start at Kyoto Station.",
        "",
        "- Fushimi Inari",
        "- Nishiki Market",
      ].join("\n"),
    });

    expect(doc).toMatchObject({
      title: "Kyoto day brief",
      blocks: [
        { type: "heading", text: "Kyoto day brief", level: 1 },
        { type: "text", text: "Start at Kyoto Station." },
        { type: "list", items: ["Fushimi Inari", "Nishiki Market"] },
      ],
    });
  });

  it("keeps structured document actions source-neutral and renders them as Telegram buttons", () => {
    const doc = normalizeAgentDisplayDocument({
      document: {
        title: "Ops status",
        blocks: [
          { type: "factList", facts: [{ label: "Host", value: "TabiAgent" }] },
          {
            type: "actions",
            actions: [
              { label: "Refresh", value: "display:refresh", style: "primary" },
              { label: "Acknowledge", value: "display:ack", style: "success" },
            ],
          },
        ],
      },
    });

    const payload = renderTelegramPayload(doc);

    expect(payload.text).toContain("<b>Ops status</b>");
    expect(payload.text).toContain("<b>Host:</b> TabiAgent");
    expect(payload.interactive).toEqual({
      blocks: [
        {
          type: "buttons",
          buttons: [
            { label: "Refresh", value: "display:refresh", style: "primary" },
            { label: "Acknowledge", value: "display:ack", style: "success" },
          ],
        },
      ],
    });
    expect(payload.channelData?.telegram?.buttons).toEqual([
      [
        { text: "Refresh", callback_data: "display:refresh", style: "primary" },
        { text: "Acknowledge", callback_data: "display:ack", style: "success" },
      ],
    ]);
  });

  it("renders Canvas A2UI JSONL with the supported v0.8 actions only", () => {
    const doc = normalizeAgentDisplayDocument({
      document: {
        title: "Display smoke",
        blocks: [
          { type: "heading", text: "Display smoke", level: 1 },
          { type: "text", text: "A2UI v0.8 only." },
        ],
      },
    });

    const jsonl = renderA2UIV08(doc);
    const messages = jsonl.split("\n").map((line) => JSON.parse(line));

    expect(messages).toHaveLength(2);
    expect(messages.map((message) => Object.keys(message)[0])).toEqual([
      "surfaceUpdate",
      "beginRendering",
    ]);
    expect(jsonl).not.toContain("createSurface");
    expect(jsonl).toContain("Display smoke");
  });

  it("renders top-level document titles in Canvas even when blocks do not duplicate them", () => {
    const doc = normalizeAgentDisplayDocument({
      document: {
        title: "OpenClaw display smoke",
        blocks: [{ type: "text", text: "A2UI v0.8 only." }],
      },
    });

    const jsonl = renderA2UIV08(doc);
    const messages = jsonl.split("\n").map((line) => JSON.parse(line));
    const components = messages[0].surfaceUpdate.components;

    expect(components).toContainEqual(
      expect.objectContaining({
        component: {
          Text: {
            text: { literalString: "OpenClaw display smoke" },
            usageHint: "h1",
          },
        },
      }),
    );
    expect(components).toContainEqual(
      expect.objectContaining({
        component: {
          Text: {
            text: { literalString: "A2UI v0.8 only." },
            usageHint: "body",
          },
        },
      }),
    );
  });

  it("keeps the document title as the single Canvas h1 when a duplicate heading omits level", () => {
    const doc = normalizeAgentDisplayDocument({
      document: {
        title: "OpenClaw display smoke",
        blocks: [
          { type: "heading", text: "OpenClaw display smoke" },
          { type: "text", text: "Source-neutral display rendering is available." },
        ],
      },
    });

    const jsonl = renderA2UIV08(doc);
    const messages = jsonl.split("\n").map((line) => JSON.parse(line));
    const textComponents = messages[0].surfaceUpdate.components
      .map(
        (component: {
          component?: { Text?: { text?: { literalString?: string }; usageHint?: string } };
        }) => component.component?.Text,
      )
      .filter(Boolean);

    expect(
      textComponents.filter(
        (component: { text?: { literalString?: string }; usageHint?: string }) =>
          component.text?.literalString === "OpenClaw display smoke",
      ),
    ).toEqual([{ text: { literalString: "OpenClaw display smoke" }, usageHint: "h1" }]);
  });

  it("does not treat body text matching the document title as a duplicate heading", () => {
    const doc = normalizeAgentDisplayDocument({
      document: {
        title: "Status",
        blocks: [{ type: "text", text: "Status" }],
      },
    });

    const jsonl = renderA2UIV08(doc);
    const messages = jsonl.split("\n").map((line) => JSON.parse(line));
    const textComponents = messages[0].surfaceUpdate.components
      .map(
        (component: {
          component?: { Text?: { text?: { literalString?: string }; usageHint?: string } };
        }) => component.component?.Text,
      )
      .filter(Boolean);

    expect(textComponents).toContainEqual({ text: { literalString: "Status" }, usageHint: "h1" });
    expect(textComponents).toContainEqual({ text: { literalString: "Status" }, usageHint: "body" });
  });

  it("renders layout-heavy documents to a PNG card without browser runtime", async () => {
    const doc = normalizeAgentDisplayDocument({
      document: {
        title: "Hotel comparison",
        blocks: [
          {
            type: "table",
            columns: ["Hotel", "Pool", "Rating"],
            rows: [
              ["Aman Kyoto", "Yes", "4.8"],
              ["Ace Kyoto", "No", "4.5"],
            ],
          },
        ],
      },
    });

    const card = await renderTelegramCard(doc);

    expect(card.mimeType).toBe("image/png");
    expect(card.fileName).toBe("agent-display-card.png");
    expect(card.buffer.subarray(0, 8).toString("hex")).toBe("89504e470d0a1a0a");
    expect(card.buffer.byteLength).toBeGreaterThan(1000);
  });
});
