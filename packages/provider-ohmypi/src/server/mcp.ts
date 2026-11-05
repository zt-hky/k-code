import {
  AcpRegistryOperationError,
  type OmpMcpAddServerInput,
  type OmpMcpAuthState,
  type OmpMcpInspectResult,
  type OmpMcpListResult,
  type OmpMcpPrompt,
  type OmpMcpResource,
  type OmpMcpServer,
  type OmpMcpSkill,
  type OmpMcpTestServerResult,
  type ProviderInstanceId,
  type ServerProviderSlashSubcommand,
} from "@t3tools/contracts";
import type { ProviderMcpManagement } from "@t3tools/provider-core/server/driver";
import * as SecureRandom from "effect/crypto/SecureRandom";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Fiber from "effect/Fiber";
import * as Ref from "effect/Ref";
import * as Scope from "effect/Scope";
import * as Semaphore from "effect/Semaphore";
import * as Stream from "effect/Stream";
import * as SubscriptionRef from "effect/SubscriptionRef";
import * as HttpClient from "effect/http/HttpClient";
import * as HttpClientRequest from "effect/http/HttpClientRequest";
import * as ChildProcessSpawner from "effect/process/ChildProcessSpawner";
import * as Schema from "effect/Schema";
import { stripAnsi } from "./ansi.ts";
import {
  OmpProcessError,
  openOmpManagementSession,
  withOmpManagementSession,
  type OmpSpawn,
} from "./process.ts";

const isAcpRegistryOperationError = Schema.is(AcpRegistryOperationError);
const FLOW_TIMEOUT = Duration.minutes(10);
const RPC_TIMEOUT = Duration.seconds(60);
const CALLBACK_TIMEOUT = Duration.seconds(15);
const MAX_MESSAGE = 1_024;
const MAX_SERVERS = 200;
const MAX_SKILLS = 500;
const MAX_TOOLS = 500;
const MAX_RESOURCES = 1_000;
const MAX_PROMPTS = 1_000;
const MAX_AUTHORIZATION_URL = 16_384;

const failure = (message: string) =>
  new AcpRegistryOperationError({ reason: "mcp_failed", message });

const cleanOutput = (outputs: ReadonlyArray<string>): string => stripAnsi(outputs.join("\n"));

const lines = (text: string): ReadonlyArray<string> =>
  text
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line !== "");

/** omp's own sentence, bounded: the first lines of what it printed. */
const boundedMessage = (text: string, fallback: string): string => {
  const message = lines(text).join("\n").slice(0, MAX_MESSAGE);
  return message === "" ? fallback : message;
};

/**
 * omp tokenizes `/mcp` arguments by whitespace; quotes group literally and there are no escapes.
 * A token it cannot carry (empty, multi-line, or holding both quote kinds with whitespace) is rejected.
 */
