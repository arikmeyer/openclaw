---
summary: "Render source-neutral rich display payloads for Canvas and Telegram"
read_when:
  - Testing rich display rendering
  - Validating Canvas A2UI or Telegram display payloads
title: "display"
---

# `openclaw display`

`openclaw display` renders OpenClaw's source-neutral rich display contract without requiring a
TabiPlanner integration or another producer-specific runtime.

The display contract lives in OpenClaw runtime code. Producers can provide markdown, plain text,
structured JSON, or an `AgentDisplayDocument`; renderers then target the active surface.

## Block selection

Agents see the block vocabulary in the native `display` tool schema and description. Use blocks by
presentation intent:

| Block      | Use for                                                                 |
| ---------- | ----------------------------------------------------------------------- |
| `heading`  | Section titles                                                          |
| `text`     | Short paragraphs                                                        |
| `list`     | Simple bullet lists                                                     |
| `factList` | Status, config, host checks, and other label/value summaries            |
| `table`    | Comparisons or structured rows                                          |
| `timeline` | Ordered events, itinerary steps, rollout history, or progress sequences |
| `alert`    | Warnings, blockers, success/failure callouts, or important state        |
| `image`    | Image URL plus optional alt text                                        |
| `actions`  | User choices, approvals, acknowledgements, or next steps                |

## Smoke tests

```bash
openclaw display smoke --target telegram
openclaw display smoke --target telegram --json
openclaw display smoke --target a2ui
openclaw display smoke --target card --json
```

Targets:

- `telegram`: renders Telegram-native HTML text plus inline-button metadata.
- `a2ui` / `canvas`: renders Canvas A2UI v0.8 JSONL.
- `card`: renders a PNG card with the existing `sharp` dependency, without adding a browser
  runtime.

The smoke command does not send anything to Telegram or Canvas. It is intended for local build
checks, package-managed runtime validation, and host rollout verification.

## Agent tool

Agents can use the `display` tool with:

- `target="canvas"` to push A2UI v0.8 JSONL through the existing Canvas gateway adapter.
- `target="telegram"` to send Telegram-native HTML/buttons through the existing message adapter.
- `target="preview"` to inspect both render outputs without sending.

Telegram card mode is opt-in with `card=true`; it creates a PNG attachment and sends the same
semantic document through the normal Telegram outbound path.

Use plain messages for normal conversation. Use `display` when structure helps the recipient scan,
compare, decide, or preserve context across Canvas and Telegram.
