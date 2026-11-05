import { resolveSpawnCommand } from "@t3tools/shared/shell";
import * as Cause from "effect/Cause";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Queue from "effect/Queue";
import * as Schema from "effect/Schema";
import * as Scope from "effect/Scope";
import * as Stream from "effect/Stream";
import * as ChildProcess from "effect/process/ChildProcess";
import * as ChildProcessSpawner from "effect/process/ChildProcessSpawner";

import { stripAnsi } from "./ansi.ts";

/** Where an instance's omp runs: the executable the ACP session uses, with the same environment. */
export interface OmpSpawn {
  readonly command: string;
  readonly env: NodeJS.ProcessEnv;
  readonly cwd: string;
}

export class OmpProcessError extends Schema.TaggedError<OmpProcessError>()("OmpProcessError", {
  detail: Schema.String,
}) {}

const encoder = new TextEncoder();
const decodeJson = Schema.decodeUnknownOption(Schema.fromJsonString(Schema.Unknown));
const encodeJson = Schema.encodeUnknownSync(Schema.fromJsonString(Schema.Unknown));
const MAX_STDERR = 2_048;

// RPC mode needs a catalog model to start even though no turn runs; omp matches "sonnet" fuzzily.
// Extensions, skills and LSP stay off so listing providers does not execute user code.
const RPC_ARGS = [
  "--mode",
  "rpc",
  "--model",
  "sonnet",
  "--no-session",
  "--no-extensions",
  "--no-skills",
  "--no-rules",
  "--no-context-files",
  "--no-lsp",
  "--no-tools",
  "--no-ui",
] as const;

export interface OmpChild {
  readonly stdout: Stream.Stream<string>;
  readonly stderr: Stream.Stream<string>;
  /** Writes whole text to stdin; stdin stays open until the child's scope closes. */
  readonly write: (text: string) => Effect.Effect<void>;
  /** Ends stdin, for commands that read until end of input. */
  readonly endInput: Effect.Effect<void>;
  readonly exitCode: Effect.Effect<number>;
}

export const spawnOmp = Effect.fn("OmpProcess.spawn")(function* (
  spawn: OmpSpawn,
  args: ReadonlyArray<string>,
): Effect.fn.Return<
  OmpChild,
  OmpProcessError,
  ChildProcessSpawner.ChildProcessSpawner | Scope.Scope
> {
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
  const resolved = yield* resolveSpawnCommand(spawn.command, args, {
    env: spawn.env,
    extendEnv: true,
  });
  const child = yield* spawner
    .spawn(
      ChildProcess.make(resolved.command, resolved.args, {
        cwd: spawn.cwd,
        env: spawn.env,
        extendEnv: true,
        shell: resolved.shell,
      }),
    )
    .pipe(Effect.mapError(() => new OmpProcessError({ detail: "Could not start Oh My Pi." })));
  yield* Effect.addFinalizer(() => child.kill().pipe(Effect.ignore));
  const stdin = yield* Queue.unbounded<Uint8Array, Cause.Done>();
  yield* Stream.fromQueue(stdin).pipe(Stream.run(child.stdin), Effect.ignore, Effect.forkScoped);
  return {
    stdout: Stream.decodeText(child.stdout).pipe(Stream.orDie),
    stderr: Stream.decodeText(child.stderr).pipe(Stream.orDie),
    write: (text) => Queue.offer(stdin, encoder.encode(text)).pipe(Effect.asVoid),
    endInput: Queue.end(stdin).pipe(Effect.asVoid),
    exitCode: child.exitCode.pipe(
      Effect.map(Number),
      Effect.orElseSucceed(() => -1),
    ),
  };
});

/** First stderr line, which is where omp reports why it refused to start. */
const firstStderrLine = (stderr: string): string | undefined =>
  stripAnsi(stderr.slice(0, MAX_STDERR))
    .split("\n")
    .map((line) => line.trim())
    .find((line) => line !== "");

export type OmpRpcCommand = { readonly type: string } & Readonly<Record<string, unknown>>;

export type OmpRpcCall = (command: OmpRpcCommand) => Effect.Effect<unknown, OmpProcessError>;

const asRecord = (value: unknown): Readonly<Record<string, unknown>> | undefined =>
  typeof value === "object" && value !== null ? (value as Record<string, unknown>) : undefined;

// Every `/mcp` command is answered by text events, so management sessions keep a bounded copy.
const MAX_COMMAND_OUTPUT = 262_144;

interface OmpRpcSession {
  /** Resolves with the response's `data` and the `command_output` texts emitted before it. */
  readonly call: (command: OmpRpcCommand) => Effect.Effect<
    {
      readonly data: unknown;
      readonly outputs: ReadonlyArray<string>;
    },
    OmpProcessError
  >;
  /** `command_output` texts that arrive while no call is waiting, such as a reauth's progress. */
  readonly lateOutputs: Stream.Stream<string>;
}

