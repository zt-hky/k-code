# Release Checklist

> For maintainers. Using K-code? See [docs/user](../user/).

K-code ships from `.github/workflows/release.yml` in `zt-hky/k-code`. It needs no secrets beyond the
automatic `GITHUB_TOKEN`; builds are unsigned.

## Cut a release

1. Make sure `main` is what you want to ship and CI is green.
2. Tag and push: `git tag v0.1.0 && git push fork v0.1.0` (any `v*` tag; a suffix such as `-rc.1` makes it a
   GitHub prerelease, everything else is marked latest).
3. The workflow builds every target, then publishes the GitHub Release with generated notes.

To rehearse without publishing, run **Actions > Release > Run workflow** with a `version` and `dry_run`
checked (the default). Everything builds and the finished assets land in the `release-assets` workflow
artifact; no release or tag is created. With `dry_run` unchecked the workflow publishes `v<version>`
for the selected commit.

## What the workflow does

- `meta` resolves the version from the tag (or the dispatch input) and validates it as semver.
- `bundle` builds the platform-independent JS once (server bundle, web client, Electron main) after stamping
  package versions with `scripts/update-release-package-versions.ts`.
- `build` runs once per platform on hardware of its own architecture: Linux x64, Linux arm64, macOS arm64,
  macOS x64, Windows x64. Each leg builds the Rust resource monitor, the server single-executable
  (`apps/server/scripts/cli.ts build-exe`), packs it with `scripts/build-cli-archive.ts`, and smoke-tests the
  archive (`scripts/smoke-cli-archive.ts`). Linux x64, macOS arm64 and macOS x64 also package the desktop app.
- `desktop_windows` packages the NSIS installer, embedding the Linux x64 server archive as the WSL runtime.
- `assemble` renames everything to the stable names below, rewrites the electron-updater manifests
  (`latest*.yml`) to those names, merges the two macOS manifests, writes `SHA256SUMS.txt`, checks that every
  contracted asset exists, uploads the `release-assets` artifact, and (unless `dry_run`) publishes the release.
  It reads the server archive and checksum names from `CLI_RELEASE_ARCHIVES` in
  `packages/shared/src/cliRelease.ts`, the same table SSH environments, `t3 update`, and service installs
  download from. Rename an asset there, never only in the workflow.

## Release assets

Stable names keep `https://github.com/zt-hky/k-code/releases/latest/download/<name>` working.

| Asset                                                                                               | Contents                                                                                  |
| --------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| `K-code-linux-x86_64.AppImage`, `K-code-linux-amd64.deb`                                            | Linux desktop                                                                             |
| `K-code-windows-x64-setup.exe`                                                                      | Windows desktop (NSIS)                                                                    |
| `K-code-macos-arm64.dmg`, `K-code-macos-x64.dmg`                                                    | macOS desktop (unsigned)                                                                  |
| `kcode-server-{linux-x64,linux-arm64,macos-arm64,macos-x64}.tar.gz`, `kcode-server-windows-x64.zip` | Standalone server (Node single-executable `t3` plus a `kcode` entry point); needs no Node |
| `SHA256SUMS.txt`                                                                                    | SHA-256 of every installer and server archive; checked by the install scripts             |
| `latest*.yml`, `*.blockmap`, macOS `*.zip`                                                          | electron-updater feed (the app updates from this repository)                              |

## Install scripts

`apps/marketing/public/install.sh` and `install.ps1` are served at `https://kcode.agentbox.io.vn/install.sh`
and `/install.ps1`. They download from `releases/latest/download`, verify `SHA256SUMS.txt`, and are idempotent.
`KCODE_DOWNLOAD_BASE` points them at a local directory for testing, and `--dry-run` / `-DryRun` verifies
without installing.

## Release notes

Notes live in `docs/releases/<version>.md`, one file per release, written for users: a short intro, then
`## Highlights` (required), `## New (from T3 Code)`, `## K-code features`, `## Fixes` and
`## Breaking or migration notes` as needed. Write the file before tagging. The `notes` job fails in
seconds if it is missing, then `scripts/compose-release-notes.mjs` appends the downloads table, the
one-line installer and the compare link, and `assemble` publishes that as the release body (a
re-run replaces it). Nothing is generated from commit titles. To fix notes later, edit the file and run
`gh release edit vX.Y.Z --notes-file <(node scripts/compose-release-notes.mjs X.Y.Z --previous vA.B.C)`.

## Site

`https://kcode.agentbox.io.vn/docs/changelog/` is built from the GitHub Releases of this repository
(`apps/marketing/scripts/github-changelog.mjs`), one entry per published release with its version, date
and link. If the API is rate limited the build falls back to `docs/releases/`. The home page also reads
the latest release when it loads, so its version and download links never go stale.

The site is static files served by the AgentBox gateway on the same host as `t3code.service`, so it is
published with `scripts/deploy-site.sh` (needs sudo), not from GitHub Actions. `scripts/sync-site.sh`
runs it when the releases change; a user timer calls that every five minutes:

```ini
# ~/.config/systemd/user/kcode-site-sync.service
[Service]
Type=oneshot
WorkingDirectory=%h/personal/t3code
Environment=PATH=%h/.local/opt/node26/bin:%h/.local/bin:/usr/local/bin:/usr/bin:/bin
ExecStart=%h/personal/t3code/scripts/sync-site.sh

# ~/.config/systemd/user/kcode-site-sync.timer
[Timer]
OnBootSec=2min
OnUnitActiveSec=5min
[Install]
WantedBy=timers.target
```

Enable with `systemctl --user enable --now kcode-site-sync.timer`; `journalctl --user -u kcode-site-sync`
shows each run. Run `scripts/sync-site.sh --force` to republish without waiting.

## Auto-update

`T3CODE_DESKTOP_UPDATE_REPOSITORY=zt-hky/k-code` is set in the workflow, so electron-builder writes a GitHub
publish provider for this repository into the packaged app.

## Signing

Not configured. macOS builds run only after clearing Gatekeeper's quarantine flag (the install script does
this); Windows shows a SmartScreen prompt. Adding signing means wiring `CSC_LINK`/`CSC_KEY_PASSWORD`,
`APPLE_API_*` (macOS) or Azure Trusted Signing variables (Windows) into the desktop build steps, which
`scripts/build-desktop-artifact.ts` already supports via `--signed`.

## Pull request CI

`.github/workflows/ci.yml` runs lint, typecheck, build, tests and the release smoke on `ubuntu-24.04` runners.
