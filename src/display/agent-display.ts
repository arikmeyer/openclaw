import type { ReplyPayload } from "../auto-reply/types.js";

export type AgentDisplayActionStyle = "primary" | "secondary" | "success" | "danger";

export type AgentDisplayAction = {
  label: string;
  value: string;
  style?: AgentDisplayActionStyle;
};

export type AgentDisplayFact = {
  label: string;
  value: string;
};

export type AgentDisplayBlock =
  | { type: "heading"; text: string; level?: 1 | 2 | 3 }
  | { type: "text"; text: string }
  | { type: "list"; items: string[] }
  | { type: "factList"; facts: AgentDisplayFact[] }
  | { type: "table"; columns: string[]; rows: string[][] }
  | { type: "timeline"; items: Array<{ title: string; detail?: string }> }
  | { type: "alert"; tone?: "info" | "success" | "warning" | "danger"; text: string }
  | { type: "image"; url: string; alt?: string }
  | { type: "actions"; actions: AgentDisplayAction[] };

export type AgentDisplayDocument = {
  title?: string;
  blocks: AgentDisplayBlock[];
  actions?: AgentDisplayAction[];
};

export type AgentDisplayInput =
  | { document: unknown }
  | { markdown: string }
  | { text: string }
  | { json: unknown };

export type TelegramDisplayPayload = ReplyPayload & {
  channelData?: {
    telegram?: {
      parseMode?: "HTML";
      buttons?: Array<Array<{ text: string; callback_data: string; style?: string }>>;
    };
  };
};

export type TelegramDisplayCard = {
  buffer: Buffer;
  mimeType: "image/png";
  fileName: "agent-display-card.png";
};

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function normalizeActionStyle(value: unknown): AgentDisplayActionStyle | undefined {
  return value === "primary" || value === "secondary" || value === "success" || value === "danger"
    ? value
    : undefined;
}

function normalizeAction(value: unknown): AgentDisplayAction | null {
  const record = asRecord(value);
  if (!record) {
    return null;
  }
  const label = readString(record.label);
  const actionValue = readString(record.value);
  if (!label || !actionValue) {
    return null;
  }
  return {
    label,
    value: actionValue,
    ...(normalizeActionStyle(record.style) ? { style: normalizeActionStyle(record.style) } : {}),
  };
}

function normalizeFact(value: unknown): AgentDisplayFact | null {
  const record = asRecord(value);
  if (!record) {
    return null;
  }
  const label = readString(record.label);
  const factValue = readString(record.value);
  return label && factValue ? { label, value: factValue } : null;
}

function normalizeStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.flatMap((item) => readString(item) ?? []) : [];
}

function normalizeTableRows(value: unknown): string[][] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.flatMap((row) => {
    if (!Array.isArray(row)) {
      return [];
    }
    const normalized = row.map((cell) => String(cell ?? "").trim());
    return normalized.length > 0 ? [normalized] : [];
  });
}

function normalizeBlock(value: unknown): AgentDisplayBlock | null {
  const record = asRecord(value);
  if (!record) {
    return null;
  }
  const type = readString(record.type);
  switch (type) {
    case "heading": {
      const text = readString(record.text);
      if (!text) {
        return null;
      }
      const rawLevel = typeof record.level === "number" ? Math.trunc(record.level) : 2;
      const level = rawLevel === 1 || rawLevel === 2 || rawLevel === 3 ? rawLevel : 2;
      return { type: "heading", text, level };
    }
    case "text": {
      const text = readString(record.text);
      return text ? { type: "text", text } : null;
    }
    case "list": {
      const items = normalizeStringArray(record.items);
      return items.length ? { type: "list", items } : null;
    }
    case "factList": {
      const facts = Array.isArray(record.facts)
        ? record.facts.flatMap((fact) => normalizeFact(fact) ?? [])
        : [];
      return facts.length ? { type: "factList", facts } : null;
    }
    case "table": {
      const columns = normalizeStringArray(record.columns);
      const rows = normalizeTableRows(record.rows);
      return columns.length && rows.length ? { type: "table", columns, rows } : null;
    }
    case "timeline": {
      const items = Array.isArray(record.items)
        ? record.items.flatMap((item) => {
            const itemRecord = asRecord(item);
            const title = itemRecord ? readString(itemRecord.title) : undefined;
            if (!title) {
              return [];
            }
            const detail = readString(itemRecord?.detail);
            return [{ title, ...(detail ? { detail } : {}) }];
          })
        : [];
      return items.length ? { type: "timeline", items } : null;
    }
    case "alert": {
      const text = readString(record.text);
      const tone =
        record.tone === "success" ||
        record.tone === "warning" ||
        record.tone === "danger" ||
        record.tone === "info"
          ? record.tone
          : undefined;
      return text ? { type: "alert", ...(tone ? { tone } : {}), text } : null;
    }
    case "image": {
      const url = readString(record.url);
      const alt = readString(record.alt);
      return url ? { type: "image", url, ...(alt ? { alt } : {}) } : null;
    }
    case "actions": {
      const actions = Array.isArray(record.actions)
        ? record.actions.flatMap((action) => normalizeAction(action) ?? [])
        : [];
      return actions.length ? { type: "actions", actions } : null;
    }
    default:
      return null;
  }
}