const openRpcSession = Effect.fn("OmpProcess.openRpcSession")(function* (
  spawn: OmpSpawn,
  args: ReadonlyArray<string>,
): Effect.fn.Return<
  OmpRpcSession,
  OmpProcessError,
  ChildProcessSpawner.ChildProcessSpawner | Scope.Scope
> {
  const child = yield* spawnOmp(spawn, args);
  const responses = yield* Queue.unbounded<
    {
      readonly response: Readonly<Record<string, unknown>>;
      readonly outputs: ReadonlyArray<string>;
    },
    Cause.Done
  >();
  const lateOutputs = yield* Queue.unbounded<string, Cause.Done>();
  let stderr = "";
  let collecting: Array<string> | undefined;
  let collectedSize = 0;
  yield* child.stderr.pipe(
    Stream.runForEach((text) =>
      Effect.sync(() => {
        if (stderr.length < MAX_STDERR) stderr += text;
      }),
    ),
    Effect.forkScoped,
  );
  yield* child.stdout.pipe(
    Stream.splitLines,
    Stream.runForEach((line) => {
      const record = asRecord(Option.getOrUndefined(decodeJson(line)));
      if (record?.type === "command_output" && typeof record.text === "string") {
        if (collecting === undefined) return Queue.offer(lateOutputs, record.text);
        if (collectedSize < MAX_COMMAND_OUTPUT) {
          collecting.push(record.text);
          collectedSize += record.text.length;
        }
        return Effect.void;
      }
      if (record?.type === "response") {
        const outputs = collecting ?? [];
        collecting = undefined;
        return Queue.offer(responses, { response: record, outputs });
      }
      return Effect.void;
    }),
    Effect.andThen(Queue.end(responses)),
    Effect.andThen(Queue.end(lateOutputs)),
    Effect.forkScoped,
  );
  let nextId = 0;
  const call: OmpRpcSession["call"] = Effect.fn("OmpProcess.rpcCall")(function* (command) {
    const id = String(++nextId);
    collecting = [];
    collectedSize = 0;
    yield* child.write(`${encodeJson({ ...command, id })}\n`);
    while (true) {
      const { response, outputs } = yield* Queue.take(responses).pipe(
        Effect.mapError(
          () =>
            new OmpProcessError({
              detail: firstStderrLine(stderr) ?? "Oh My Pi exited before it answered.",
            }),
        ),
      );
      if (response.id !== id) continue;
      if (response.success !== true) {
        return yield* new OmpProcessError({
          detail:
            typeof response.error === "string" ? response.error : "Oh My Pi rejected the request.",
        });
      }
      return { data: response.data, outputs };
    }
  });
  return { call, lateOutputs: Stream.fromQueue(lateOutputs) };
});

/**
 * Runs `use` against one short-lived `omp --mode rpc` process. Commands run one at a time and
 * resolve with the response's `data`; a failed response or an early exit fails the call.
 */
export const withOmpRpc = Effect.fn("OmpProcess.withRpc")(function* <A, E>(
  spawn: OmpSpawn,
  use: (call: OmpRpcCall) => Effect.Effect<A, E>,
): Effect.fn.Return<A, E | OmpProcessError, ChildProcessSpawner.ChildProcessSpawner> {
  return yield* Effect.scoped(
    Effect.gen(function* () {
      const session = yield* openRpcSession(spawn, RPC_ARGS);
      return yield* use((command) => session.call(command).pipe(Effect.map(({ data }) => data)));
    }),
  );
});

// Management keeps extensions and skills on so plugin skills are listed; `--no-tools` stops omp from
// connecting every MCP server at startup, and `/mcp test|resources|prompts` connect on demand.
const MANAGEMENT_ARGS = [
  "--mode",
  "rpc",
  "--model",
  "sonnet",
  "--no-session",
  "--no-rules",
  "--no-context-files",
  "--no-lsp",
  "--no-tools",
  "--no-ui",
] as const;

export interface OmpManagementSession {
  readonly command: OmpRpcCall;
  /**
   * Runs one slash command and resolves with what it printed. Only commands the caller built from
   * a known list may be sent: an unknown slash command starts a model turn, which is aborted and
   * fails the call.
   */
  readonly prompt: (message: string) => Effect.Effect<ReadonlyArray<string>, OmpProcessError>;
  readonly lateOutputs: Stream.Stream<string>;
}

/** Opens a scoped management process: the session lives until the surrounding scope closes. */
export const openOmpManagementSession = Effect.fn("OmpProcess.openManagementSession")(function* (
  spawn: OmpSpawn,
): Effect.fn.Return<
  OmpManagementSession,
  OmpProcessError,
  ChildProcessSpawner.ChildProcessSpawner | Scope.Scope
> {
  const session = yield* openRpcSession(spawn, MANAGEMENT_ARGS);
  const prompt: OmpManagementSession["prompt"] = Effect.fn("OmpProcess.managementPrompt")(
    function* (message) {
      const { data, outputs } = yield* session.call({ type: "prompt", message });
      if (asRecord(data)?.agentInvoked === true) {
        yield* session.call({ type: "abort" }).pipe(Effect.ignore);
        return yield* new OmpProcessError({
          detail: "Oh My Pi did not recognise that command.",
        });
      }
      return outputs;
    },
  );
  return {
    command: (command) => session.call(command).pipe(Effect.map(({ data }) => data)),
    prompt,
    lateOutputs: session.lateOutputs,
  };
});

/** Runs `use` against one short-lived management process. */
export const withOmpManagementSession = Effect.fn("OmpProcess.withManagementSession")(function* <
  A,
  E,
>(
  spawn: OmpSpawn,
  use: (session: OmpManagementSession) => Effect.Effect<A, E>,
): Effect.fn.Return<A, E | OmpProcessError, ChildProcessSpawner.ChildProcessSpawner> {
  return yield* Effect.scoped(
    Effect.gen(function* () {
      return yield* use(yield* openOmpManagementSession(spawn));
    }),
  );
});
