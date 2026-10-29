# Oh My Pi integration ledger

Oh My Pi (`omp`) is a first-class provider with its own driver kind, `ohmypi`, in
`packages/provider-ohmypi`. It runs `omp acp` through the shared ACP adapter. It used to be an ACP
Registry agent (`agentId: "omp"`); the registry package no longer knows about it. This branch carries omp support that upstream T3 Code does not have. The ledger lists what is ours, so an upstream merge stays mechanical.

## The merge rule

When upstream changes a registration point below, keep upstream's shape and re-apply our line on top. When upstream ships an equivalent of something here (ACP steering, `$/cancel_request`, assistant images, slash-argument completion), delete ours and its bullet instead of keeping both.

## Shape and constraints

- **Default instance.** `ohmypi` has a default instance that is on without saved settings (`OhMyPiSettings.enabled` defaults to true, and `ohmypi` is in `DEFAULT_ENABLED_DEFAULT_INSTANCES` in contracts), like Codex and Claude. It is not added to `DEFAULT_DISABLED_PROVIDER_DRIVERS`, and tests that count default instances must disable it.
- **Registry machinery through a local source.** Probe, session management and runtime launch are agent-agnostic once they have a command, so the driver feeds them `omp acp` as an `AcpRegistrySettings` local source (`registrySettings.ts`) and the real `AcpRegistryCatalog`. Omp-specific behavior (skills prefix, `_omp/*` methods, plan mode, login, usage) lives only in the ohmypi package; the registry exports the generic helpers it needs (`./server/probe`: `makeAcpRegistryManagementRuntime`, `managementFailure`, bounded-text helpers) and `normalizeAcpRegistryCommands` takes extra skill prefixes instead of an agent id.
- **Auth is not an ACP flow.** omp's only ACP auth method is "use existing local credentials". Auth status comes from `omp --mode rpc` `get_login_providers` (credentials in `~/.omp`, or env keys, count as authenticated) read by the readiness check, and from discovery: omp lists a model only when a credential is usable, so a completed discovery with no models means signed out. Web-search keys (`tavily`, `kagi`, `exa`, `parallel`) are not model providers. Unauthenticated snapshots skip the discovery probe, and `ProviderRegistry` treats them as authoritative so signing out clears cached models.
- **Legacy instances migrate on settings load** (`apps/server/src/legacyOmpInstances.ts`, applied in `serverSettings.ts` on load and on every normalize). An `acpRegistry` instance with `agentId: "omp"`, or a local `omp acp` command, becomes `driver: "ohmypi"` and keeps its id, name, environment, enabled flag, `commandPath` (as `binaryPath`), custom models and instruction toggles; the file is rewritten. Threads reference instance ids, so they keep working. Provider threads already stored with `driver: "acpRegistry"` are not rewritten: native resume reads the ACP session id, not the driver.

## omp-only files

