import { ProviderInstanceId, type OmpLoginState } from "@t3tools/contracts";
import * as Cause from "effect/Cause";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Queue from "effect/Queue";
import * as Ref from "effect/Ref";
import * as Sink from "effect/Sink";
import * as Stream from "effect/Stream";
import * as ChildProcessSpawner from "effect/process/ChildProcessSpawner";

import { makeOmpLogin } from "./login.ts";

const encoder = new TextEncoder();
const decoder = new TextDecoder();

export interface FakeChild {
  readonly args: ReadonlyArray<string>;
  readonly written: Queue.Queue<string>;
  killed: boolean;
  readonly emit: (text: string) => Effect.Effect<void>;
  readonly emitStderr: (text: string) => Effect.Effect<void>;
  readonly exit: (code: number) => Effect.Effect<void>;
}

export const makeHarness = (script?: (child: FakeChild, written: string) => Effect.Effect<void>) =>
  Effect.gen(function* () {
    const children: Array<FakeChild> = [];
    const spawned = yield* Queue.unbounded<FakeChild>();
    const spawner = ChildProcessSpawner.make((command) =>
      Effect.gen(function* () {
        const { args } = command as unknown as { readonly args: ReadonlyArray<string> };
        const stdout = yield* Queue.unbounded<Uint8Array, Cause.Done>();
        const stderr = yield* Queue.unbounded<Uint8Array, Cause.Done>();
        const exited = yield* Deferred.make<ChildProcessSpawner.ExitCode>();
        const exit = (code: number) =>
          Queue.end(stdout).pipe(
            Effect.andThen(Queue.end(stderr)),
            Effect.andThen(Deferred.succeed(exited, ChildProcessSpawner.ExitCode(code))),
            Effect.asVoid,
          );
        const child: FakeChild = {
          args,
          written: yield* Queue.unbounded<string>(),
          killed: false,
          emit: (text) => Queue.offer(stdout, encoder.encode(text)).pipe(Effect.asVoid),
          emitStderr: (text) => Queue.offer(stderr, encoder.encode(text)).pipe(Effect.asVoid),
          exit,
        };
        children.push(child);
        yield* Queue.offer(spawned, child);
        return ChildProcessSpawner.makeHandle({
          pid: ChildProcessSpawner.ProcessId(children.length),
          exitCode: Deferred.await(exited),
          isRunning: Deferred.isDone(exited).pipe(Effect.map((done) => !done)),
          kill: () =>
            Effect.suspend(() => {
              child.killed = true;
              return exit(143);
            }),
          unref: Effect.succeed(Effect.void),
          stdin: Sink.forEach((chunk: Uint8Array) => {
            const text = decoder.decode(chunk);
            return Queue.offer(child.written, text).pipe(
              Effect.andThen(script?.(child, text) ?? Effect.void),
            );
          }),
          stdout: Stream.fromQueue(stdout),
          stderr: Stream.fromQueue(stderr),
          all: Stream.empty,
          getInputFd: () => Sink.drain,
          getOutputFd: () => Stream.empty,
        });
      }),
    );
    const changed = yield* Ref.make(0);
    const login = yield* makeOmpLogin({
      instanceId: ProviderInstanceId.make("omp"),
      resolveSpawn: Effect.succeed({ command: "omp", env: {}, cwd: "/" }),
      onCredentialsChanged: Ref.update(changed, (count) => count + 1),
    }).pipe(Effect.provideService(ChildProcessSpawner.ChildProcessSpawner, spawner));
    const seen = yield* Ref.make<ReadonlyArray<OmpLoginState>>([]);
    yield* login.state.pipe(
      Stream.runForEach((state) => Ref.update(seen, (all) => [...all, state])),
      Effect.forkScoped,
    );
    const waitFor = (predicate: (state: OmpLoginState) => boolean) =>
      login.state.pipe(Stream.filter(predicate), Stream.runHead, Effect.map(Option.getOrUndefined));
    return { login, spawner, spawned, changed, seen, children, waitFor };
  });
