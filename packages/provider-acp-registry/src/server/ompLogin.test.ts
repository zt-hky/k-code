import * as NodeServices from "@effect/platform-node/NodeServices";
import { expect, it } from "@effect/vitest";
import {
  AcpRegistryOperationError,
  ProviderInstanceId,
  type OmpLoginState,
} from "@t3tools/contracts";
import * as Cause from "effect/Cause";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Queue from "effect/Queue";
import * as Ref from "effect/Ref";
import * as Schema from "effect/Schema";
import * as Sink from "effect/Sink";
import * as Stream from "effect/Stream";
import * as ChildProcessSpawner from "effect/process/ChildProcessSpawner";

import { makeOmpLogin } from "./ompLogin.ts";

const encoder = new TextEncoder();
const decoder = new TextDecoder();
const parseJson = Schema.decodeUnknownSync(Schema.fromJsonString(Schema.Unknown));
const stringifyJson = Schema.encodeUnknownSync(Schema.fromJsonString(Schema.Unknown));

interface FakeChild {
  readonly args: ReadonlyArray<string>;
  readonly written: Queue.Queue<string>;
  killed: boolean;
  readonly emit: (text: string) => Effect.Effect<void>;
  readonly emitStderr: (text: string) => Effect.Effect<void>;
  readonly exit: (code: number) => Effect.Effect<void>;
}

const makeHarness = (script?: (child: FakeChild, written: string) => Effect.Effect<void>) =>
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
    return { login, spawned, changed, seen, children, waitFor };
  });

const URL_AND_CODE_PROMPT =
  "\nOpen this URL in your browser:\nhttps://claude.ai/oauth/authorize?state=abc\nLocal shortcut (this machine only): http://localhost:54545/launch\n\nWaiting for browser authentication...\nPaste the authorization code (or full redirect URL): ";

it.live(
  "shows the browser URL, hands the pasted redirect straight to omp, and never keeps it",
  () =>
    Effect.scoped(
      Effect.gen(function* () {
        const h = yield* makeHarness();
        yield* h.login.start("anthropic");
        const child = yield* Queue.take(h.spawned);
        expect(child.args).toEqual(["login", "anthropic"]);

        yield* child.emit(URL_AND_CODE_PROMPT);
        const prompted = yield* h.waitFor((state) => state.prompt !== null);
        expect(prompted).toMatchObject({
          phase: "waiting",
          providerId: "anthropic",
          authorizationUrl: "https://claude.ai/oauth/authorize?state=abc",
          prompt: { message: "Paste the authorization code (or full redirect URL)", secret: false },
        });

        const redirect = "http://localhost:54545/callback?code=SECRET-CODE&state=abc";
        const answered = yield* h.login.respond({
          flowId: prompted!.flowId!,
          promptId: prompted!.prompt!.id,
          value: redirect,
        });
        expect(answered.prompt).toBeNull();
        expect(yield* Queue.take(child.written)).toBe(`${redirect}\n`);

        // Back-to-back writes: the success line must still count when more output follows at once.
        yield* child.emit("\nLogged in to Anthropic (Claude Pro/Max)\n");
        yield* child.emit("Credentials saved to /home/user/.omp/agent/agent.db\n");
        yield* child.exit(0);
        const done = yield* h.waitFor((state) => state.phase === "succeeded");
        expect(done).toMatchObject({ authorizationUrl: null, prompt: null, message: null });
        expect(yield* Ref.get(h.changed)).toBe(1);
        expect(stringifyJson(yield* Ref.get(h.seen))).not.toContain("SECRET-CODE");
      }),
    ).pipe(Effect.provide(NodeServices.layer)),
);

it.live("masks API key prompts and reports omp's own failure text", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const h = yield* makeHarness();
      yield* h.login.start("deepseek");
      const child = yield* Queue.take(h.spawned);
      yield* child.emit(
        "\nOpen this URL in your browser:\nhttps://platform.deepseek.com/api_keys\n\nPaste your DeepSeek API key (sk-...): ",
      );
      const prompted = yield* h.waitFor((state) => state.prompt !== null);
      expect(prompted?.prompt?.secret).toBe(true);

      yield* h.login.respond({
        flowId: prompted!.flowId!,
        promptId: prompted!.prompt!.id,
        value: "",
      });
      yield* child.emitStderr("Login failed: API key is required\n");
      yield* child.exit(1);
      const failed = yield* h.waitFor((state) => state.phase === "failed");
      expect(failed?.message).toBe("API key is required");
      expect(yield* Ref.get(h.changed)).toBe(0);
    }),
  ).pipe(Effect.provide(NodeServices.layer)),
);

