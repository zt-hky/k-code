# Oh My Pi integration ledger

Oh My Pi (`omp acp`) runs as an ACP Registry agent (`agentId: "omp"`). This branch carries omp support that upstream T3 Code does not have. The ledger lists what is ours, so an upstream merge stays mechanical.

## The merge rule

When upstream changes a registration point below, keep upstream's shape and re-apply our line on top. When upstream ships an equivalent of something here (ACP steering, `$/cancel_request`, assistant images, slash-argument completion), delete ours and its bullet instead of keeping both.

## omp-only files

- `packages/provider-acp-registry/src/server/ompAcp.ts` (+ test) — the agent id, plan capture and approval gate, the `task` subagent mapping (`extractOmpSubagentUpdate`, detected from `rawInput` because omp sends no tool name), and the `_omp/projects/list` and `_omp/extensions*` method names.
- `ompAsk.ts` — `askDialog` forms (`qN`, `qN__other`) and hiding the duplicate `ask` tool row.
- `ompUsage.ts` (+ test), `usage.ts` — `_omp/usage` accounts and the session-log usage reader. omp reports usage only once a session exists, so the probe reuses one usage session via `session/resume`.
- `ompSkills.ts` (+ test) — rewrites composer `$skill` mentions to omp's `/skill:name`.
- `ompAnsi.ts` (+ test) — strips the terminal escapes omp prints in `/context` and similar output, holding back a partial escape split across chunks.
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
- `packages/provider-acp-registry/src/server/adapter.ts` — the `registryAgentId === OMP_AGENT_ID` flavor block. `driver.ts` — omp-only snapshot flags (`showInteractionModeToggle`, `nativeSessions.canListProjects`, `manageableExtensions`) and management wiring. `probe.ts` — `normalizeAcpRegistryCommands(commands, agentId)`, the `_omp/*` probes and their `managementFailure` operations.
- `packages/contracts/src/acpRegistry.ts`, `server.ts`, `providerUsageLimits.ts`, `usage.ts`, `rpc.ts`, `clientRpcPermissions.ts` — omp schemas, three ACP registry RPCs, `usageLimitAccounts`, the `omp` usage kind.
- `apps/server/src/ws.ts`, `auth/RpcAuthorization.ts`, `observability/RpcInstrumentation.ts`, `packages/client-runtime/src/state/server.ts` — one handler, scope, span and atom per new RPC.
- `apps/web/src/composer-logic.ts`, `components/chat/ComposerCommandMenu.tsx`, `useComposerMenuItems.ts`, `ChatComposer.tsx` — the `slash-argument` trigger.
- `apps/web/src/components/chat/TimelineAssistantRows.tsx`, `TimelineUserMessageRow.tsx` — mount `MessageImageGrid`.
- `apps/web/src/components/chat/ChatComposer.tsx` (`workPanels` prop), `ChatView.tsx` (mounts `ThreadWorkPanelsDock`), `session-logic.ts` (`findLatestTodoList`), `state/entities.ts` (`useThreadTurnSubagents`) — the work panels.
- `apps/web/src/components/settings/AcpSessionManagementSection.tsx` — mounts the extensions section and shows message counts.
- `packages/shared/src/usageLimits.ts`, `apps/web/src/components/usage/*`, `apps/mobile/src/features/usage/usageProviders.ts` — hub accounts in usage views.
- `apps/server/scripts/acp-mock-agent.ts` — `T3_ACP_SESSION_STEERING`, `T3_ACP_TURN_USAGE`, omp plan approval, `session/list` `_meta`.
