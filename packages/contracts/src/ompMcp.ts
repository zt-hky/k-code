import * as Schema from "effect/Schema";

import { NonNegativeInt, ProjectId, TrimmedNonEmptyString } from "./baseSchemas.ts";
import { ProviderInstanceId } from "./providerInstance.ts";

/**
 * Oh My Pi MCP server and skill management. Every operation runs omp's own `/mcp` commands and
 * `get_available_commands` over `omp --mode rpc`; K-code never edits omp's config files.
 */

// omp's `/mcp remove` cannot address a name with spaces, so K-code only creates names it can remove.
export const OmpMcpServerName = TrimmedNonEmptyString.check(
  Schema.isMaxLength(128),
  Schema.isPattern(/^[A-Za-z0-9][A-Za-z0-9._-]*$/),
);
export type OmpMcpServerName = typeof OmpMcpServerName.Type;

export const OmpMcpScope = Schema.Literals(["user", "project"]);
export type OmpMcpScope = typeof OmpMcpScope.Type;

export const OmpMcpTransport = Schema.Literals(["stdio", "http", "sse"]);
export type OmpMcpTransport = typeof OmpMcpTransport.Type;

const OmpMcpText = (max: number) => Schema.String.check(Schema.isMaxLength(max));

/** One configured server as `/mcp list` reports it. Names written outside K-code may not match `OmpMcpServerName`. */
export const OmpMcpServer = Schema.Struct({
  name: TrimmedNonEmptyString.check(Schema.isMaxLength(256)),
  transport: TrimmedNonEmptyString.check(Schema.isMaxLength(32)),
  enabled: Schema.Boolean,
  // The URL of an HTTP/SSE server, or the command of a stdio server.
  target: OmpMcpText(2_048),
  scope: OmpMcpScope,
});
export type OmpMcpServer = typeof OmpMcpServer.Type;

/** A skill omp loads, from `get_available_commands`; `name` is without the `skill:` prefix. */
export const OmpMcpSkill = Schema.Struct({
  name: TrimmedNonEmptyString.check(Schema.isMaxLength(256)),
  description: Schema.optionalKey(OmpMcpText(1_024)),
});
export type OmpMcpSkill = typeof OmpMcpSkill.Type;

/**
 * Where omp runs: a project's workspace root, whose `.omp/mcp.json` adds project-scoped servers,
 * or no project, where only user-scoped servers apply.
 */
export const OmpMcpTarget = Schema.Struct({
  instanceId: ProviderInstanceId,
  projectId: Schema.optionalKey(ProjectId),
});
export type OmpMcpTarget = typeof OmpMcpTarget.Type;

export const OmpMcpListInput = OmpMcpTarget;
export type OmpMcpListInput = typeof OmpMcpListInput.Type;

export const OmpMcpListResult = Schema.Struct({
  servers: Schema.Array(OmpMcpServer).check(Schema.isMaxLength(200)),
  skills: Schema.Array(OmpMcpSkill).check(Schema.isMaxLength(500)),
});
export type OmpMcpListResult = typeof OmpMcpListResult.Type;

export const OmpMcpAddServerInput = Schema.Struct({
  ...OmpMcpTarget.fields,
  name: OmpMcpServerName,
  scope: OmpMcpScope,
  transport: OmpMcpTransport,
  // HTTP/SSE only.
  url: Schema.optionalKey(OmpMcpText(2_048)),
  // Write-only: a bearer token for HTTP/SSE. Never stored by K-code or echoed back.
  token: Schema.optionalKey(OmpMcpText(4_096)),
  // stdio only: the executable then its arguments.
  command: Schema.optionalKey(Schema.Array(OmpMcpText(4_096)).check(Schema.isMaxLength(64))),
});
export type OmpMcpAddServerInput = typeof OmpMcpAddServerInput.Type;

export const OmpMcpRemoveServerInput = Schema.Struct({
  ...OmpMcpTarget.fields,
  name: OmpMcpServerName,
  scope: OmpMcpScope,
});
export type OmpMcpRemoveServerInput = typeof OmpMcpRemoveServerInput.Type;

export const OmpMcpSetServerEnabledInput = Schema.Struct({
  ...OmpMcpTarget.fields,
  name: OmpMcpServerName,
  enabled: Schema.Boolean,
});
export type OmpMcpSetServerEnabledInput = typeof OmpMcpSetServerEnabledInput.Type;