it.live("cancel kills omp, reports cancelled, and frees the slot for another sign-in", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const h = yield* makeHarness();
      const started = yield* h.login.start("openrouter");
      const child = yield* Queue.take(h.spawned);

      const refused = yield* h.login.start("anthropic").pipe(Effect.flip);
      expect(refused).toBeInstanceOf(AcpRegistryOperationError);
      expect(refused.reason).toBe("login_failed");

      const cancelled = yield* h.login.cancel(started.flowId!);
      expect(child.killed).toBe(true);
      expect(cancelled).toMatchObject({ phase: "cancelled", message: null, prompt: null });
      expect(yield* Ref.get(h.changed)).toBe(0);

      yield* h.login.start("anthropic");
      expect((yield* Queue.take(h.spawned)).args).toEqual(["login", "anthropic"]);
    }),
  ).pipe(Effect.provide(NodeServices.layer)),
);

it.live("refuses answers that could feed omp more than one line or belong to an old prompt", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const h = yield* makeHarness();
      yield* h.login.start("deepseek");
      const child = yield* Queue.take(h.spawned);
      yield* child.emit("Paste your DeepSeek API key (sk-...): ");
      const prompted = yield* h.waitFor((state) => state.prompt !== null);
      const answer = { flowId: prompted!.flowId!, promptId: prompted!.prompt!.id };

      const multiline = yield* h.login
        .respond({ ...answer, value: "sk-1\nsk-2" })
        .pipe(Effect.flip);
      expect(multiline.reason).toBe("login_failed");
      const stale = yield* h.login
        .respond({ ...answer, promptId: "prompt-0", value: "sk-1" })
        .pipe(Effect.flip);
      expect(stale.reason).toBe("login_stale_flow");
      expect(yield* Queue.size(child.written)).toBe(0);
    }),
  ).pipe(Effect.provide(NodeServices.layer)),
);

const rpcScript =
  (replies: Readonly<Record<string, unknown>>) => (child: FakeChild, written: string) => {
    const command = parseJson(written) as { id: string; type: string };
    const data = replies[command.type];
    return child.emit(
      `${stringifyJson({ id: command.id, type: "response", command: command.type, success: true, data })}\n`,
    );
  };

it.live("lists the providers omp can log in to with their stored-credential status", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const h = yield* makeHarness(
        rpcScript({
          get_login_providers: {
            providers: [
              {
                id: "anthropic",
                name: "Anthropic (Claude Pro/Max)",
                available: true,
                authenticated: true,
              },
              { id: "openrouter", name: "OpenRouter", available: true, authenticated: false },
            ],
          },
        }),
      );
      const providers = yield* h.login.listProviders;
      expect(h.children[0]?.args.slice(0, 2)).toEqual(["--mode", "rpc"]);
      expect(providers).toEqual([
        { providerId: "anthropic", name: "Anthropic (Claude Pro/Max)", authenticated: true },
        { providerId: "openrouter", name: "OpenRouter", authenticated: false },
      ]);
    }),
  ).pipe(Effect.provide(NodeServices.layer)),
);

it.live("explains why omp could not start when it exits before answering", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const h = yield* makeHarness((child) =>
        child.emitStderr('Model "sonnet" not found\n').pipe(Effect.andThen(child.exit(1))),
      );
      const failure = yield* h.login.listProviders.pipe(Effect.flip);
      expect(failure).toMatchObject({
        reason: "login_list_failed",
        message: 'Model "sonnet" not found',
      });
    }),
  ).pipe(Effect.provide(NodeServices.layer)),
);

it.live("signs out by removing every stored credential and reports auth that still applies", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const h = yield* makeHarness(
        rpcScript({
          get_logout_accounts: { accounts: [{ credentialId: 3 }, { credentialId: 5 }] },
          logout: { remainingSource: "OPENROUTER_API_KEY environment variable" },
        }),
      );
      const result = yield* h.login.signOut("openrouter");
      const [child] = h.children;
      const commands = (yield* Queue.clear(child!.written)).map((line) => {
        const { id: _id, ...command } = parseJson(line) as Record<string, unknown>;
        return command;
      });
      expect(commands).toEqual([
        { type: "get_logout_accounts", providerId: "openrouter" },
        { type: "logout", providerId: "openrouter", credentialId: 3 },
        { type: "logout", providerId: "openrouter", credentialId: 5 },
      ]);
      expect(result).toEqual({
        removed: 2,
        remainingSource: "OPENROUTER_API_KEY environment variable",
      });
      expect(yield* Ref.get(h.changed)).toBe(1);
    }),
  ).pipe(Effect.provide(NodeServices.layer)),
);
