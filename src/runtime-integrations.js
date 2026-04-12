import {
  existsSync,
  lstatSync,
  readFileSync,
  readlinkSync,
  readdirSync,
} from "node:fs";
import path from "node:path";

export const DEFAULT_RUNTIME_INTEGRATIONS_ROOT = "/var/lib/openclaw/integrations";

function isPathInside(root, target) {
  if (process.platform === "win32") {
    const resolvedRoot = path.win32.resolve(root).replaceAll("/", "\\").toLowerCase();
    const resolvedTarget = path.win32.resolve(target).replaceAll("/", "\\").toLowerCase();
    const relative = path.win32.relative(resolvedRoot, resolvedTarget);
    return relative === "" || (!relative.startsWith("..") && !path.win32.isAbsolute(relative));
  }

  const resolvedRoot = path.resolve(root);
  const resolvedTarget = path.resolve(target);
  const relative = path.relative(resolvedRoot, resolvedTarget);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function assertNonEmptyString(value, fieldName) {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`Expected ${fieldName} to be a non-empty string.`);
  }

  return value.trim();
}

function firstNonEmptyString(...values) {
  for (const value of values) {
    if (typeof value === "string" && value.trim().length > 0) {
      return value.trim();
    }
  }

  return null;
}

function assertStringArray(value, fieldName) {
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error(`Expected ${fieldName} to be a non-empty array.`);
  }

  return value.map((entry, index) =>
    assertNonEmptyString(entry, `${fieldName}[${index}]`),
  );
}

function assertSkills(value) {
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error("Expected skills to be a non-empty array.");
  }

  return value.map((skill, index) => {
    if (!skill || typeof skill !== "object" || Array.isArray(skill)) {
      throw new Error(`Expected skills[${index}] to be an object.`);
    }

    return {
      name: assertNonEmptyString(skill.name, `skills[${index}].name`),
      path: assertNonEmptyString(skill.path, `skills[${index}].path`),
    };
  });
}

function assertPackageJson(pkg, fieldName) {
  if (!pkg || typeof pkg !== "object" || Array.isArray(pkg)) {
    throw new Error(`Expected ${fieldName} to be an object.`);
  }

  return {
    name: assertNonEmptyString(pkg.name, `${fieldName}.name`),
    version: assertNonEmptyString(pkg.version, `${fieldName}.version`),
  };
}

function assertContractRecords(value, fieldName) {
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error(`Expected ${fieldName} to be a non-empty array.`);
  }

  return value.map((entry, index) =>
    assertPackageJson(entry, `${fieldName}[${index}]`),
  );
}

function assertInstallMetadata(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Expected install metadata to be an object.");
  }

  return {
    packId: assertNonEmptyString(value.packId, "installMetadata.packId"),
    sourceRepo: assertNonEmptyString(value.sourceRepo, "installMetadata.sourceRepo"),
    sourceSubpath: assertNonEmptyString(
      value.sourceSubpath,
      "installMetadata.sourceSubpath",
    ),
    sourceRef: assertNonEmptyString(value.sourceRef, "installMetadata.sourceRef"),
    runtimeRef: assertNonEmptyString(value.runtimeRef, "installMetadata.runtimeRef"),
    contracts: assertContractRecords(value.contracts, "installMetadata.contracts"),
    openclawVersion: assertNonEmptyString(
      value.openclawVersion,
      "installMetadata.openclawVersion",
    ),
    installedAt: assertNonEmptyString(value.installedAt, "installMetadata.installedAt"),
  };
}

export function readJsonFile(jsonPath) {
  return JSON.parse(readFileSync(jsonPath, "utf8"));
}

function readRuntimePackageVersion() {
  const runtimePackage = readJsonFile(new URL("../package.json", import.meta.url));
  return assertNonEmptyString(runtimePackage.version, "openclaw package version");
}

function resolveRuntimeIntegrationHostVersion(env = process.env) {
  return (
    firstNonEmptyString(
      env.OPENCLAW_COMPATIBILITY_HOST_VERSION,
      env.OPENCLAW_SERVICE_VERSION,
      env.OPENCLAW_VERSION,
      env.npm_package_version,
    ) ?? readRuntimePackageVersion()
  );
}

