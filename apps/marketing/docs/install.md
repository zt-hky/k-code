K-code runs coding agents on a computer and lets you control them from a desktop, web or mobile client. Install it on the machine where the agents will work.

## Requirements

- An agent CLI you want to use, installed and signed in (see [Providers](/docs/providers/overview/)). You can launch K-code first and configure providers afterwards.
- For the headless server on a platform without a standalone binary, Node.js 24.

## Desktop app

Download from the [downloads section](/#downloads) or the [GitHub releases page](https://github.com/zt-hky/k-code/releases). Every file is also available at a stable URL: `https://github.com/zt-hky/k-code/releases/latest/download/<file>`.

| Platform               | File                           | Notes                                                 |
| ---------------------- | ------------------------------ | ----------------------------------------------------- |
| Linux (x86_64)         | `K-code-linux-x86_64.AppImage` | `chmod +x` it, then run it.                           |
| Debian, Ubuntu (amd64) | `K-code-linux-amd64.deb`       | `sudo apt install ./K-code-linux-amd64.deb`           |
| Windows (x64)          | `K-code-windows-x64-setup.exe` | Run the installer. SmartScreen may warn on first run. |
| macOS, Apple Silicon   | `K-code-macos-arm64.dmg`       | Unsigned: right-click the app, choose Open.           |
| macOS, Intel           | `K-code-macos-x64.dmg`         | Unsigned: right-click the app, choose Open.           |

Verify a download against `SHA256SUMS.txt` from the same release:

```bash
sha256sum -c --ignore-missing SHA256SUMS.txt
```

## One-line install (server / CLI)

Linux and macOS:

```bash
curl -fsSL https://kcode.agentbox.io.vn/install.sh | sh
```

Windows, in PowerShell:

```powershell
irm https://kcode.agentbox.io.vn/install.ps1 | iex
```

The script downloads the right `kcode-server-*` archive from the latest GitHub release, checks it against `SHA256SUMS.txt`, unpacks it into `~/.local/share/kcode/server` (no root needed) and links the `kcode` command into `~/.local/bin`. If your shell reports `command not found`, add that folder to `PATH`; the installer prints the exact line. Re-running it is safe.

Options (pass after `sh -s --`):

| Option              | Effect                                                        |
| ------------------- | ------------------------------------------------------------- |
| `--desktop`         | Install the desktop app instead of the server.                |
| `--version <x.y.z>` | Install a specific release (also `KCODE_VERSION`).            |
| `--dir <path>`      | Directory for the `kcode` command (also `KCODE_INSTALL_DIR`). |
| `--system`          | Link `kcode` into `/usr/local/bin` with sudo.                 |
| `--dry-run`         | Download and verify, change nothing.                          |

`KCODE_HOME` changes where the server is unpacked, and `KCODE_DOWNLOAD_BASE` points the installer at a mirror.

| Task                                             | Command                 |
| ------------------------------------------------ | ----------------------- |
| Start the server and open the web app            | `kcode`                 |
| Start the server without a browser               | `kcode serve`           |
| Print a pairing link for another device          | `kcode pair`            |
| Keep it running in the background (Linux, macOS) | `kcode service install` |
| Update                                           | `kcode update`          |
| Remove                                           | `kcode uninstall`       |

Run `kcode --help` for the complete list.

## Server / headless

Download the archive for your platform from the releases page:

| Platform            | File                              |
| ------------------- | --------------------------------- |
| Linux x64           | `kcode-server-linux-x64.tar.gz`   |
| Linux arm64         | `kcode-server-linux-arm64.tar.gz` |
| macOS Apple Silicon | `kcode-server-macos-arm64.tar.gz` |
| macOS Intel         | `kcode-server-macos-x64.tar.gz`   |
| Windows x64         | `kcode-server-windows-x64.zip`    |

```bash
mkdir -p ~/.local/share/kcode/server
tar -xzf kcode-server-linux-x64.tar.gz -C ~/.local/share/kcode/server --strip-components=1
~/.local/share/kcode/server/t3 serve --host <private-ip>
```

The executable inside the archive keeps the upstream name `t3`; the installer links it as `kcode`. Bind to a private address (LAN or tailnet) rather than a public one, and pair clients with `kcode pair`. For an always-on host see [Background service](/docs/features/background-service/) and [Remote access](/docs/features/remote-access/).

## From source

K-code uses [Vite+](https://viteplus.dev) (`vp`) as package manager and task runner, with Node 24.

```bash
git clone https://github.com/zt-hky/k-code
cd k-code
vp i
npm run dev          # contracts + web (port 5733) + server (port 13773)
```

To build the desktop app locally:

```bash
vp run build:desktop
```

## Mobile app

The mobile app lives in `apps/mobile` in the repository and connects to a server on another machine. It is built from source with Expo; see the repository README. Prebuilt store listings are not part of the v0.1.0 release.

## Uninstall

`kcode uninstall` removes the CLI. The desktop app uninstalls like any other app on your platform. Your data in `~/.t3` is kept; delete it yourself to remove threads and settings. See [Configuration](/docs/configuration/).