function normalizeStructuredDocument(value: unknown): AgentDisplayDocument | null {
  const record = asRecord(value);
  if (!record) {
    return null;
  }
  const title = readString(record.title);
  const blocks = Array.isArray(record.blocks)
    ? record.blocks.flatMap((block) => normalizeBlock(block) ?? [])
    : [];
  const actions = Array.isArray(record.actions)
    ? record.actions.flatMap((action) => normalizeAction(action) ?? [])
    : [];
  if (!blocks.length && !title) {
    return null;
  }
  return {
    ...(title ? { title } : {}),
    ...(actions.length ? { actions } : {}),
    blocks: blocks.length ? blocks : [{ type: "heading", text: title ?? "Display", level: 1 }],
  };
}

function normalizeMarkdown(markdown: string): AgentDisplayDocument {
  const blocks: AgentDisplayBlock[] = [];
  let title: string | undefined;
  let paragraph: string[] = [];
  let listItems: string[] = [];

  const flushParagraph = () => {
    if (paragraph.length) {
      blocks.push({ type: "text", text: paragraph.join(" ") });
      paragraph = [];
    }
  };
  const flushList = () => {
    if (listItems.length) {
      blocks.push({ type: "list", items: listItems });
      listItems = [];
    }
  };

  for (const rawLine of markdown.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) {
      flushParagraph();
      flushList();
      continue;
    }
    const heading = /^(#{1,3})\s+(.+)$/.exec(line);
    if (heading) {
      flushParagraph();
      flushList();
      const level = heading[1].length as 1 | 2 | 3;
      const text = heading[2].trim();
      title ??= level === 1 ? text : undefined;
      blocks.push({ type: "heading", text, level });
      continue;
    }
    const list = /^[-*]\s+(.+)$/.exec(line);
    if (list) {
      flushParagraph();
      listItems.push(list[1].trim());
      continue;
    }
    flushList();
    paragraph.push(line);
  }
  flushParagraph();
  flushList();

  return { ...(title ? { title } : {}), blocks };
}

export function normalizeAgentDisplayDocument(input: AgentDisplayInput): AgentDisplayDocument {
  if ("document" in input) {
    const document = normalizeStructuredDocument(input.document);
    if (!document) {
      throw new Error("Invalid AgentDisplayDocument");
    }
    return document;
  }
  if ("markdown" in input) {
    return normalizeMarkdown(input.markdown);
  }
  if ("text" in input) {
    return { blocks: [{ type: "text", text: input.text }] };
  }
  const document = normalizeStructuredDocument(input.json);
  if (document) {
    return document;
  }
  return {
    blocks: [{ type: "text", text: JSON.stringify(input.json, null, 2) }],
  };
}

function escapeHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function assertNeverBlock(block: never): never {
  throw new Error(`Unsupported AgentDisplayBlock: ${JSON.stringify(block)}`);
}

function renderTelegramBlock(block: AgentDisplayBlock): string[] {
  switch (block.type) {
    case "heading":
      return [`<b>${escapeHtml(block.text)}</b>`];
    case "text":
      return [escapeHtml(block.text)];
    case "list":
      return block.items.map((item) => `- ${escapeHtml(item)}`);
    case "factList":
      return block.facts.map(
        (fact) => `<b>${escapeHtml(fact.label)}:</b> ${escapeHtml(fact.value)}`,
      );
    case "table":
      return [
        `<b>${block.columns.map(escapeHtml).join(" | ")}</b>`,
        ...block.rows.map((row) => row.map(escapeHtml).join(" | ")),
      ];
    case "timeline":
      return block.items.map((item) =>
        item.detail
          ? `<b>${escapeHtml(item.title)}</b> - ${escapeHtml(item.detail)}`
          : `<b>${escapeHtml(item.title)}</b>`,
      );
    case "alert":
      return [
        `<b>${escapeHtml((block.tone ?? "info").toUpperCase())}:</b> ${escapeHtml(block.text)}`,
      ];
    case "image":
      return [
        block.alt
          ? `<a href="${escapeHtml(block.url)}">${escapeHtml(block.alt)}</a>`
          : escapeHtml(block.url),
      ];
    case "actions":
      return [];
  }
  return assertNeverBlock(block);
}

function collectActions(doc: AgentDisplayDocument): AgentDisplayAction[] {
  return [
    ...(doc.actions ?? []),
    ...doc.blocks.flatMap((block) => (block.type === "actions" ? block.actions : [])),
  ];
}

