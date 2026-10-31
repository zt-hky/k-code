K-code does not ship models. It drives agent CLIs and SDKs that you install and sign in to yourself, so you keep your own subscriptions, models and limits. Installation, login and configuration happen on the **server's** machine, even when you connect from a phone or another computer.

Open **Settings → Providers**, select an environment, and enable the provider. Add a second instance of a provider for another account or a custom base URL; each instance can have its own environment variables.

| Provider                                    | What you need                                                                              |
| ------------------------------------------- | ------------------------------------------------------------------------------------------ |
| [Claude](/docs/providers/claude/)           | [Claude Code](https://claude.com/product/claude-code) installed, then `claude auth login`. |
| [Codex](/docs/providers/codex/)             | Connect with ChatGPT in K-code, or install the Codex CLI and run `codex login`.            |
| [Cursor](/docs/providers/cursor/)           | Sign in with Cursor in provider settings, or set `CURSOR_API_KEY`.                         |
| [OpenCode](/docs/providers/opencode/)       | [OpenCode](https://opencode.ai) installed, then `opencode auth login`.                     |
| [Oh My Pi](/docs/providers/oh-my-pi/)       | [Oh My Pi](https://omp.sh) (`omp`) installed, then **Sign in** in provider settings.       |
| [Pi](/docs/providers/pi/)                   | Pi with Node.js 22.19+, then `pi` and `/login`.                                            |
| [Antigravity](/docs/providers/antigravity/) | Sign in with Google from provider settings.                                                |
| [Muse Code](/docs/providers/muse/)          | Muse Code installed, `muse login`.                                                         |
| [fx](/docs/providers/fx/)                   | fx installed, `fx login`.                                                                  |
| [Any ACP agent](/docs/providers/acp/)       | An agent that speaks the Agent Client Protocol.                                            |

If K-code cannot find a CLI, set its **Binary path** in provider settings, especially when you use a version manager such as mise or nvm. Cards show the installed version, flag versions with known compatibility problems, and offer **Update now** when the CLI is behind.