- `packages/provider-ohmypi/src/server/acp.ts` (+ test) — the plan capture and approval gate, the `task` subagent mapping (`extractOmpSubagentUpdate`, detected from `rawInput` because omp sends no tool name), and the `_omp/projects/list` and `_omp/extensions*` method names.
- `ask.ts` — `askDialog` forms (`qN`, `qN__other`) and hiding the duplicate `ask` tool row.
- `usageAccounts.ts` (+ test), `management.ts` — `_omp/usage` accounts, projects and extensions. omp reports usage only once a session exists, so the driver reuses one usage session via `session/resume`. `usage.ts` is the session-log reader (Pi's JSONL format under `~/.omp/agent/sessions`).
- `skills.ts` (+ test) — rewrites composer `$skill` mentions to omp's `/skill:name`; `OMP_SKILL_PREFIXES` makes `skill:*` commands skills.
- `ansi.ts` (+ test) — strips the terminal escapes omp prints in `/context` and similar output, holding back a partial escape split across chunks.
- `status.ts` (+ test) — `omp --version`, the snapshot mapping, model list with `subProvider` from omp's `provider/model` ids, and the hidden `mode` option (T3's Build/Plan toggle owns omp's plan mode). `maintenance.ts` — `omp update --check` for the advisory and `omp update` as the updater.
- `login.ts`, `loginOutput.ts`, `process.ts` (+ tests, `fixtures/login/*.json`, `loginHarness.testkit.ts`) — model-provider sign-in. Neither ACP nor `omp --mode rpc` can drive it alone: ACP has no login method, and RPC `login` rejects secret prompts and prompts that precede the URL (every API-key provider, GitHub Copilot's enterprise question). So `omp login <id>` runs with piped stdin and its stdout is scanned (a line without a newline after a quiet period is a prompt), while the provider list and sign-out use a short-lived `--mode rpc` process (`get_login_providers`, `get_logout_accounts`, `logout`). RPC mode needs a catalog model to start, hence `--model sonnet`. Pasted values go to stdin and are never stored or put in a span.
  - The flow is classified once the output goes quiet, because the URL block and its prompt arrive separately: a device code line (`Enter code:`) makes `device_code`; a secret prompt after a dashboard link makes `api_key` (the URL is not a page to open); otherwise `oauth`, with an optional pasted redirect. The URL and its prompt are published in one state change.
  - `Credentials saved to <path>` is dropped; a failure's JSON body is reduced to the provider's message; a clean exit without `Logged in` counts when `get_login_providers` shows the credential.
  - The fixtures are recordings of real `omp login` runs (omp 18.13.2, isolated `HOME`, stdin a pipe): OAuth with and without a pasted redirect, device code, a prompt before the URL, API-key success and rejection. Re-record them when omp changes its wording.
- `apps/web/src/components/settings/OmpModelLoginSection.tsx` (+ logic, test, `OmpModelLoginDialog.tsx`) — the sign-in panel: popular services first, search, per-flow steps, signed-in accounts and sign-out. Mounted by the provider card (`ProviderInstanceCard.tsx`, open when signed out), the wizard's account step, and a dialog opened from the composer's provider status banner. Mobile: `apps/mobile/src/features/settings/OmpModelLoginAccount.tsx` in Settings → Providers.
- `apps/web/src/components/settings/AcpExtensionSourcesSection.tsx` — turns omp extension sources on and off (`_omp/extensions/toggle` switches a whole source, never one item).
- `apps/web/src/components/ResumeSessionDialog.tsx` (+ test), `resumeSessionDialogState.ts`, `apps/web/src/hooks/useAcpNativeSessions.ts` — the resume picker and its "Projects in …" group.
- `apps/web/src/components/chat/sessionPin.ts` — `/session pin` from the usage panel.
- `apps/web/src/components/chat/MessageImageGrid.tsx` — the image grid shared by user and assistant rows.
- `apps/web/src/components/chat/slashCommandArguments.ts` (+ test) — choices parsed from a command's `input.hint`.
- `apps/web/src/components/chat/ThreadWorkPanels.tsx` (+ logic, tests) — the Tasks and Subagents cards above the composer.

## Upstream registration points

- `packages/provider-acp/src/server/adapter.ts` — optional `AcpAdapterV2Flavor` fields (`supportsSessionSteering`, `planApprovalElicitation`, `interactionModeOptionIds`, `isUserInputTool`), a real `steerTurn`, `turnUsage` → `tokenUsage`, assistant image attachments on text segments, and cancelled runtime requests when a handler is interrupted.
- `packages/provider-acp/src/server/elicitationForm.ts` — generic form mapping (`oneOf`, multi-select, typed answers).
- `packages/effect-acp/src/protocol.ts`, `errors.ts` — `$/cancel_request` interrupts the inbound handler and answers `-32800`. `scripts/generate.ts` — property maps are not keywords (fixes `TitledMultiSelectItems`).
- `packages/provider-core/src/server/ProviderHost.ts` — optional `persistImageAttachment`; implemented in `apps/server/src/provider/ProviderHostLive.ts` and `packages/provider-testing/src/TestProviderHost.ts`. `driver.ts` — optional `listProjects`, `listExtensions`, `setExtensionSource` on `acpSessionManagement`.
- `packages/provider-core/src/server/driver.ts` — optional `modelProviderLogin` on `ProviderInstance`; `ProviderModelLogin` is the service shape.
- `packages/provider-acp-registry/src/server/probe.ts` — `normalizeAcpRegistryCommands(commands, extraSkillPrefixes)`, the optional `skillPrefixes` probe input, and the exported management helpers. `package.json` exports `./server/probe`.
- `packages/provider-core/src/server/driver.ts` — `modelProviderLogin` is created by the ohmypi driver and sets the `modelProviderLogin` snapshot flag.
- `apps/server/src/provider/builtInDrivers.ts` (driver and usage reader), `providerStatusCache.ts` (status order), `ProviderRegistry.ts` (`shouldRetainMissingProviderModels`), `serverSettings.ts` and `legacyOmpInstances.ts`, `settingsSecrets.ts`; `packages/client-runtime/src/providerClients.ts` (client definition, `acpRegistryAgentIds: ["omp"]` keeps it out of the Registry search); `packages/contracts/src/settings.ts`, `model.ts` (default instance and default model).
- `packages/contracts/src/acpRegistry.ts`, `server.ts`, `providerUsageLimits.ts`, `usage.ts`, `rpc.ts`, `clientRpcPermissions.ts` — omp schemas (`OmpLoginState` carries the classified `kind` and `userCode`), three ACP registry RPCs, `usageLimitAccounts`, the `omp` usage kind.
- `apps/server/src/ws.ts`, `auth/RpcAuthorization.ts`, `observability/RpcInstrumentation.ts`, `packages/client-runtime/src/state/server.ts` — one handler, scope, span and atom per new RPC.
- `apps/web/src/composer-logic.ts`, `components/chat/ComposerCommandMenu.tsx`, `useComposerMenuItems.ts`, `ChatComposer.tsx` — the `slash-argument` trigger.
- `apps/web/src/components/chat/TimelineAssistantRows.tsx`, `TimelineUserMessageRow.tsx` — mount `MessageImageGrid`.
- `apps/web/src/components/chat/ChatComposer.tsx` (`workPanels` prop), `ChatView.tsx` (mounts `ThreadWorkPanelsDock`), `session-logic.ts` (`findLatestTodoList`), `state/entities.ts` (`useThreadTurnSubagents`) — the work panels.
- `apps/web/src/components/settings/AcpSessionManagementSection.tsx` — mounts the extensions section and shows message counts.
- `packages/shared/src/usageLimits.ts`, `apps/web/src/components/usage/*`, `apps/mobile/src/features/usage/usageProviders.ts` — hub accounts in usage views.
- `apps/server/scripts/acp-mock-agent.ts` — `T3_ACP_SESSION_STEERING`, `T3_ACP_TURN_USAGE`, omp plan approval, `session/list` `_meta`.
