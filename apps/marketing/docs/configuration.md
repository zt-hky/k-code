K-code keeps internal names from T3 Code for compatibility, so environment variables use the `T3CODE_` prefix and data lives in `~/.t3`. Existing T3 Code installs keep working.

## Data directory

Everything the server stores (database, auth, settings, logs, runtime versions) lives under `~/.t3` by default. Set `T3CODE_HOME` to move it, or pass `--base-dir` to a command for an independent server.

## Ports and hosts

| What                            | Default                                            |
| ------------------------------- | -------------------------------------------------- |
| Server (`kcode`, `kcode serve`) | `127.0.0.1:3773`                                   |
| Development web (Vite)          | `5733`                                             |
| Development server              | `13773` (offsets to the next free pair when taken) |

Change them with `--port` and `--host`, or `T3CODE_PORT` and `T3CODE_HOST`. Bind to a private address, not `0.0.0.0` on the public internet.

## Environment variables

| Variable                                                                                                  | Purpose                                                             |
| --------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| `T3CODE_HOME`                                                                                             | Data directory (default `~/.t3`).                                   |
| `T3CODE_PORT`, `T3CODE_HOST`                                                                              | Server listen port and address.                                     |
| `T3CODE_NO_BROWSER`                                                                                       | Do not open a browser on start.                                     |
| `T3CODE_TAILSCALE_SERVE`, `T3CODE_TAILSCALE_SERVE_PORT`                                                   | Publish through Tailscale HTTPS.                                    |
| `T3CODE_CLOUDFLARE_ACCESS_TEAM_DOMAIN`, `T3CODE_CLOUDFLARE_ACCESS_AUD`, `T3CODE_CLOUDFLARE_ACCESS_EMAILS` | Cloudflare Access login ([details](/docs/features/remote-access/)). |
| `T3CODE_TELEMETRY_ENABLED`                                                                                | Set to `false` to disable product telemetry.                        |
| `T3CODE_OTLP_*`                                                                                           | OpenTelemetry export for traces, metrics and logs.                  |

Installer variables (see [Install](/docs/install/)): `KCODE_HOME` (default `~/.local/share/kcode`), `KCODE_INSTALL_DIR` (default `~/.local/bin`), `KCODE_VERSION`, `KCODE_DOWNLOAD_BASE`, `KCODE_DRY_RUN`.

Provider instances take their own variables (API keys, base URLs) in **Settings → Providers**; mark secrets as sensitive.

## Updating

`kcode update` moves a CLI install to the newest release. The desktop app updates from the sidebar button or **Settings → About**. See [Background service](/docs/features/background-service/) for always-on servers.
