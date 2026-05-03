export const DEFAULT_RUNTIME_INTEGRATIONS_ROOT: string;

export type RuntimeIntegrationManifest = {
  pack_id: string;
  display_name: string;
  skills: Array<{
    name: string;
    path: string;
  }>;
  templates: string[];
  required_contract_package: string;
  required_contract_version_range: string;
  required_openclaw_version_range: string;
  source_repo: string;
  source_subpath: string;
};

export type RuntimeIntegrationPackage = {
  name: string;
  version: string;
};

export type RuntimeIntegrationInstallMetadata = {
  packId: string;
  sourceRepo: string;
  sourceSubpath: string;
  sourceRef: string;
  runtimeRef: string;
  contracts: RuntimeIntegrationPackage[];
  openclawVersion: string;
  installedAt: string;
};

export type RuntimeIntegrationSkillDir = {
  packId: string;
  skillName: string;
  dir: string;
  source: string;
};

export type LoadedRuntimeIntegration = {
  releaseDir: string;
  manifest: RuntimeIntegrationManifest;
  installMetadata: RuntimeIntegrationInstallMetadata;
  files: string[];
};

export function readJsonFile(jsonPath: string | URL): unknown;
export function assertRuntimeIntegrationManifest(manifest: unknown): RuntimeIntegrationManifest;
export function satisfiesRange(version: string, range: string): boolean;
export function validateRuntimeCompatibility(params: {
  manifest: unknown;
  openclawPackage: unknown;
  contractPackage: unknown;
}): {
  manifest: RuntimeIntegrationManifest;
  openclawPackage: RuntimeIntegrationPackage;
  contractPackage: RuntimeIntegrationPackage;
};
export function createInstallMetadata(params: {
  manifest: unknown;
  openclawPackage: unknown;
  contractPackage: unknown;
  sourceRef: string;
  runtimeRef: string;
  installedAt?: string;
}): RuntimeIntegrationInstallMetadata;
export function verifyStagedPackFiles(params: {
  releaseDir: string;
  manifest: RuntimeIntegrationManifest;
  requireInstallMetadata?: boolean;
}): string[];
export function resolveActiveRuntimeIntegrationSkillDirs(params?: {
  rootDir?: string;
}): RuntimeIntegrationSkillDir[];
export function loadActiveIntegration(params?: {
  activeSymlink?: string;
  openclawVersion?: string;
}): LoadedRuntimeIntegration;