/** What omp printed after a change, such as `Added MCP server "x" (project).` */
export const OmpMcpChangeResult = Schema.Struct({ message: OmpMcpText(1_024) });
export type OmpMcpChangeResult = typeof OmpMcpChangeResult.Type;

export const OmpMcpTestServerInput = Schema.Struct({
  ...OmpMcpTarget.fields,
  name: OmpMcpServerName,
});
export type OmpMcpTestServerInput = typeof OmpMcpTestServerInput.Type;

export const OmpMcpTestServerResult = Schema.Struct({
  connected: Schema.Boolean,
  tools: Schema.Array(OmpMcpText(256)).check(Schema.isMaxLength(500)),
  // The failure reason when not connected.
  message: Schema.optionalKey(OmpMcpText(1_024)),
});
export type OmpMcpTestServerResult = typeof OmpMcpTestServerResult.Type;

export const OmpMcpInspectInput = OmpMcpTarget;
export type OmpMcpInspectInput = typeof OmpMcpInspectInput.Type;

export const OmpMcpResource = Schema.Struct({
  server: OmpMcpText(256),
  uri: OmpMcpText(2_048),
});
export type OmpMcpResource = typeof OmpMcpResource.Type;

export const OmpMcpPrompt = Schema.Struct({
  server: OmpMcpText(256),
  name: OmpMcpText(256),
  description: Schema.optionalKey(OmpMcpText(1_024)),
});
export type OmpMcpPrompt = typeof OmpMcpPrompt.Type;

/** Resources and prompts of the connected servers, from `/mcp resources` and `/mcp prompts`. */
export const OmpMcpInspectResult = Schema.Struct({
  resources: Schema.Array(OmpMcpResource).check(Schema.isMaxLength(1_000)),
  prompts: Schema.Array(OmpMcpPrompt).check(Schema.isMaxLength(1_000)),
});
export type OmpMcpInspectResult = typeof OmpMcpInspectResult.Type;

const OmpMcpAuthFlowId = TrimmedNonEmptyString.check(Schema.isMaxLength(128));

/** One `/mcp reauth` OAuth flow for an instance; at most one runs at a time. */
export const OmpMcpAuthState = Schema.Struct({
  instanceId: ProviderInstanceId,
  phase: Schema.Literals(["idle", "starting", "waiting", "succeeded", "failed", "cancelled"]),
  flowId: Schema.NullOr(OmpMcpAuthFlowId),
  server: Schema.NullOr(OmpMcpText(256)),
  // The page that grants access. Its redirect returns to a loopback port on the omp host.
  authorizationUrl: Schema.NullOr(OmpMcpText(16_384)),
  // Tools the server offers once authorized.
  toolCount: Schema.NullOr(NonNegativeInt),
  message: Schema.NullOr(OmpMcpText(1_024)),
});
export type OmpMcpAuthState = typeof OmpMcpAuthState.Type;

export const OmpMcpAuthStartInput = Schema.Struct({
  ...OmpMcpTarget.fields,
  name: OmpMcpServerName,
});
export type OmpMcpAuthStartInput = typeof OmpMcpAuthStartInput.Type;

/**
 * Finishes a flow whose browser could not reach the omp host's loopback callback: the address the
 * browser ended on, which the server opens on the host. It must be the flow's own redirect URI.
 */
export const OmpMcpAuthCallbackInput = Schema.Struct({
  instanceId: ProviderInstanceId,
  flowId: OmpMcpAuthFlowId,
  // Write-only: carries the authorization code.
  callbackUrl: OmpMcpText(16_384),
});
export type OmpMcpAuthCallbackInput = typeof OmpMcpAuthCallbackInput.Type;

export const OmpMcpAuthCancelInput = Schema.Struct({
  instanceId: ProviderInstanceId,
  flowId: OmpMcpAuthFlowId,
});
export type OmpMcpAuthCancelInput = typeof OmpMcpAuthCancelInput.Type;

export const OmpMcpAuthSubscribeInput = Schema.Struct({ instanceId: ProviderInstanceId });
export type OmpMcpAuthSubscribeInput = typeof OmpMcpAuthSubscribeInput.Type;
