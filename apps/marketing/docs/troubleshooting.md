## Troubleshooting

### `kcode: command not found`

The installer puts `kcode` in `~/.local/bin`. Add it to your `PATH` (`export PATH="$HOME/.local/bin:$PATH"`) and open a new terminal.

### A provider shows as not installed

K-code looks for the CLI on the **server's** `PATH`. Version managers (mise, nvm, asdf) often only set `PATH` in interactive shells. Set **Binary path** in the provider card to the executable's full path. Remember Cursor's executable is `cursor-agent`.

### A provider says it is not signed in

Sign in on the server's machine, not on your phone. Use the provider's own login command, or **Sign in** in **Settings → Providers** where K-code offers it (Oh My Pi, Codex, Cursor, Antigravity).

### A pairing link does not work

- It is one-time: create a fresh one with `kcode pair`.
- The host must be reachable at the link's address. `127.0.0.1` only works on the same machine; bind the server to a private IP or use Tailscale.
- Browsers and mobile need HTTPS for some secure features; use Tailscale HTTPS or a tunnel.

### Port already in use

Another server is running. Connect to it, stop it first, or start an independent one with `--port` or `--base-dir`.

### Downloads return 404

Release assets only exist once a release is published at [GitHub Releases](https://github.com/zt-hky/k-code/releases). If `releases/latest/download/<file>` returns 404, the release has not been published yet.

### macOS says the app is damaged or from an unidentified developer

The macOS builds are unsigned. Right-click the app and choose **Open**, or run `xattr -dr com.apple.quarantine /Applications/K-code.app`.

### Where are my threads and logs?

In the data directory, `~/.t3` by default. See [Configuration](/docs/configuration/).

## FAQ

### Is K-code an agent?

No. K-code is the interface. The agent (harness) is Claude Code, Codex, Oh My Pi or another CLI you bring. K-code starts it, shows what it does and handles approvals.

### Does K-code cost anything?

No. K-code is free and MIT licensed, with no account. You pay your model providers as you already do.

### Can I use my Claude Code or ChatGPT subscription?

Yes, through the matching provider, signed in on the server machine.

### How is K-code different from T3 Code?

K-code is a fork. It adds Oh My Pi as a first-class provider, Agent Hub with a project-wide running-agents page and per-agent Stop, full transcript mode, native session resume, and its own branding and releases. Credit for the original goes to the T3 Code authors.

### Is my code sent anywhere?

K-code runs on your machine and talks to the providers you configure. It does not proxy your code.

### Where do I report bugs?

[GitHub issues](https://github.com/zt-hky/k-code/issues).
