Most preferences are stored on the K-code **server**, not in a single client. Every device paired with the same server sees the same values, so you can change the theme on your laptop and see it on your phone.

## What syncs

- Appearance choices, including theme and [full transcript mode](/docs/features/full-transcript/)
- Chat behavior such as the send shortcut and follow-up behavior
- Most other client preferences exposed in **Settings**

## What stays on the device

- Fonts and font sizes
- Window chrome and desktop-only options (for example network access on the desktop app)
- Credentials: pairing tokens and sign-ins are per device

## How it works

Clients write settings to the server they are connected to and receive updates live. If you connect one client to several servers (environments), each server keeps its own settings; the client shows the settings of the active environment. Server state lives in the [data directory](/docs/configuration/) (`~/.t3` by default), so backing up or moving it moves your settings too.
