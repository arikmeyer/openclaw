import type { Command } from "commander";
import { displaySmokeCommand } from "../../commands/display.js";
import { defaultRuntime } from "../../runtime.js";
import { runCommandWithRuntime } from "../cli-utils.js";
import type { ProgramContext } from "./context.js";

export function registerDisplayCommands(program: Command, _ctx?: ProgramContext) {
  const display = program
    .command("display")
    .description("Render source-neutral rich display payloads")
    .action(() => {
      display.help({ error: true });
    });

  display
    .command("smoke")
    .description("Render a local display smoke payload without sending it")
    .option("--target <target>", "Smoke target: telegram, a2ui, canvas, or card", "telegram")
    .option("--json", "Print machine-readable JSON")
    .action(async (opts) => {
      await runCommandWithRuntime(defaultRuntime, async () => {
        await displaySmokeCommand(opts, defaultRuntime);
      });
    });
}
