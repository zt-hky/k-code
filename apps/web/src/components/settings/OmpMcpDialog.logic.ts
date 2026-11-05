import type {
  OmpMcpAddServerInput,
  OmpMcpAuthState,
  OmpMcpScope,
  OmpMcpServer,
  OmpMcpSkill,
  OmpMcpTransport,
  ProjectId,
  ProviderInstanceId,
} from "@t3tools/contracts";
import { parseLocalhostAuthRedirect } from "@t3tools/shared/localhostAuthRedirect";

import type { LoginLocality } from "./OmpModelLoginSection.logic";

const OMP_MCP_NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
const MAX_NAME_LENGTH = 128;
const MAX_COMMAND_ARGUMENTS = 64;

export function isValidMcpServerName(name: string): boolean {
  return name.length <= MAX_NAME_LENGTH && OMP_MCP_NAME_PATTERN.test(name);
}

export type CommandLineSplit =
  | { readonly ok: true; readonly tokens: ReadonlyArray<string> }
  | { readonly ok: false; readonly reason: string };

/**
 * Splits a command line the way omp's `/mcp add` reads it: whitespace separates tokens, single
 * and double quotes group literally, and there are no backslash escapes.
 */
export function splitCommandLine(line: string): CommandLineSplit {
  const tokens: Array<string> = [];
  let current = "";
  let started = false;
  let quote: "'" | '"' | null = null;
  for (const char of line) {
    if (quote !== null) {
      if (char === quote) quote = null;
      else current += char;
      continue;
    }
    if (char === "'" || char === '"') {
      quote = char;
      started = true;
      continue;
    }
    if (/\s/.test(char)) {
      if (started) {
        if (current === "") return { ok: false, reason: "Empty quoted arguments are not allowed." };
        tokens.push(current);
        current = "";
        started = false;
      }
      continue;
    }
    current += char;
    started = true;
  }
  if (quote !== null) return { ok: false, reason: "A quote is not closed." };
  if (started) {
    if (current === "") return { ok: false, reason: "Empty quoted arguments are not allowed." };
    tokens.push(current);
  }
  return { ok: true, tokens };
}

export type McpTransportChoice = "http" | "sse" | "stdio";

export interface McpServerDraft {
  readonly name: string;
  readonly scope: OmpMcpScope;
  readonly transport: McpTransportChoice;
  readonly url: string;
  readonly token: string;
  readonly commandLine: string;
}

export const EMPTY_MCP_SERVER_DRAFT: McpServerDraft = {
  name: "",
  scope: "user",
  transport: "http",
  url: "",
  token: "",
  commandLine: "",
};

export type AddServerBuild =
  | { readonly ok: true; readonly input: OmpMcpAddServerInput }
  | { readonly ok: false; readonly reason: string };

function validUrl(value: string): boolean {
  try {
    const protocol = new URL(value).protocol;
    return protocol === "http:" || protocol === "https:";
  } catch {
    return false;
  }
}

export function buildAddServerInput(
  draft: McpServerDraft,
  target: { readonly instanceId: ProviderInstanceId; readonly projectId: ProjectId | null },
): AddServerBuild {
  const name = draft.name.trim();
  if (!isValidMcpServerName(name)) {
    return {
      ok: false,
      reason:
        "Use letters, numbers, dots, dashes, or underscores, starting with a letter or number.",
    };
  }
  if (draft.scope === "project" && target.projectId === null) {
    return { ok: false, reason: "Choose a project to add a project server." };
  }
  const base = {
    instanceId: target.instanceId,
    ...(target.projectId === null ? {} : { projectId: target.projectId }),
    name,
    scope: draft.scope,
  };
  if (draft.transport === "stdio") {
    const split = splitCommandLine(draft.commandLine);
    if (!split.ok) return split;
    if (split.tokens.length === 0) return { ok: false, reason: "Enter the command to run." };
    if (split.tokens.length > MAX_COMMAND_ARGUMENTS) {
      return { ok: false, reason: `Use at most ${MAX_COMMAND_ARGUMENTS} arguments.` };
    }
    return { ok: true, input: { ...base, transport: "stdio", command: split.tokens } };
  }
  const url = draft.url.trim();
  if (!validUrl(url)) return { ok: false, reason: "Enter an http(s) URL." };
  const token = draft.token.trim();
  if (/\s/.test(token)) return { ok: false, reason: "A token cannot contain spaces." };
  return {
    ok: true,
    input: {
      ...base,
      transport: draft.transport satisfies OmpMcpTransport,
      url,
      ...(token === "" ? {} : { token }),
    },
  };
}

export function filterMcpServers(
  servers: ReadonlyArray<OmpMcpServer>,
  query: string,
): ReadonlyArray<OmpMcpServer> {
  const needle = query.trim().toLowerCase();
  if (needle === "") return servers;
  return servers.filter((server) =>
    [server.name, server.transport, server.scope, server.target].some((field) =>
      field.toLowerCase().includes(needle),
    ),
  );
}

export function filterMcpSkills(
  skills: ReadonlyArray<OmpMcpSkill>,
  query: string,
): ReadonlyArray<OmpMcpSkill> {
  const needle = query.trim().toLowerCase();
  if (needle === "") return skills;
  return skills.filter(
    (skill) =>
      skill.name.toLowerCase().includes(needle) ||
      (skill.description ?? "").toLowerCase().includes(needle),
  );
}

export function canAuthorizeServer(server: OmpMcpServer): boolean {
  return server.transport === "http" || server.transport === "sse";
}

export function isMcpAuthActive(state: OmpMcpAuthState | null): boolean {
  return state?.phase === "starting" || state?.phase === "waiting";
}

/** The flow this client started, shown until it is dismissed. Another client's flow is not ours to show. */
export function visibleMcpAuthState(
  state: OmpMcpAuthState | null,
  startedFlowId: string | null,
  dismissedFlowId: string | null,
): OmpMcpAuthState | null {
  if (state === null || state.phase === "idle" || state.flowId === null) return null;
  if (state.flowId === dismissedFlowId) return null;
  return state.flowId === startedFlowId ? state : null;
}

/**
 * The authorization URL whose `localhost` redirect the desktop shell should catch, or null when the
 * omp host catches it itself or this client did not start the flow.
 */
export function mcpAuthBridgeUrl(
  state: OmpMcpAuthState | null,
  startedFlowId: string | null,
  locality: LoginLocality,
  hasDesktopBridge: boolean,
): string | null {
  if (!hasDesktopBridge || locality !== "remote" || state === null) return null;
  if (!isMcpAuthActive(state) || state.authorizationUrl === null) return null;
  if (state.flowId === null || state.flowId !== startedFlowId) return null;
  return parseLocalhostAuthRedirect(state.authorizationUrl) === null
    ? null
    : state.authorizationUrl;
}

export function mcpAuthSummary(state: OmpMcpAuthState): string {
  const server = state.server ?? "the server";
  switch (state.phase) {
    case "starting":
      return `Starting authorization for ${server}…`;
    case "waiting":
      return `Waiting for you to authorize ${server}…`;
    case "succeeded":
      return state.toolCount === null
        ? `Authorized ${server}`
        : `Authorized ${server} · ${state.toolCount} ${state.toolCount === 1 ? "tool" : "tools"}`;
    case "failed":
      return state.message ?? `Could not authorize ${server}`;
    case "cancelled":
      return `Authorization of ${server} was cancelled`;
    case "idle":
      return "";
  }
}
