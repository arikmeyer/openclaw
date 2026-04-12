# Runtime integrations

## Directory contract

Service-owned integrations are staged into runtime-owned directories:

- staged root: `/var/lib/openclaw/integrations/<pack>`
- immutable release dir: `/var/lib/openclaw/integrations/<pack>/releases/<ref>`
- active symlink: `/var/lib/openclaw/integrations/<pack>/current`
- install metadata: `/var/lib/openclaw/integrations/<pack>/current/install.json`

OpenClaw loads only from the active `current` symlink target.
That target must resolve to a direct child of `/var/lib/openclaw/integrations/<pack>/releases`.
If `current` points outside the release tree, or into a nested subdirectory under a release, the
loader fails closed.

## Loader expectations

- each pack must include its manifest and declared files only
- malformed or incompatible packs fail closed
- the runtime must not silently fall back to older undeclared files
- runtime integrations are staged/generated state, not a manual editing surface

## Compatibility checks

Before activation, the runtime or orchestration layer must verify:

- required OpenClaw version range
- required control-contract package range for the target service
- manifest structure and required files

When loading an already-active pack, OpenClaw re-checks the same compatibility contract against the
current runtime version and the staged `install.json` contract records. A pack that was valid when
staged but becomes incompatible after a runtime upgrade must fail closed in the loader path.

For local use, the repo exposes:

```bash
pnpm validate:staged-integration -- --pack <dir> --openclaw-package <package.json> --contract-package <package.json> --source-ref <ref> --runtime-ref <ref>
```

Automation may also invoke the underlying Node entrypoint directly:

```bash
node scripts/validate-staged-integration.mjs --pack <dir> --openclaw-package <package.json> --contract-package <package.json> --source-ref <ref> --runtime-ref <ref>
```

That validates the staged pack and prints the runtime-owned install metadata JSON.

Inspect the currently active staged pack with:

```bash
pnpm describe:active-integration -- --active-symlink /var/lib/openclaw/integrations/<pack>/current
```

Or invoke the Node entrypoint directly:

```bash
node scripts/describe-active-integration.mjs --active-symlink /var/lib/openclaw/integrations/<pack>/current
```

That resolves the active symlink, verifies the release-tree contract, re-checks active
compatibility, and prints the manifest plus install metadata.

## Install metadata contract

`install.json` is OpenClaw-owned runtime metadata. It must contain:

- `packId`
- `sourceRepo`
- `sourceSubpath`
- `sourceRef`
- `runtimeRef`
- `contracts`
- `openclawVersion`
- `installedAt`

It must not use service-specific field names such as `tripplannerRef`.

## Invalid pack behavior

- failed validation must not switch the active symlink
- failed smoke checks after activation must restore the previous active release
- failed releases may remain on disk for inspection but must not stay active