export function renderTelegramPayload(doc: AgentDisplayDocument): TelegramDisplayPayload {
  const lines = [
    ...(doc.title ? [`<b>${escapeHtml(doc.title)}</b>`] : []),
    ...doc.blocks.flatMap((block) => {
      if (block.type === "heading" && block.text === doc.title) {
        return [];
      }
      return renderTelegramBlock(block);
    }),
  ].filter(Boolean);
  const actions = collectActions(doc);
  const buttons = actions.length
    ? [
        actions.map((action) => ({
          text: action.label,
          callback_data: action.value,
          ...(action.style && action.style !== "secondary" ? { style: action.style } : {}),
        })),
      ]
    : undefined;
  return {
    text: lines.join("\n"),
    ...(actions.length
      ? {
          interactive: {
            blocks: [
              {
                type: "buttons",
                buttons: actions,
              },
            ],
          },
          channelData: {
            telegram: {
              parseMode: "HTML",
              ...(buttons ? { buttons } : {}),
            },
          },
        }
      : {}),
  };
}

function a2uiTextComponent(id: string, text: string, usageHint: "h1" | "h2" | "body" = "body") {
  return {
    id,
    component: {
      Text: {
        text: { literalString: text },
        usageHint,
      },
    },
  };
}

type A2UITextItem = {
  text: string;
  usageHint: "h1" | "h2" | "body";
};

function renderBlockA2UIText(block: AgentDisplayBlock): string[] {
  switch (block.type) {
    case "heading":
      return [block.text];
    case "text":
      return [block.text];
    case "list":
      return block.items.map((item) => `- ${item}`);
    case "factList":
      return block.facts.map((fact) => `${fact.label}: ${fact.value}`);
    case "table":
      return [block.columns.join(" | "), ...block.rows.map((row) => row.join(" | "))];
    case "timeline":
      return block.items.map((item) =>
        item.detail ? `${item.title}: ${item.detail}` : item.title,
      );
    case "alert":
      return [`${(block.tone ?? "info").toUpperCase()}: ${block.text}`];
    case "image":
      return [block.alt ? `${block.alt}: ${block.url}` : block.url];
    case "actions":
      return block.actions.map((action) => `[${action.label}] ${action.value}`);
  }
  return assertNeverBlock(block);
}

function renderBlockA2UIItems(block: AgentDisplayBlock): A2UITextItem[] {
  const usageHint =
    block.type === "heading" ? (block.level === 1 ? ("h1" as const) : ("h2" as const)) : "body";
  return renderBlockA2UIText(block).map((text) => ({ text, usageHint }));
}

export function renderA2UIV08(doc: AgentDisplayDocument): string {
  const surfaceId = "main";
  const rootId = "root";
  const blockItems = doc.blocks.flatMap((block) =>
    doc.title && block.type === "heading" && block.text === doc.title
      ? []
      : renderBlockA2UIItems(block),
  );
  const textItems = doc.title
    ? [{ text: doc.title, usageHint: "h1" as const }, ...blockItems]
    : blockItems;
  const itemIds = textItems.map((_, index) => `display-text-${index}`);
  const components = [
    {
      id: rootId,
      component: { Column: { children: { explicitList: itemIds } } },
    },
    ...textItems.map((item, index) => a2uiTextComponent(itemIds[index], item.text, item.usageHint)),
  ];
  return [
    { surfaceUpdate: { surfaceId, components } },
    { beginRendering: { surfaceId, root: rootId } },
  ]
    .map((message) => JSON.stringify(message))
    .join("\n");
}

function escapeXml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function cardLines(doc: AgentDisplayDocument): string[] {
  return [
    ...(doc.title ? [doc.title] : []),
    ...doc.blocks.flatMap((block) => {
      switch (block.type) {
        case "heading":
          return block.text === doc.title ? [] : [block.text];
        case "table":
          return [block.columns.join("   "), ...block.rows.map((row) => row.join("   "))];
        default:
          return renderBlockA2UIText(block);
      }
    }),
  ].slice(0, 18);
}

export async function renderTelegramCard(doc: AgentDisplayDocument): Promise<TelegramDisplayCard> {
  const { default: sharp } = await import("sharp");
  const lines = cardLines(doc);
  const height = Math.max(320, 96 + lines.length * 34);
  const svg = `
<svg xmlns="http://www.w3.org/2000/svg" width="960" height="${height}" viewBox="0 0 960 ${height}">
  <rect width="960" height="${height}" fill="#f7f8fa"/>
  <rect x="32" y="32" width="896" height="${height - 64}" rx="18" fill="#ffffff" stroke="#d8dee8"/>
  ${lines
    .map((line, index) => {
      const isTitle = index === 0 && doc.title;
      return `<text x="64" y="${isTitle ? 92 : 120 + index * 34}" fill="${isTitle ? "#111827" : "#263244"}" font-family="Inter, Arial, sans-serif" font-size="${isTitle ? 34 : 22}" font-weight="${isTitle ? 700 : 500}">${escapeXml(line)}</text>`;
    })
    .join("\n  ")}
</svg>`;
  const buffer = await sharp(Buffer.from(svg)).png().toBuffer();
  return {
    buffer,
    mimeType: "image/png",
    fileName: "agent-display-card.png",
  };
}
