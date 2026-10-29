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

Choose a service and T3 Code takes you through what it needs:

- **Browser sign-in** opens the service's page in a new tab and waits. If the page redirects to a
  `localhost` address that does not load, which happens when the server is remote, copy that
  address from the browser and paste it into the field.
- **Device code** shows a code to enter on the service's page. Copy it, approve, and the panel
  finishes by itself.
- **API key** takes the key in a hidden field. The service checks it before Oh My Pi stores it.

Signed-in accounts are listed under the services, each with **Sign out**. Signing out removes the
stored credentials from the server; if an environment variable still provides a key, the panel
says so. Cancel stops a sign-in at any point. Models appear in the picker as soon as a sign-in
finishes, grouped by the service that provides them.

The sign-in runs on the environment that hosts Oh My Pi, so it works the same from the web,
desktop, and mobile apps.

## What carries over

- **Plan and Build** follow T3 Code's toggle; Oh My Pi's plan becomes a plan card you can
  implement.
- **Questions** Oh My Pi asks appear in the composer, including multiple choice and custom
  answers.
- **Extensions**: turn Oh My Pi's extension sources on and off in the provider settings.
- **Native sessions**: **Resume session…** lists Oh My Pi's earlier sessions per project folder;
  see [Native sessions](./providers-acp.md#native-sessions).
- **Subagents** appear as tasks with their transcripts.
- **Skills** appear in the `$` menu; selecting one runs `/skill:<name>`.
- **Usage**: the card and Usage page show each signed-in account's limits. Token totals come from
  Oh My Pi's session logs.

Approvals follow the thread's [permission mode](./permission-modes.md), as for other
[ACP agents](./providers-acp.md#permissions-and-terminals). Oh My Pi does not write commit
messages, titles, or other text for T3 Code; choose another provider for those in **Settings →
Providers**.
