# Oh My Pi

T3 Code runs [Oh My Pi](https://omp.sh) (`omp`) as its own provider, next to Codex and Claude. It
keeps Oh My Pi's models, extensions, skills, and native session history, and shows the usage limits
of the accounts it is signed in to.

## Set up

1. Install Oh My Pi on the machine that runs the T3 Code server. See [omp.sh](https://omp.sh).
2. Open **Settings → Providers**. Oh My Pi is already there and on; there is nothing to enable.
3. Choose **Sign in** and pick the model provider you pay for.

If `omp` is not on the server's `PATH`, set **Binary path** in the Oh My Pi provider settings.
The card shows the installed version and **Update now** when a newer one is available; it runs
`omp update` on that machine.

Existing Oh My Pi providers you added from the ACP Registry move to this provider automatically.
They keep their name, settings, and threads.

## Sign in

Oh My Pi signs in to each model service separately, and it stays usable as soon as one of them is
signed in. **Settings → Providers → Oh My Pi → Sign in** lists the common services first
(Claude Pro/Max, ChatGPT Plus/Pro, GitHub Copilot, Google, OpenRouter, xAI, DeepSeek); search to
find the rest. In a thread whose provider is not signed in, the notice above the composer opens the
same list.

Choose a service and T3 Code takes you through what it needs. **Sign in** always starts the way
that finishes on its own for where you are:

- **Device code** shows a code and a link. Approve on the service's page, from any device, and the
  panel finishes by itself: the status and models refresh without a click. GitHub Copilot, Kimi
  Code, xAI Grok (SuperGrok / X Premium+), Factory Droid, Muse Code and Kilo sign in this way, and
  so does ChatGPT Plus/Pro as **Codex, headless/device**. ChatGPT is one service with two ways in;
  the device code leads whenever your browser is not on the server's machine.
- **Browser sign-in** (Claude Pro/Max, ChatGPT's regular sign-in, Google Gemini and Antigravity,
  Devin, GitLab Duo, OpenRouter) redirects to a `localhost` address when it is done. That address
  only works on the machine that runs the sign-in, so how it finishes depends on where you are:
  - **Server and browser on one computer** (the desktop app's own server, or `npx t3` here): the
    server catches the redirect and the panel finishes by itself. This is the primary ChatGPT
    sign-in in that case.
  - **Desktop app connected to another environment** (an AgentBox workspace, an SSH or Tailscale
    host): the app opens a one-time listener on `127.0.0.1` at the redirect's port while the
    sign-in is running, accepts only the redirect path with the sign-in's own `state`, passes the
    full address to the environment, and closes. It lives at most 10 minutes. The page says "You
    can close this tab", and the panel finishes by itself. If another program already uses that
    port, the panel says so and you paste the address instead.
  - **Web or mobile app connected to a remote server**: nothing on the browser's side can catch the
    redirect. Copy the address the browser ended on (it may show an error page) and paste it into
    the field.
- **Other ways to sign in** under a service lists the remaining options, for example ChatGPT's
  localhost sign-in when the device code leads, or the device code when the localhost sign-in leads.
- **API key** takes the key in a hidden field. The service checks it before Oh My Pi stores it.

Services whose sign-in returns to an installed app (Z.AI's `zcode://` link, GitLab Duo Agent's
`vscode://` link) also finish by pasting the address.

### Use my local sign-ins

In the desktop app, when the environment is not this computer, **Settings → Providers → Oh My Pi**
also offers **Use my local sign-ins**. It reads the sign-ins from this computer's own Oh My Pi
(`omp auth export`), lists the services that would be copied, and asks you to confirm. The warning
is real: it copies your API keys and sign-in tokens, so anyone who can use that environment can use
those accounts. Copy them only to a server you control.

On confirm the app sends them over the connection it already has to the environment (this needs the
**Manage providers** permission), which runs `omp auth import -` for that Oh My Pi instance. T3 Code
does not log or keep them, on either side, and they stay on this computer too. Status and models
refresh when it is done. If Oh My Pi is not installed on this computer, the panel says so instead.
The web and mobile apps do not offer this, since they cannot run Oh My Pi locally.

Signed-in accounts are listed under the services, each with **Sign out**. Signing out removes the
stored credentials from the server; if an environment variable still provides a key, the panel
says so. Cancel stops a sign-in at any point. Models appear in the picker as soon as a sign-in
finishes, grouped by the service that provides them.

The sign-in runs on the environment that hosts Oh My Pi, so it works from the web, desktop, and
mobile apps.

## What carries over

- **Plan and Build** follow T3 Code's toggle; Oh My Pi's plan becomes a plan card you can
  implement.
- **Questions** Oh My Pi asks appear in the composer, including multiple choice and custom
  answers.
- **Extensions**: turn Oh My Pi's extension sources on and off in the provider settings.
- **Native sessions**: **Resume session…** lists Oh My Pi's earlier sessions per project folder;
  **All projects** lists them from every folder and adds the project when you resume one. Sessions
  Oh My Pi never titled show their first message. Renaming a thread renames its Oh My Pi session, so
  `omp`'s own resume list matches. See [Native sessions](./providers-acp.md#native-sessions).
- **Subagents**: each agent of a parallel batch gets its own entry, status, usage, and transcript.
  Stop on an agent's row, pane, or card cancels only that agent; the rest of the batch and the
  turn keep running. T3 Code loads a small extension into Oh My Pi (`omp acp --extension`) for
  this.
- **Skills** appear in the `$` menu; selecting one runs `/skill:<name>`.
- **Usage**: the card and Usage page show each signed-in account's limits. Token totals come from
  Oh My Pi's session logs.

Approvals follow the thread's [permission mode](./permission-modes.md), as for other
[ACP agents](./providers-acp.md#permissions-and-terminals). Oh My Pi can write commit messages,
titles, and other text for T3 Code; pick it in **Settings → Providers**. Forking from an earlier turn
starts the fork from a summary of the thread, not from Oh My Pi's own session.