function walkFiles(rootDir, relativeDir = "") {
  const currentDir = path.join(rootDir, relativeDir);

  return readdirSync(currentDir, { withFileTypes: true })
    .flatMap((entry) => {
      const nextRelativePath = path.join(relativeDir, entry.name);

      if (entry.isDirectory()) {
        return walkFiles(rootDir, nextRelativePath);
      }

      return [nextRelativePath.split(path.sep).join("/")];
    })
    .sort((left, right) => left.localeCompare(right));
}

export function assertRuntimeIntegrationManifest(manifest) {
  if (!manifest || typeof manifest !== "object" || Array.isArray(manifest)) {
    throw new Error("Expected manifest to be an object.");
  }

  return {
    pack_id: assertNonEmptyString(manifest.pack_id, "manifest.pack_id"),
    display_name: assertNonEmptyString(
      manifest.display_name,
      "manifest.display_name",
    ),
    skills: assertSkills(manifest.skills),
    templates: assertStringArray(manifest.templates, "manifest.templates"),
    required_contract_package: assertNonEmptyString(
      manifest.required_contract_package,
      "manifest.required_contract_package",
    ),
    required_contract_version_range: assertNonEmptyString(
      manifest.required_contract_version_range,
      "manifest.required_contract_version_range",
    ),
    required_openclaw_version_range: assertNonEmptyString(
      manifest.required_openclaw_version_range,
      "manifest.required_openclaw_version_range",
    ),
    source_repo: assertNonEmptyString(manifest.source_repo, "manifest.source_repo"),
    source_subpath: assertNonEmptyString(
      manifest.source_subpath,
      "manifest.source_subpath",
    ),
  };
}

function parseRange(range) {
  if (range === "workspace:*" || range === "*") {
    return { mode: "any" };
  }

  if (range.startsWith("^")) {
    return { mode: "caret", version: range.slice(1) };
  }

  if (range.startsWith("~")) {
    return { mode: "tilde", version: range.slice(1) };
  }

  return { mode: "exact", version: range };
}

