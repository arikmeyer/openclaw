#!/usr/bin/env node

import { loadActiveIntegration } from "../src/runtime-integrations.js";

function parseArgs(argv) {
  const options = {
    activeSymlink: undefined,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const value = argv[index + 1];

    if (arg === "--active-symlink") {
      options.activeSymlink = value;
      index += 1;
      continue;
    }

    throw new Error(`Unknown argument: ${arg}`);
  }

  if (!options.activeSymlink) {
    throw new Error("Expected --active-symlink <path>.");
  }

  return options;
}

try {
  const options = parseArgs(process.argv.slice(2));
  const activeIntegration = loadActiveIntegration({
    activeSymlink: options.activeSymlink,
  });

  console.log(JSON.stringify(activeIntegration, null, 2));
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
