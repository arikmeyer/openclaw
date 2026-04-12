import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { spawnSync } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

import {
  createInstallMetadata,
  loadActiveIntegration,
  resolveActiveRuntimeIntegrationSkillDirs,
  validateRuntimeCompatibility,
} from "./runtime-integrations.js";

const tempDirs: string[] = [];
const TEST_DIR = path.dirname(fileURLToPath(import.meta.url));
const VALIDATE_SCRIPT_PATH = path.resolve(
  TEST_DIR,
  "../scripts/validate-staged-integration.mjs",
);
const CURRENT_OPENCLAW_VERSION = JSON.parse(
  readFileSync(path.resolve(TEST_DIR, "../package.json"), "utf8"),
).version as string;

afterEach(() => {
  for (const tempDir of tempDirs.splice(0)) {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

function createTempDir(name: string) {
  const tempDir = mkdtempSync(path.join(os.tmpdir(), `${name}-`));
  tempDirs.push(tempDir);
  return tempDir;
}

function writeFiles(rootDir: string, files: Record<string, string>) {
  for (const [relativePath, content] of Object.entries(files)) {
    const absolutePath = path.join(rootDir, relativePath);
    mkdirSync(path.dirname(absolutePath), { recursive: true });
    writeFileSync(absolutePath, content);
  }
}

function createManifest(overrides: Partial<ReturnType<typeof createManifestDefaults>> = {}) {
  return {
    ...createManifestDefaults(),
    ...overrides,
  };
}

function createManifestDefaults() {
  return {
    pack_id: "tripplanner",
    display_name: "TripPlanner OpenClaw Integration",
    skills: [{ name: "tabiplanner", path: "skills/tabiplanner" }],
    templates: ["templates/day-overview.html"],
    required_contract_package: "@switchup/tripplanner-control-contract",
    required_contract_version_range: "^0.1.0",
    required_openclaw_version_range: CURRENT_OPENCLAW_VERSION,
    source_repo: "github.com/arikmeyer/TripPlanner",
    source_subpath: "integrations/openclaw/tripplanner",
  };
}

function createInstallJson(overrides: Partial<ReturnType<typeof createInstallJsonDefaults>> = {}) {
  return {
    ...createInstallJsonDefaults(),
    ...overrides,
  };
}

function createInstallJsonDefaults() {
  return {
    packId: "tripplanner",
    sourceRepo: "github.com/arikmeyer/TripPlanner",
    sourceSubpath: "integrations/openclaw/tripplanner",
    sourceRef: "tripplanner-sha",
    runtimeRef: "openclaw-sha",
    contracts: [
      {
        name: "@switchup/tripplanner-control-contract",
        version: "0.1.0",
      },
    ],
    openclawVersion: CURRENT_OPENCLAW_VERSION,
    installedAt: "2026-04-12T00:00:00.000Z",
  };
}

function writeActivePack(
  releaseDir: string,
  {
    extraFiles,
    includeInstallMetadata = true,
    manifestOverrides,
    installMetadataOverrides,
  }: {
    extraFiles?: Record<string, string>;
    includeInstallMetadata?: boolean;
    manifestOverrides?: Partial<ReturnType<typeof createManifestDefaults>>;
    installMetadataOverrides?: Partial<ReturnType<typeof createInstallJsonDefaults>>;
  } = {},
) {
  const files: Record<string, string> = {
    "README.md": "# TripPlanner pack\n",
    "openclaw-integration.json": `${JSON.stringify(createManifest(manifestOverrides), null, 2)}\n`,
    "skills/tabiplanner/SKILL.md": "# Skill\n",
    "templates/day-overview.html": "<div></div>\n",
    ...(extraFiles ?? {}),
  };

  if (includeInstallMetadata) {
    files["install.json"] = `${JSON.stringify(createInstallJson(installMetadataOverrides), null, 2)}\n`;
  }

  writeFiles(releaseDir, files);
}

function runValidateCli({
  packDir,
  openclawVersion = CURRENT_OPENCLAW_VERSION,
  contractVersion = "0.1.0",
}: {
  packDir: string;
  openclawVersion?: string;
  contractVersion?: string;
}) {
  const fixturesDir = createTempDir("openclaw-validator-fixtures");
  const openclawPackagePath = path.join(fixturesDir, "openclaw-package.json");
  const contractPackagePath = path.join(fixturesDir, "contract-package.json");

  writeFiles(fixturesDir, {
    "openclaw-package.json": `${JSON.stringify(
      {
        name: "openclaw",
        version: openclawVersion,
      },
      null,
      2,
    )}\n`,
    "contract-package.json": `${JSON.stringify(
      {
        name: "@switchup/tripplanner-control-contract",
        version: contractVersion,
      },
      null,
      2,
    )}\n`,
  });

  return spawnSync(
    "node",
    [
      VALIDATE_SCRIPT_PATH,
      "--pack",
      packDir,
      "--openclaw-package",
      openclawPackagePath,
      "--contract-package",
      contractPackagePath,
      "--source-ref",
      "tripplanner-sha",
      "--runtime-ref",
      "openclaw-sha",
    ],
    {
      encoding: "utf8",
      stdio: "pipe",
    },
  );
}

describe("runtime-integrations", () => {
  it("rejects OpenClaw versions outside a ^0.x compatibility range", () => {
    expect(() =>
      validateRuntimeCompatibility({
        manifest: createManifest({
          required_openclaw_version_range: "^0.1.0",
        }),
        openclawPackage: {
          name: "openclaw",
          version: "0.2.0",
        },
        contractPackage: {
          name: "@switchup/tripplanner-control-contract",
          version: "0.1.0",
        },
      }),
    ).toThrowError(/does not satisfy/);
  });

  it("builds generic install metadata without service-specific ref names", () => {
    const metadata = createInstallMetadata({
      manifest: createManifest(),
      sourceRef: "tripplanner-sha",
      runtimeRef: "openclaw-sha",
      openclawPackage: {
        name: "openclaw",
        version: CURRENT_OPENCLAW_VERSION,
      },
      contractPackage: {
        name: "@switchup/tripplanner-control-contract",
        version: "0.1.0",
      },
      installedAt: "2026-04-12T00:00:00.000Z",
    });

    expect(metadata).toEqual({
      packId: "tripplanner",
      sourceRepo: "github.com/arikmeyer/TripPlanner",
      sourceSubpath: "integrations/openclaw/tripplanner",
      sourceRef: "tripplanner-sha",
      runtimeRef: "openclaw-sha",
      contracts: [
        {
          name: "@switchup/tripplanner-control-contract",
          version: "0.1.0",
        },
      ],
      openclawVersion: CURRENT_OPENCLAW_VERSION,
      installedAt: "2026-04-12T00:00:00.000Z",
    });

    expect("tripplannerRef" in metadata).toBe(false);
    expect("openclawRef" in metadata).toBe(false);
  });

  it("loads an active staged integration and verifies its declared files", () => {
    const runtimeRoot = createTempDir("openclaw-runtime");
    const releaseDir = path.join(runtimeRoot, "tripplanner", "releases", "sha-1");
    const activeLink = path.join(runtimeRoot, "tripplanner", "current");

    writeActivePack(releaseDir);

    mkdirSync(path.dirname(activeLink), { recursive: true });
    symlinkSync(releaseDir, activeLink);

    const activeIntegration = loadActiveIntegration({
      activeSymlink: activeLink,
    });

    expect(activeIntegration.releaseDir).toBe(releaseDir);
    expect(activeIntegration.manifest.pack_id).toBe("tripplanner");
    expect(activeIntegration.installMetadata.sourceRef).toBe("tripplanner-sha");
  });

  it("discovers active runtime integration skill directories from staged releases", () => {
    const runtimeRoot = createTempDir("openclaw-runtime");
    const releaseDir = path.join(runtimeRoot, "tripplanner", "releases", "sha-1");
    const activeLink = path.join(runtimeRoot, "tripplanner", "current");

    writeActivePack(releaseDir);

    mkdirSync(path.dirname(activeLink), { recursive: true });
    symlinkSync(releaseDir, activeLink);

    const skillDirs = resolveActiveRuntimeIntegrationSkillDirs({
      rootDir: runtimeRoot,
    });

    expect(skillDirs).toEqual([
      {
        packId: "tripplanner",
        skillName: "tabiplanner",
        dir: path.join(releaseDir, "skills", "tabiplanner"),
        source: "openclaw-runtime-integration:tripplanner",
      },
    ]);
  });

  it("fails closed when the staged pack contains undeclared extra files", () => {
    const runtimeRoot = createTempDir("openclaw-runtime");
    const releaseDir = path.join(runtimeRoot, "tripplanner", "releases", "sha-1");
    const activeLink = path.join(runtimeRoot, "tripplanner", "current");

    writeActivePack(releaseDir, {
      extraFiles: {
        "notes.txt": "surprise\n",
      },
    });

    mkdirSync(path.dirname(activeLink), { recursive: true });
    symlinkSync(releaseDir, activeLink);

    expect(() =>
      loadActiveIntegration({
        activeSymlink: activeLink,
      }),
    ).toThrowError(/undeclared extra file/);
  });

  it("fails closed when the active symlink escapes the releases root", () => {
    const runtimeRoot = createTempDir("openclaw-runtime");
    const escapedReleaseDir = createTempDir("escaped-release");
    const activeLink = path.join(runtimeRoot, "tripplanner", "current");

    writeActivePack(escapedReleaseDir);

    mkdirSync(path.dirname(activeLink), { recursive: true });
    symlinkSync(escapedReleaseDir, activeLink);

    expect(() =>
      loadActiveIntegration({
        activeSymlink: activeLink,
      }),
    ).toThrowError(/outside configured releases root/);
  });

  it("fails closed when the active integration no longer satisfies the current OpenClaw version", () => {
    const runtimeRoot = createTempDir("openclaw-runtime");
    const releaseDir = path.join(runtimeRoot, "tripplanner", "releases", "sha-1");
    const activeLink = path.join(runtimeRoot, "tripplanner", "current");

    writeActivePack(releaseDir);

    mkdirSync(path.dirname(activeLink), { recursive: true });
    symlinkSync(releaseDir, activeLink);

    expect(() =>
      loadActiveIntegration({
        activeSymlink: activeLink,
        openclawVersion: "0.2.0",
      }),
    ).toThrowError(/does not satisfy/);
  });

  it("fails closed when install metadata is missing the required contract record", () => {
    const runtimeRoot = createTempDir("openclaw-runtime");
    const releaseDir = path.join(runtimeRoot, "tripplanner", "releases", "sha-1");
    const activeLink = path.join(runtimeRoot, "tripplanner", "current");

    writeActivePack(releaseDir, {
      installMetadataOverrides: {
        contracts: [
          {
            name: "@switchup/other-contract",
            version: "0.1.0",
          },
        ],
      },
    });

    mkdirSync(path.dirname(activeLink), { recursive: true });
    symlinkSync(releaseDir, activeLink);

    expect(() =>
      loadActiveIntegration({
        activeSymlink: activeLink,
      }),
    ).toThrowError(/missing required contract/);
  });

  it("validates staged packs through the real validator CLI", () => {
    const packDir = createTempDir("openclaw-validator-pack");
    writeActivePack(packDir, { includeInstallMetadata: false });

    const result = runValidateCli({ packDir });

    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({
      packId: "tripplanner",
      sourceRef: "tripplanner-sha",
      runtimeRef: "openclaw-sha",
      openclawVersion: CURRENT_OPENCLAW_VERSION,
    });
  });

  it("rejects incompatible OpenClaw versions through the real validator CLI", () => {
    const packDir = createTempDir("openclaw-validator-pack");
    writeActivePack(packDir, { includeInstallMetadata: false });

    const result = runValidateCli({
      packDir,
      openclawVersion: "2027.0.0",
    });

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("does not satisfy");
  });
});