function parseVersion(version) {
  const match = version.trim().match(/^(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$/);

  if (!match) {
    throw new Error(`Unsupported version: ${version}`);
  }

  return {
    major: Number.parseInt(match[1], 10),
    minor: Number.parseInt(match[2], 10),
    patch: Number.parseInt(match[3], 10),
  };
}

function compareVersions(left, right) {
  if (left.major !== right.major) {
    return Math.sign(left.major - right.major);
  }

  if (left.minor !== right.minor) {
    return Math.sign(left.minor - right.minor);
  }

  return Math.sign(left.patch - right.patch);
}

function getCaretUpperBound(version) {
  if (version.major > 0) {
    return { major: version.major + 1, minor: 0, patch: 0 };
  }

  if (version.minor > 0) {
    return { major: 0, minor: version.minor + 1, patch: 0 };
  }

  return { major: 0, minor: 0, patch: version.patch + 1 };
}

function getTildeUpperBound(version) {
  return {
    major: version.major,
    minor: version.minor + 1,
    patch: 0,
  };
}

export function satisfiesRange(version, range) {
  const parsedRange = parseRange(range);

  if (parsedRange.mode === "any") {
    return true;
  }

  const currentVersion = parseVersion(version);
  const targetVersion = parseVersion(parsedRange.version);

  if (parsedRange.mode === "caret") {
    return (
      compareVersions(currentVersion, targetVersion) >= 0 &&
      compareVersions(currentVersion, getCaretUpperBound(targetVersion)) < 0
    );
  }

  if (parsedRange.mode === "tilde") {
    return (
      compareVersions(currentVersion, targetVersion) >= 0 &&
      compareVersions(currentVersion, getTildeUpperBound(targetVersion)) < 0
    );
  }

  return compareVersions(currentVersion, targetVersion) === 0;
}

export function validateRuntimeCompatibility({
  manifest,
  openclawPackage,
  contractPackage,
}) {
  const validatedManifest = assertRuntimeIntegrationManifest(manifest);
  const validatedOpenClawPackage = assertPackageJson(
    openclawPackage,
    "openclawPackage",
  );
  const validatedContractPackage = assertPackageJson(
    contractPackage,
    "contractPackage",
  );

  if (
    validatedManifest.required_contract_package !== validatedContractPackage.name
  ) {
    throw new Error(
      `Integration requires ${validatedManifest.required_contract_package}, but the service contract package is ${validatedContractPackage.name}.`,
    );
  }

  if (
    !satisfiesRange(
      validatedOpenClawPackage.version,
      validatedManifest.required_openclaw_version_range,
    )
  ) {
    throw new Error(
      `OpenClaw ${validatedOpenClawPackage.version} does not satisfy ${validatedManifest.required_openclaw_version_range}.`,
    );
  }

  if (
    !satisfiesRange(
      validatedContractPackage.version,
      validatedManifest.required_contract_version_range,
    )
  ) {
    throw new Error(
      `Contract ${validatedContractPackage.version} does not satisfy ${validatedManifest.required_contract_version_range}.`,
    );
  }

  return {
    manifest: validatedManifest,
    openclawPackage: validatedOpenClawPackage,
    contractPackage: validatedContractPackage,
  };
}

export function createInstallMetadata({
  manifest,
  openclawPackage,
  contractPackage,
  sourceRef,
  runtimeRef,
  installedAt = new Date().toISOString(),
}) {
  const validated = validateRuntimeCompatibility({
    manifest,
    openclawPackage,
    contractPackage,
  });

  return {
    packId: validated.manifest.pack_id,
    sourceRepo: validated.manifest.source_repo,
    sourceSubpath: validated.manifest.source_subpath,
    sourceRef: assertNonEmptyString(sourceRef, "sourceRef"),
    runtimeRef: assertNonEmptyString(runtimeRef, "runtimeRef"),
    contracts: [
      {
        name: validated.contractPackage.name,
        version: validated.contractPackage.version,
      },
    ],
    openclawVersion: validated.openclawPackage.version,
    installedAt: assertNonEmptyString(installedAt, "installedAt"),
  };
}

function readActiveReleaseDir(activeSymlink) {
  if (!existsSync(activeSymlink)) {
    throw new Error(`Missing active integration symlink: ${activeSymlink}`);
  }

  if (!lstatSync(activeSymlink).isSymbolicLink()) {
    throw new Error(`Expected active integration path to be a symlink: ${activeSymlink}`);
  }

  const target = readlinkSync(activeSymlink);
  const releaseDir = path.isAbsolute(target)
    ? target
    : path.resolve(path.dirname(activeSymlink), target);
  const integrationDir = path.resolve(path.dirname(activeSymlink));
  const releasesDir = path.join(integrationDir, "releases");
  const relativeReleasePath = path.relative(releasesDir, releaseDir);

  if (!isPathInside(releasesDir, releaseDir)) {
    throw new Error(
      `Active integration target ${releaseDir} resolves outside configured releases root ${releasesDir}.`,
    );
  }

  if (
    relativeReleasePath === "" ||
    relativeReleasePath === "." ||
    relativeReleasePath.split(path.sep).length !== 1
  ) {
    throw new Error(
      `Active integration target ${releaseDir} must resolve to a direct child of ${releasesDir}.`,
    );
  }

  if (!existsSync(releaseDir) || !lstatSync(releaseDir).isDirectory()) {
    throw new Error(`Expected active integration release to be a directory: ${releaseDir}`);
  }

  return releaseDir;
}

function validateLoadedIntegrationCompatibility({
  manifest,
  installMetadata,
  openclawVersion = resolveRuntimeIntegrationHostVersion(process.env),
}) {
  const runtimeVersion = assertNonEmptyString(openclawVersion, "openclawVersion");
  const requiredContract = installMetadata.contracts.find(
    (entry) => entry.name === manifest.required_contract_package,
  );

  if (!satisfiesRange(runtimeVersion, manifest.required_openclaw_version_range)) {
    throw new Error(
      `OpenClaw ${runtimeVersion} does not satisfy ${manifest.required_openclaw_version_range}.`,
    );
  }

  if (!requiredContract) {
    throw new Error(
      `Install metadata is missing required contract ${manifest.required_contract_package}.`,
    );
  }

  if (
    !satisfiesRange(requiredContract.version, manifest.required_contract_version_range)
  ) {
    throw new Error(
      `Active integration contract ${requiredContract.version} does not satisfy ${manifest.required_contract_version_range}.`,
    );
  }
}

function validateLoadedIntegration({
  manifest,
  installMetadata,
  openclawVersion,
}) {
  if (installMetadata.packId !== manifest.pack_id) {
    throw new Error(
      `Install metadata packId ${installMetadata.packId} does not match manifest pack_id ${manifest.pack_id}.`,
    );
  }

  if (installMetadata.sourceRepo !== manifest.source_repo) {
    throw new Error(
      `Install metadata sourceRepo ${installMetadata.sourceRepo} does not match manifest source_repo ${manifest.source_repo}.`,
    );
  }

  if (installMetadata.sourceSubpath !== manifest.source_subpath) {
    throw new Error(
      `Install metadata sourceSubpath ${installMetadata.sourceSubpath} does not match manifest source_subpath ${manifest.source_subpath}.`,
    );
  }

  validateLoadedIntegrationCompatibility({
    manifest,
    installMetadata,
    openclawVersion,
  });
}

function collectDeclaredPackFiles(
  releaseDir,
  manifest,
  { requireInstallMetadata = true } = {},
) {
  const declaredFiles = new Set(["README.md", "openclaw-integration.json"]);

  if (requireInstallMetadata) {
    declaredFiles.add("install.json");
  }

  for (const skill of manifest.skills) {
    const skillDir = path.join(releaseDir, skill.path);

    if (!existsSync(skillDir) || !lstatSync(skillDir).isDirectory()) {
      throw new Error(`Missing skill directory in staged pack: ${skill.path}`);
    }

    for (const relativeFilePath of walkFiles(skillDir)) {
      declaredFiles.add(
        path.join(skill.path, relativeFilePath).split(path.sep).join("/"),
      );
    }
  }

  for (const templatePath of manifest.templates) {
    declaredFiles.add(templatePath);
  }

  return [...declaredFiles].sort((left, right) => left.localeCompare(right));
}

export function verifyStagedPackFiles({
  releaseDir,
  manifest,
  requireInstallMetadata = true,
}) {
  const declaredFiles = new Set(
    collectDeclaredPackFiles(releaseDir, manifest, { requireInstallMetadata }),
  );
  const actualFiles = new Set(walkFiles(releaseDir));

  for (const declaredFile of declaredFiles) {
    if (!actualFiles.has(declaredFile)) {
      throw new Error(`Staged pack is missing declared file: ${declaredFile}`);
    }
  }

  for (const actualFile of actualFiles) {
    if (!declaredFiles.has(actualFile)) {
      throw new Error(`Staged pack contains undeclared extra file: ${actualFile}`);
    }
  }

  return [...declaredFiles];
}

function listRuntimeIntegrationEntries(rootDir) {
  if (!existsSync(rootDir)) {
    return [];
  }

  return readdirSync(rootDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() || entry.isSymbolicLink())
    .map((entry) => entry.name)
    .sort((left, right) => left.localeCompare(right));
}

export function resolveActiveRuntimeIntegrationSkillDirs({
  rootDir = DEFAULT_RUNTIME_INTEGRATIONS_ROOT,
} = {}) {
  const skillDirs = [];

  for (const integrationName of listRuntimeIntegrationEntries(rootDir)) {
    const activeSymlink = path.join(rootDir, integrationName, "current");

    if (!existsSync(activeSymlink)) {
      continue;
    }

    const activeIntegration = loadActiveIntegration({ activeSymlink });

    for (const skill of activeIntegration.manifest.skills) {
      skillDirs.push({
        packId: activeIntegration.manifest.pack_id,
        skillName: skill.name,
        dir: path.join(activeIntegration.releaseDir, skill.path),
        source: `openclaw-runtime-integration:${activeIntegration.manifest.pack_id}`,
      });
    }
  }

  return skillDirs.sort(
    (left, right) =>
      left.packId.localeCompare(right.packId) || left.skillName.localeCompare(right.skillName),
  );
}

export function loadActiveIntegration({ activeSymlink, openclawVersion } = {}) {
  const releaseDir = readActiveReleaseDir(activeSymlink);
  const manifest = assertRuntimeIntegrationManifest(
    readJsonFile(path.join(releaseDir, "openclaw-integration.json")),
  );
  const installMetadata = assertInstallMetadata(
    readJsonFile(path.join(releaseDir, "install.json")),
  );
  const files = verifyStagedPackFiles({ releaseDir, manifest });
  validateLoadedIntegration({
    manifest,
    installMetadata,
    openclawVersion,
  });

  return {
    releaseDir,
    manifest,
    installMetadata,
    files,
  };
}
