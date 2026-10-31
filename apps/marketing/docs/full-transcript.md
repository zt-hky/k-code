By default K-code keeps threads compact: older turns fold, work groups collapse, thinking shows a summary and long tool output is capped. **Full transcript mode** turns all of that off so you can read exactly what the agent did.

## What it changes

- Turn folds and work groups are expanded, without changing your own open/closed choices (turn it off and they return).
- Thinking shows in full, rendered as markdown.
- Tool calls show their full input and full output. Command output that was omitted from the live view is fetched when its row renders.
- Height caps on logs are removed.
- [Agent Hub](/docs/features/agent-hub/) panes and logs show full thinking and full tool input and output.

Long threads render the same way, just taller.

## Turn it on

- **Settings → Appearance → Full transcript**.
- The **Toggle full transcript** button in the chat header.
- The command palette action **Show full transcript** (**Hide full transcript** when on).
- The keybinding `chat.fullTranscript.toggle`, bound by default to `mod+alt+shift+e` (change it in **Settings → Keybindings**).
- Mobile: **Settings → Appearance → Text** and the button in the thread header (iOS and Android).

The setting syncs across your devices connected to the same server; see [Settings sync](/docs/features/settings-sync/).
