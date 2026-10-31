K-code is an open-source GUI for coding agents. It runs the agent CLIs you already use (Claude Code, Codex, Cursor, OpenCode, Pi, Oh My Pi and others) and gives them one fast interface that works as a desktop app, in the browser, or from your phone.

K-code is a fork of [T3 Code](https://github.com/pingdotgg/t3code) and stays MIT licensed. It is part of the [AgentBox](https://agentbox.io.vn) family.

## How it works

A **K-code server** runs on the machine where your code lives: your laptop, a workstation, a VPS or an AgentBox workspace. The server starts and talks to the agent CLIs. A **client** (the desktop app, a browser tab, or the mobile app) connects to a server and shows your projects and threads.

- **Projects** are folders on the server's machine.
- **Threads** are conversations with an agent, scoped to a project (optionally in their own git worktree).
- **Providers** are the agents. Each one is a CLI installed on the server, signed in with your own account.

The desktop app bundles a local server, so on one machine you only install the app. For remote use, run a server on the other machine and pair a client with it. See [Remote access](/docs/features/remote-access/).

## What is different in K-code

- **Oh My Pi** is a first-class provider, including native session resume across projects.
- **Agent Hub** shows every running subagent as a live grid, per thread and project-wide, with per-agent Stop where the provider can cancel one agent.
- **Full transcript mode** expands all thinking and tool output everywhere, on desktop, web and mobile.
- Batch subagent runs are split into one entry per task, with their own status, usage and transcript.

## Where to go next

1. [Install K-code](/docs/install/) on desktop, or as a headless server.
2. Follow the [Quick start](/docs/quick-start/) to sign in to a provider and start your first thread.
3. Read about [Agent Hub](/docs/features/agent-hub/) and [Remote access](/docs/features/remote-access/).
