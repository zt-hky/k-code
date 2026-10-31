When an agent fans out into subagents (parallel tasks, workflow steps, delegated reviews), K-code tracks each one. **Agent Hub** is where you watch them.

## Open it

- In a thread, open the right panel and choose **Agents**, or press the keybinding for **Agent Hub: Toggle** (assign one in **Settings → Keybindings**; it has no default).
- For a project-wide view open the **Running agents** page (`/agents`) from the command palette (**Open running agents**) or the `agents.open` keybinding (assign one in **Settings → Keybindings**). It lists every live subagent across the threads of the selected project and environment, grouped by parent thread.

## The grid

Each running agent gets a pane:

- the agent name, model and status (queued, running, done, failed, stopped)
- the **current tool** and a progress strip while it works
- the latest thinking excerpt and its replies, rendered as markdown
- token usage once the provider reports it
- a **Stop** button when that agent can be stopped (see [Stopping subagents](/docs/features/stopping-subagents/))

Layout controls:

- The grid is responsive, one to four columns, with no cap on the number of panes.
- **Live / All** filters to agents that are still running, or shows finished ones too.
- **Maximize** a pane to read its full log; restore to return to the grid.
- Live agents sort first.

## Batch tasks

Some providers launch several tasks in one tool call. K-code splits those into **one entry per task** (for example "agent 2 of 5") with its own status, progress, usage, model and result, and keeps the entries stable while progress arrives. Oh My Pi batch runs are supported this way.

## Transcript detail

Open a pane's log for the agent's transcript. With [full transcript mode](/docs/features/full-transcript/) on, logs show full thinking and full tool input and output instead of excerpts.

## Mobile

The mobile app has an **Agents** sheet on the thread screen with the same information: live-first ordering, a batch hint, and a live progress strip per agent.
