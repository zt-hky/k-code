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

import { stripAnsi } from "./ompAnsi.ts";

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

export type OmpRpcCall = (
  command: { readonly type: string } & Readonly<Record<string, unknown>>,
) => Effect.Effect<unknown, OmpProcessError>;

const asRecord = (value: unknown): Readonly<Record<string, unknown>> | undefined =>
  typeof value === "object" && value !== null ? (value as Record<string, unknown>) : undefined;

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
      const child = yield* spawnOmp(spawn, RPC_ARGS);
      const responses = yield* Queue.unbounded<Readonly<Record<string, unknown>>, Cause.Done>();
      let stderr = "";
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
          return record?.type === "response" ? Queue.offer(responses, record) : Effect.void;
        }),
        Effect.andThen(Queue.end(responses)),
        Effect.forkScoped,
      );
      let nextId = 0;
      const call: OmpRpcCall = Effect.fn("OmpProcess.rpcCall")(function* (command) {
        const id = String(++nextId);
        yield* child.write(`${encodeJson({ ...command, id })}\n`);
        while (true) {
          const response = yield* Queue.take(responses).pipe(
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
                typeof response.error === "string"
                  ? response.error
                  : "Oh My Pi rejected the request.",
            });
          }
          return response.data;
        }
      });
      return yield* use(call);
    }),
  );
});
