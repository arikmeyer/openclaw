#!/usr/bin/env node

import path from "node:path";

import {
  createInstallMetadata,
  readJsonFile,
  verifyStagedPackFiles,
} from "../src/runtime-integrations.js";

function parseArgs(argv) {
  const options = {
    packDir: undefined,
    openclawPackagePath: undefined,
    contractPackagePath: undefined,
    sourceRef: undefined,
    runtimeRef: undefined,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const value = argv[index + 1];

    if (arg === "--pack") {
      options.packDir = value;
      index += 1;
      continue;
    }

    if (arg === "--openclaw-package") {
      options.openclawPackagePath = value;
      index += 1;
      continue;
    }

    if (arg === "--contract-package") {
      options.contractPackagePath = value;
      index += 1;
      continue;
    }

    if (arg === "--source-ref") {
      options.sourceRef = value;
      index += 1;
      continue;
    }

    if (arg === "--runtime-ref") {
      options.runtimeRef = value;
      index += 1;
      continue;
    }

    throw new Error(`Unknown argument: ${arg}`);
  }

  if (
    !options.packDir ||
    !options.openclawPackagePath ||
    !options.contractPackagePath ||
    !options.sourceRef ||
    !options.runtimeRef
  ) {
    throw new Error(
      "Expected --pack, --openclaw-package, --contract-package, --source-ref, and --runtime-ref.",
    );
  }

  return options;
}

try {
  const options = parseArgs(process.argv.slice(2));
  const manifest = readJsonFile(
    path.join(options.packDir, "openclaw-integration.json"),
  );
  verifyStagedPackFiles({
    releaseDir: options.packDir,
    manifest,
    requireInstallMetadata: false,
  });
  const openclawPackage = readJsonFile(options.openclawPackagePath);
  const contractPackage = readJsonFile(options.contractPackagePath);

  const installMetadata = createInstallMetadata({
    manifest,
    openclawPackage,
    contractPackage,
    sourceRef: options.sourceRef,
    runtimeRef: options.runtimeRef,
  });

  console.log(JSON.stringify(installMetadata, null, 2));
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
