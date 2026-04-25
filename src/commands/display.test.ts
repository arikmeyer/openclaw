import { describe, expect, it, vi } from "vitest";
import type { RuntimeEnv } from "../runtime.js";
import { displaySmokeCommand } from "./display.js";

function createRuntime(): RuntimeEnv {
  return {
    log: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    exit: vi.fn(),
  } as unknown as RuntimeEnv;
}

describe("display smoke command", () => {
  it("prints A2UI v0.8 JSONL smoke output", async () => {
    const runtime = createRuntime();

    await displaySmokeCommand({ target: "a2ui" }, runtime);

    expect(runtime.log).toHaveBeenCalledWith(expect.stringContaining('"surfaceUpdate"'));
    expect(runtime.log).toHaveBeenCalledWith(expect.not.stringContaining("createSurface"));
  });

  it("prints Telegram payload smoke output as JSON", async () => {
    const runtime = createRuntime();

    await displaySmokeCommand({ target: "telegram", json: true }, runtime);

    const payload = JSON.parse(String(vi.mocked(runtime.log).mock.calls[0]?.[0])) as {
      target: string;
      telegram: { text: string };
    };
    expect(payload.target).toBe("telegram");
    expect(payload.telegram.text).toContain("<b>OpenClaw display smoke</b>");
  });

  it("prints PNG card smoke metadata", async () => {
    const runtime = createRuntime();

    await displaySmokeCommand({ target: "card", json: true }, runtime);

    const payload = JSON.parse(String(vi.mocked(runtime.log).mock.calls[0]?.[0])) as {
      target: string;
      card: { mimeType: string; byteLength: number };
    };
    expect(payload.target).toBe("card");
    expect(payload.card.mimeType).toBe("image/png");
    expect(payload.card.byteLength).toBeGreaterThan(8);
  });
});
