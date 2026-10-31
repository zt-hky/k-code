## 1. Start K-code

- **Desktop app:** open K-code. It starts a local server for you.
- **Server install:** run `kcode`. It starts the server and opens the web app (default `http://127.0.0.1:3773`). Use `kcode serve` to skip opening a browser.

## 2. Connect a provider

Open **Settings → Providers**, pick the environment, and enable a provider. Each provider's CLI must be installed on the server's machine and be on its `PATH` (or set **Binary path** in the provider card). Sign in the way the provider requires: for example `claude auth login` for Claude, `codex login` for Codex, or **Sign in** inside K-code for Oh My Pi.

Provider-specific setup is in [Providers](/docs/providers/overview/).

## 3. Add a project and start a thread

1. Choose **Add project** and select a folder on the server's machine (or run `kcode app .` from a terminal with the desktop app running).
2. Start a **New thread**. Pick the provider and model, set the effort and the [permission mode](/docs/features/permission-modes/), and send a prompt.
3. Watch the agent work. Expand rows to see tool calls, or turn on [full transcript](/docs/features/full-transcript/) to see everything at once.

Open **Agent Hub** from the thread's right panel when an agent starts subagents. See [Agent Hub & running agents](/docs/features/agent-hub/).

## 4. Pair another device

On the server machine:

```bash
kcode pair
```

Scan the QR code with your phone, or paste the link into **Add environment** in another client. The link works for one device and one use. Over a LAN, bind the server to a reachable address first:

```bash
kcode serve --host <private-ip>
```

More options (Tailscale HTTPS, Cloudflare tunnel, SSH) are in [Remote access](/docs/features/remote-access/).

## 5. Keep going

- [Resume native sessions](/docs/features/resume-sessions/) you started in the terminal.
- [Keybindings](/docs/features/keybindings/) and [Settings](/docs/features/settings/).
- [Troubleshooting](/docs/troubleshooting/) if a provider is not detected.