export const quoteMcpToken = (token: string): string | undefined => {
  if (token === "" || /[\r\n]/.test(token)) return undefined;
  if (!/[\s'"]/.test(token)) return token;
  if (!token.includes("'")) return `'${token}'`;
  if (!token.includes('"')) return `"${token}"`;
  return undefined;
};

const joinMcpCommand = (tokens: ReadonlyArray<string>): string | undefined => {
  const quoted: Array<string> = [];
  for (const token of tokens) {
    const next = quoteMcpToken(token);
    if (next === undefined) return undefined;
    quoted.push(next);
  }
  return quoted.join(" ");
};

export type OmpMcpCommandResult =
  | { readonly ok: true; readonly command: string }
  | { readonly ok: false; readonly message: string };

const UNQUOTABLE = "That value cannot be passed to Oh My Pi: it is empty or has a line break.";

export const buildMcpAddCommand = (
  input: Pick<OmpMcpAddServerInput, "name" | "scope" | "transport" | "url" | "token" | "command">,
): OmpMcpCommandResult => {
  const head = ["/mcp", "add", input.name, "--scope", input.scope];
  let tokens: ReadonlyArray<string>;
  if (input.transport === "stdio") {
    const command = input.command ?? [];
    if (command.length === 0) {
      return { ok: false, message: "A command is required for a stdio server." };
    }
    tokens = [...head, "--", ...command];
  } else {
    const url = input.url?.trim() ?? "";
    if (url === "") return { ok: false, message: "A URL is required for an HTTP or SSE server." };
    tokens = [
      ...head,
      "--url",
      url,
      "--transport",
      input.transport,
      ...(input.token === undefined || input.token === "" ? [] : ["--token", input.token]),
    ];
  }
  const command = joinMcpCommand(tokens);
  return command === undefined ? { ok: false, message: UNQUOTABLE } : { ok: true, command };
};

const SERVER_LINE = /^(.+?) \| (\S+) \| (enabled|disabled) \| (.*) \[(user|project)\]$/;

/** `/mcp list` output → servers; lines in any other shape are ignored. */
export const parseMcpServers = (text: string): ReadonlyArray<OmpMcpServer> => {
  const servers: Array<OmpMcpServer> = [];
  for (const line of lines(text)) {
    const match = SERVER_LINE.exec(line);
    if (match === null) continue;
    servers.push({
      name: match[1]!.trim().slice(0, 256),
      transport: match[2]!.slice(0, 32),
      enabled: match[3] === "enabled",
      target: match[4]!.trim().slice(0, 2_048),
      scope: match[5] as OmpMcpServer["scope"],
    });
    if (servers.length === MAX_SERVERS) break;
  }
  return servers;
};

const CONNECTED = /^Server ".*" connected \((\d+) tools?\)/;
const TOOL_LINE = /^- (.+)$/;

/** `/mcp test` output → whether the server connected, and the tools it offers. */
export const parseMcpTest = (text: string): OmpMcpTestServerResult => {
  const all = lines(text);
  if (all.length > 0 && CONNECTED.test(all[0]!)) {
    const tools: Array<string> = [];
    for (const line of all.slice(1)) {
      const tool = TOOL_LINE.exec(line)?.[1];
      if (tool === undefined) continue;
      tools.push(tool.slice(0, 256));
      if (tools.length === MAX_TOOLS) break;
    }
    return { connected: true, tools };
  }
  return {
    connected: false,
    tools: [],
    message: boundedMessage(text, "Oh My Pi did not report a result."),
  };
};

/** `/mcp resources` output: `server/uri` per line. */
export const parseMcpResources = (text: string): ReadonlyArray<OmpMcpResource> => {
  const resources: Array<OmpMcpResource> = [];
  for (const line of lines(text)) {
    if (line.startsWith("No ")) continue;
    const slash = line.indexOf("/");
    if (slash <= 0) continue;
    resources.push({
      server: line.slice(0, slash).slice(0, 256),
      uri: line.slice(slash + 1).slice(0, 2_048),
    });
    if (resources.length === MAX_RESOURCES) break;
  }
  return resources;
};

/** `/mcp prompts` output: `server/name — description` per line. */
export const parseMcpPrompts = (text: string): ReadonlyArray<OmpMcpPrompt> => {
  const prompts: Array<OmpMcpPrompt> = [];
  for (const line of lines(text)) {
    if (line.startsWith("No ")) continue;
    // oxlint-disable-next-line t3code/no-em-dash-copy -- omp separates a prompt from its description with one.
    const dash = line.indexOf(" — ");
    const target = dash === -1 ? line : line.slice(0, dash);
    const description = dash === -1 ? "" : line.slice(dash + 3).trim();
    const slash = target.indexOf("/");
    if (slash <= 0 || slash === target.length - 1) continue;
    prompts.push({
      server: target.slice(0, slash).slice(0, 256),
      name: target.slice(slash + 1).slice(0, 256),
      ...(description === "" ? {} : { description: description.slice(0, MAX_MESSAGE) }),
    });
    if (prompts.length === MAX_PROMPTS) break;
  }
  return prompts;
};

export type OmpMcpReauthEvent =
  | { readonly _tag: "authorization"; readonly url: string }
  | { readonly _tag: "connected"; readonly toolCount: number }
  | { readonly _tag: "cancelled" }
  | { readonly _tag: "failed"; readonly message: string };

const REAUTH_CONNECTED = /^".*" connected \((\d+) tools?\)/;
const REAUTH_FAILED = /^Failed to reauthorize server ".*": (.*)$/;
const URL_TOKEN = /https?:\/\/\S+/;

export interface OmpMcpReauthScanner {
  /** Feed one `command_output` text; returns the events its lines complete. */
  readonly push: (text: string) => ReadonlyArray<OmpMcpReauthEvent>;
}

/**
 * `/mcp reauth` prints "Opening your browser to authorize. If it did not open:" and the URL, either
 * in the same output or the next one, then reports how the flow ended.
 */
export const makeMcpReauthScanner = (): OmpMcpReauthScanner => {
  let awaitingUrl = false;
  return {
    push: (text) => {
      const events: Array<OmpMcpReauthEvent> = [];
      for (const line of lines(stripAnsi(text))) {
        if (line.includes("Opening your browser")) {
          const url = URL_TOKEN.exec(line)?.[0];
          if (url === undefined) awaitingUrl = true;
          else events.push({ _tag: "authorization", url });
          continue;
        }
        if (awaitingUrl) {
          const url = /^https?:\/\/\S+$/.exec(line)?.[0];
          if (url !== undefined) {
            awaitingUrl = false;
            events.push({ _tag: "authorization", url });
            continue;
          }
        }
        const connected = REAUTH_CONNECTED.exec(line);
        if (connected !== null) {
          events.push({ _tag: "connected", toolCount: Number(connected[1]) });
          continue;
        }
        if (line.startsWith("Reauthorization cancelled")) {
          events.push({ _tag: "cancelled" });
          continue;
        }
        const failed = REAUTH_FAILED.exec(line);
        if (failed !== null) {
          events.push({
            _tag: "failed",
            message: boundedMessage(failed[1]!, "Authorization failed."),
          });
        }
      }
      return events;
    },
  };
};

const isLoopbackHost = (hostname: string) =>
  hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]";

/** The loopback `redirect_uri` an authorization page returns to, or undefined if it has none. */
export const loopbackRedirectUri = (authorizationUrl: string): URL | undefined => {
  try {
    const redirect = new URL(authorizationUrl).searchParams.get("redirect_uri");
    if (redirect === null) return undefined;
    const url = new URL(redirect);
    return url.protocol === "http:" && isLoopbackHost(url.hostname) ? url : undefined;
  } catch {
    return undefined;
  }
};

/**
 * The address a user pasted, if it is the flow's own redirect URI (same host, port and path):
 * the server opens it on the omp host, so nothing else may pass.
 */
export const validateMcpCallback = (redirect: URL, callbackUrl: string): URL | undefined => {
  try {
    const url = new URL(callbackUrl.trim());
    return url.protocol === redirect.protocol &&
      url.hostname === redirect.hostname &&
      url.port === redirect.port &&
      url.pathname === redirect.pathname &&
      url.username === "" &&
      url.password === ""
      ? url
      : undefined;
  } catch {
    return undefined;
  }
};

interface OmpCommandEntry {
  readonly name: string;
  readonly description?: string;
  readonly source?: string;
  readonly subcommands: ReadonlyArray<ServerProviderSlashSubcommand>;
}

const asRecord = (value: unknown): Readonly<Record<string, unknown>> | undefined =>
  typeof value === "object" && value !== null ? (value as Record<string, unknown>) : undefined;

const text = (value: unknown, max: number): string | undefined =>
  typeof value === "string" && value.trim() !== "" ? value.trim().slice(0, max) : undefined;

/** `get_available_commands` response data → commands with their subcommands. */
const parseOmpCommands = (data: unknown): ReadonlyArray<OmpCommandEntry> => {
  const commands = asRecord(data)?.commands;
  if (!Array.isArray(commands)) return [];
  const entries: Array<OmpCommandEntry> = [];
  for (const raw of commands) {
    const command = asRecord(raw);
    const name = text(command?.name, 256);
    if (command === undefined || name === undefined) continue;
    const description = text(command.description, MAX_MESSAGE);
    const source = text(command.source, 64);
    const subcommands: Array<ServerProviderSlashSubcommand> = [];
    if (Array.isArray(command.subcommands)) {
      for (const rawSub of command.subcommands) {
        const sub = asRecord(rawSub);
        const subName = text(sub?.name, 256);
        if (sub === undefined || subName === undefined) continue;
        const subDescription = text(sub.description, MAX_MESSAGE);
        const usage = text(sub.usage, MAX_MESSAGE);
        subcommands.push({
          name: subName,
          ...(subDescription === undefined ? {} : { description: subDescription }),
          ...(usage === undefined ? {} : { usage }),
        });
      }
    }
    entries.push({
      name,
      ...(description === undefined ? {} : { description }),
      ...(source === undefined ? {} : { source }),
      subcommands,
    });
  }
  return entries;
};

type InputOf<K extends keyof ProviderMcpManagement> = ProviderMcpManagement[K] extends (
  input: infer I,
) => unknown
  ? I
  : never;

const SKILL_PREFIX = "skill:";

const ompSkillsFromCommands = (
  commands: ReadonlyArray<OmpCommandEntry>,
): ReadonlyArray<OmpMcpSkill> => {
  const seen = new Set<string>();
  const skills: Array<OmpMcpSkill> = [];
  for (const command of commands) {
    if (command.source !== "skill" || !command.name.startsWith(SKILL_PREFIX)) continue;
    const name = command.name.slice(SKILL_PREFIX.length).trim();
    if (name === "" || seen.has(name)) continue;
    seen.add(name);
    skills.push({
      name,
      ...(command.description === undefined ? {} : { description: command.description }),
    });
    if (skills.length === MAX_SKILLS) break;
  }
  return skills;
};

const subcommandCatalog = (
  commands: ReadonlyArray<OmpCommandEntry>,
): ReadonlyMap<string, ReadonlyArray<ServerProviderSlashSubcommand>> =>
  new Map(
    commands
      .filter((command) => command.source === "builtin" && command.subcommands.length > 0)
      .map((command) => [command.name, command.subcommands] as const),
  );

interface ActiveFlow {
  readonly flowId: string;
  readonly scope: Scope.Closeable;
  fiber: Fiber.Fiber<void> | undefined;
  cancelled: boolean;
  redirect: URL | undefined;
}

/**
 * MCP server and skill management for one Oh My Pi instance. Everything runs through omp's own
 * `/mcp` commands over `omp --mode rpc`; K-code never reads or writes omp's config files, and
 * tokens and OAuth callback URLs never reach a log or span attribute.
 */
export const makeOmpMcp = Effect.fn("OmpMcp.make")(function* (options: {
  readonly instanceId: ProviderInstanceId;
  /** `undefined` is no project: a neutral directory where only user-scoped servers apply. */
  readonly resolveSpawn: (
    cwd: string | undefined,
  ) => Effect.Effect<OmpSpawn, AcpRegistryOperationError>;
}) {
  const instanceScope = yield* Scope.Scope;
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
  const random = yield* SecureRandom.SecureRandom;
  const httpClient = yield* HttpClient.HttpClient;
  const lock = yield* Semaphore.make(1);
  const idle: OmpMcpAuthState = {
    instanceId: options.instanceId,
    phase: "idle",
    flowId: null,
    server: null,
    authorizationUrl: null,
    toolCount: null,
    message: null,
  };
  const state = yield* SubscriptionRef.make(idle);
  const catalog = yield* Ref.make<
    ReadonlyMap<string, ReadonlyArray<ServerProviderSlashSubcommand>> | undefined
  >(undefined);
  let active: ActiveFlow | undefined;

  const publishFor = (flow: ActiveFlow, patch: Partial<OmpMcpAuthState>) =>
    Effect.suspend(() =>
      active === flow
        ? SubscriptionRef.update(state, (current) => ({ ...current, ...patch }))
        : Effect.void,
    );

  const rpc = <A>(
    cwd: string | undefined,
    timeoutMessage: string,
    use: (
      session: Parameters<Parameters<typeof withOmpManagementSession>[1]>[0],
    ) => Effect.Effect<A, OmpProcessError>,
  ) =>
    options.resolveSpawn(cwd).pipe(
      Effect.flatMap((spawn) => withOmpManagementSession(spawn, use)),
      Effect.provideService(ChildProcessSpawner.ChildProcessSpawner, spawner),
      Effect.catchTags({ OmpProcessError: (error) => Effect.fail(failure(error.detail)) }),
      Effect.timeoutOrElse({
        duration: RPC_TIMEOUT,
        orElse: () => Effect.fail(failure(timeoutMessage)),
      }),
    );

  const requireProject = (scope: "user" | "project", cwd: string | undefined) =>
    scope === "project" && cwd === undefined
      ? Effect.fail(failure("Pick a project to change project-scoped servers."))
      : Effect.void;

  const change = (
    cwd: string | undefined,
    command: string,
    succeeded: RegExp,
    timeoutMessage: string,
  ) =>
    rpc(cwd, timeoutMessage, (session) => session.prompt(command)).pipe(
      Effect.flatMap((outputs) => {
        const output = cleanOutput(outputs);
        return succeeded.test(output.trim())
          ? Effect.succeed({ message: boundedMessage(output, "Done.") })
          : Effect.fail(failure(boundedMessage(output, "Oh My Pi did not report a result.")));
      }),
    );

  const quoted = (tokens: ReadonlyArray<string>) => {
    const command = joinMcpCommand(tokens);
    return command === undefined ? Effect.fail(failure(UNQUOTABLE)) : Effect.succeed(command);
  };

  const finish = Effect.fn("OmpMcp.finishFlow")(function* (
    flow: ActiveFlow,
    patch: Partial<OmpMcpAuthState>,
  ) {
    yield* Scope.close(flow.scope, Exit.void);
    yield* publishFor(flow, patch);
    if (active === flow) active = undefined;
  });

  const runFlow = Effect.fn("OmpMcp.runFlow")(function* (
    flow: ActiveFlow,
    spawn: OmpSpawn,
    command: string,
  ) {
    const outcome = yield* Effect.gen(function* () {
      const session = yield* openOmpManagementSession(spawn).pipe(
        Effect.provideService(ChildProcessSpawner.ChildProcessSpawner, spawner),
      );
      const scanner = makeMcpReauthScanner();
      let terminal: OmpMcpReauthEvent | undefined;
      const handle = (event: OmpMcpReauthEvent) => {
        if (event._tag !== "authorization") {
          terminal = event;
          return Effect.succeed(false);
        }
        if (event.url.length > MAX_AUTHORIZATION_URL) {
          terminal = { _tag: "failed", message: "The authorization address is too long." };
          return Effect.succeed(false);
        }
        flow.redirect = loopbackRedirectUri(event.url);
        return publishFor(flow, { phase: "waiting", authorizationUrl: event.url }).pipe(
          Effect.as(true),
        );
      };
      const initial = yield* session.prompt(command);
      for (const event of scanner.push(cleanOutput(initial))) {
        if (!(yield* handle(event))) break;
      }
      if (terminal === undefined) {
        yield* session.lateOutputs.pipe(
          Stream.flatMap((output) => Stream.fromIterable(scanner.push(output))),
          Stream.runForEachWhile(handle),
        );
      }
      return (
        terminal ?? {
          _tag: "failed" as const,
          message: "Oh My Pi stopped before authorization finished.",
        }
      );
    }).pipe(
      Effect.provideService(Scope.Scope, flow.scope),
      Effect.timeoutOrElse({
        duration: FLOW_TIMEOUT,
        orElse: () =>
          Effect.fail(new OmpProcessError({ detail: "Authorization timed out. Start again." })),
      }),
      Effect.catchTags({
        OmpProcessError: (error) =>
          Effect.succeed({ _tag: "failed" as const, message: error.detail }),
      }),
      Effect.catchCause(() =>
        Effect.succeed({
          _tag: "failed" as const,
          message: "Authorization failed. Start again.",
        }),
      ),
    );
    if (flow.cancelled || outcome._tag === "cancelled") {
      return yield* finish(flow, {
        phase: "cancelled",
        authorizationUrl: null,
        message: null,
      });
    }
    if (outcome._tag === "connected") {
      return yield* finish(flow, {
        phase: "succeeded",
        authorizationUrl: null,
        toolCount: outcome.toolCount,
        message: null,
      });
    }
    return yield* finish(flow, {
      phase: "failed",
      authorizationUrl: null,
      message: outcome._tag === "failed" ? outcome.message : null,
    });
  });

  const resolveCatalog = Effect.gen(function* () {
    const cached = yield* Ref.get(catalog);
    if (cached !== undefined) return cached;
    const commands = yield* rpc(undefined, "Reading Oh My Pi's commands timed out.", (session) =>
      session.command({ type: "get_available_commands" }),
    );
    const loaded = subcommandCatalog(parseOmpCommands(commands));
    yield* Ref.set(catalog, loaded);
    return loaded;
  });

  return {
    list: Effect.fn("OmpMcp.list")(function* (cwd: InputOf<"list">) {
      return yield* rpc(cwd, "Listing MCP servers timed out.", (session) =>
        Effect.gen(function* () {
          const commands = parseOmpCommands(
            yield* session.command({ type: "get_available_commands" }),
          );
          const output = cleanOutput(yield* session.prompt("/mcp list"));
          return {
            servers: parseMcpServers(output),
            skills: ompSkillsFromCommands(commands),
          } satisfies OmpMcpListResult;
        }),
      );
    }),
    addServer: Effect.fn("OmpMcp.addServer")(function* (input: InputOf<"addServer">) {
      yield* requireProject(input.scope, input.cwd);
      const built = buildMcpAddCommand(input);
      if (!built.ok) return yield* failure(built.message);
      return yield* change(
        input.cwd,
        built.command,
        /^Added MCP server/,
        "Adding the MCP server timed out.",
      );
    }),
    removeServer: Effect.fn("OmpMcp.removeServer")(function* (input: InputOf<"removeServer">) {
      yield* requireProject(input.scope, input.cwd);
      const command = yield* quoted(["/mcp", "remove", input.name, "--scope", input.scope]);
      return yield* change(
        input.cwd,
        command,
        /^Removed server/,
        "Removing the MCP server timed out.",
      );
    }),
    setServerEnabled: Effect.fn("OmpMcp.setServerEnabled")(function* (
      input: InputOf<"setServerEnabled">,
    ) {
      const command = yield* quoted(["/mcp", input.enabled ? "enable" : "disable", input.name]);
      return yield* change(
        input.cwd,
        command,
        /^Server ".*" (enabled|disabled)/,
        "Changing the MCP server timed out.",
      );
    }),
    testServer: Effect.fn("OmpMcp.testServer")(function* (input: InputOf<"testServer">) {
      const command = yield* quoted(["/mcp", "test", input.name]);
      const outputs = yield* rpc(input.cwd, "Testing the MCP server timed out.", (session) =>
        session.prompt(command),
      );
      return parseMcpTest(cleanOutput(outputs));
    }),
    inspect: Effect.fn("OmpMcp.inspect")(function* (cwd) {
      return yield* rpc(cwd, "Reading MCP resources timed out.", (session) =>
        Effect.gen(function* () {
          const resources = cleanOutput(yield* session.prompt("/mcp resources"));
          const prompts = cleanOutput(yield* session.prompt("/mcp prompts"));
          return {
            resources: parseMcpResources(resources),
            prompts: parseMcpPrompts(prompts),
          } satisfies OmpMcpInspectResult;
        }),
      );
    }),
    startAuth: Effect.fn("OmpMcp.startAuth")(function* (input: InputOf<"startAuth">) {
      const command = yield* quoted(["/mcp", "reauth", input.name]);
      const spawn = yield* options.resolveSpawn(input.cwd);
      return yield* lock.withPermit(
        Effect.gen(function* () {
          if (active !== undefined) {
            return yield* failure("Another authorization is already in progress.");
          }
          const flowId = yield* random
            .uuidV4()
            .pipe(Effect.mapError(() => failure("Could not start authorization.")));
          const scope = yield* Scope.fork(instanceScope, "sequential");
          const flow: ActiveFlow = {
            flowId,
            scope,
            fiber: undefined,
            cancelled: false,
            redirect: undefined,
          };
          active = flow;
          yield* SubscriptionRef.set(state, {
            ...idle,
            phase: "starting",
            flowId,
            server: input.name,
          });
          flow.fiber = yield* runFlow(flow, spawn, command).pipe(Effect.forkIn(instanceScope));
          return yield* SubscriptionRef.get(state);
        }),
      );
    }),
    completeAuth: Effect.fn("OmpMcp.completeAuth")(function* (input: {
      readonly flowId: string;
      readonly callbackUrl: string;
    }) {
      const target = yield* lock.withPermit(
        Effect.gen(function* () {
          if (active === undefined || active.flowId !== input.flowId) {
            return yield* new AcpRegistryOperationError({
              reason: "mcp_auth_stale_flow",
              message: "This authorization is no longer active.",
            });
          }
          if (active.redirect === undefined) {
            return yield* failure("This authorization has no local address to finish on.");
          }
          const url = validateMcpCallback(active.redirect, input.callbackUrl);
          if (url === undefined) {
            return yield* failure("That address is not this authorization's redirect.");
          }
          return url;
        }),
      );
      yield* httpClient.execute(HttpClientRequest.get(target.toString())).pipe(
        Effect.timeoutOrElse({
          duration: CALLBACK_TIMEOUT,
          orElse: () => Effect.fail(failure("Oh My Pi did not answer the callback.")),
        }),
        Effect.mapError((error) =>
          isAcpRegistryOperationError(error)
            ? error
            : failure("Could not reach Oh My Pi's callback address."),
        ),
        Effect.flatMap((response) =>
          response.status >= 500
            ? Effect.fail(failure("Oh My Pi's callback address rejected the request."))
            : Effect.void,
        ),
      );
      return yield* SubscriptionRef.get(state);
    }),
    cancelAuth: Effect.fn("OmpMcp.cancelAuth")(function* (flowId: string) {
      const flow = yield* lock.withPermit(
        Effect.sync(() => {
          if (active === undefined || active.flowId !== flowId) return undefined;
          active.cancelled = true;
          return active;
        }),
      );
      if (flow !== undefined) {
        yield* Scope.close(flow.scope, Exit.void);
        if (flow.fiber !== undefined) yield* Fiber.await(flow.fiber);
      }
      return yield* SubscriptionRef.get(state);
    }),
    authState: SubscriptionRef.changes(state),
    subcommandCatalog: resolveCatalog,
    cachedSubcommandCatalog: Ref.get(catalog),
  } satisfies ProviderMcpManagement;
});
