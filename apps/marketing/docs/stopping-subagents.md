You can always stop the whole turn with the thread's **Stop** button. Subagents stop with it.

## Stopping one agent

Where a provider can cancel a single subagent, its row, pane and card in [Agent Hub](/docs/features/agent-hub/) show a **Stop** button. Stopping one agent cancels only that agent: its siblings and the parent turn keep running, and the parent receives the cancelled result.

Which providers support it is reported by the provider itself:

| Provider                      | Per-agent Stop                                                                        |
| ----------------------------- | ------------------------------------------------------------------------------------- |
| Oh My Pi                      | Yes. K-code loads a small extension into `omp acp` that exposes cancel for one agent. |
| Workflow agents run by K-code | Yes.                                                                                  |
| Other providers               | Not unless the provider exposes it. Use the turn **Stop**.                            |

If there is no Stop button on an agent, that provider cannot cancel it individually. The turn Stop is always available.

## What happens after a stop

The stopped agent shows **stopped** with whatever output it had produced. The parent agent decides what to do next, as it would with a failed subagent. Stopping the whole turn marks all of its still-running agents as stopped.
