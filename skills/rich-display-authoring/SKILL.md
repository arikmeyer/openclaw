---
name: rich-display-authoring
description: Use OpenClaw's native display tool when an answer should become a structured Canvas or Telegram rich display, including status summaries, comparisons, timelines, alerts, cards, or inline choices.
---

# Rich Display Authoring

Use the native `display` tool when structure helps the recipient scan, compare, decide, or preserve
context. Use normal conversational text for simple replies.

## Choose Blocks

- `heading`: section titles.
- `text`: short paragraphs.
- `list`: simple bullets.
- `factList`: status, config, host checks, or label/value summaries.
- `table`: comparisons or structured rows.
- `timeline`: ordered events, itinerary steps, rollout history, or progress sequences.
- `alert`: warnings, blockers, success/failure callouts, or important state.
- `image`: image URL plus optional alt text.
- `actions`: user choices, approvals, acknowledgements, or next steps.

## Choose Targets

- `target="preview"`: inspect Canvas and Telegram output without sending.
- `target="canvas"`: push A2UI v0.8 JSONL to Canvas.
- `target="telegram"`: send Telegram-native HTML and inline buttons.
- `target="telegram", card=true`: attach a PNG card when layout density or visual hierarchy
  matters more than editable text.

Keep the display source-neutral. Do not create producer-specific display contracts for TabiPlanner
or any other content source.
