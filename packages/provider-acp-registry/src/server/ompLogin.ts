import {
  AcpRegistryOperationError,
  type AcpRegistryOperationErrorReason,
  type OmpLoginSignOutResult,
  type OmpLoginState,
  type ProviderInstanceId,
} from "@t3tools/contracts";
import type { ProviderModelLogin } from "@t3tools/provider-core/server/driver";
import * as Crypto from "effect/Crypto";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Fiber from "effect/Fiber";
import * as Scope from "effect/Scope";
import * as Semaphore from "effect/Semaphore";
import * as Stream from "effect/Stream";
import * as SubscriptionRef from "effect/SubscriptionRef";
import * as ChildProcessSpawner from "effect/process/ChildProcessSpawner";

import {
  makeOmpLoginScanner,
  type OmpLoginOutputEvent,
  parseOmpLoginFailure,
  parseOmpLoginProviders,
  parseOmpLogoutCredentialIds,
} from "./ompLoginOutput.ts";
import { OmpProcessError, spawnOmp, withOmpRpc, type OmpSpawn } from "./ompProcess.ts";

const FLOW_TIMEOUT = Duration.minutes(10);
const RPC_TIMEOUT = Duration.seconds(60);
// readline writes a question without a newline, so a quiet tail is a prompt, not a split line.
const PROMPT_SETTLE = Duration.millis(150);
const MAX_FAILURE_MESSAGE = 1_024;

interface ActiveFlow {
  readonly flowId: string;
  readonly scope: Scope.Closeable;
  write: (text: string) => Effect.Effect<void>;
  fiber: Fiber.Fiber<void> | undefined;
  cancelled: boolean;
}

const failure = (reason: AcpRegistryOperationErrorReason, message: string) =>
  new AcpRegistryOperationError({ reason, message });

/**
 * Model-provider sign-in for one Oh My Pi instance. `omp login <provider>` runs against the same
 * executable and environment as the instance's ACP sessions, so credentials land where sessions
 * read them. Values the user submits go straight to the child's stdin and are never stored.
 */
export const makeOmpLogin = Effect.fn("OmpLogin.make")(function* (options: {
  readonly instanceId: ProviderInstanceId;
  readonly resolveSpawn: Effect.Effect<OmpSpawn, AcpRegistryOperationError>;
  /** Runs after credentials were added or removed, so models and sessions pick them up. */
  readonly onCredentialsChanged: Effect.Effect<void>;
}) {
  const instanceScope = yield* Scope.Scope;
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
  const crypto = yield* Crypto.Crypto;
  const lock = yield* Semaphore.make(1);
  const idle: OmpLoginState = {
    instanceId: options.instanceId,
    phase: "idle",
    flowId: null,
    providerId: null,
    authorizationUrl: null,
    instructions: null,
    progress: null,
    prompt: null,
    message: null,
  };
  const state = yield* SubscriptionRef.make(idle);
  let active: ActiveFlow | undefined;

  const publishFor = (flow: ActiveFlow, patch: Partial<OmpLoginState>) =>
    Effect.suspend(() =>
      active === flow
        ? SubscriptionRef.update(state, (current) => ({ ...current, ...patch }))
        : Effect.void,
    );

  const runFlow = Effect.fn("OmpLogin.runFlow")(function* (
    flow: ActiveFlow,
    spawn: OmpSpawn,
    providerId: string,
  ) {
    const outcome = yield* Effect.gen(function* () {
      const child = yield* spawnOmp(spawn, ["login", providerId]).pipe(
        Effect.provideService(ChildProcessSpawner.ChildProcessSpawner, spawner),
      );
      flow.write = child.write;
      const stderrFiber = yield* child.stderr.pipe(
        Stream.runFold(
          () => "",
          (collected, text) =>
            collected.length < MAX_FAILURE_MESSAGE * 2 ? collected + text : collected,
        ),
        Effect.forkIn(flow.scope),
      );
      const scanner = makeOmpLoginScanner();
      let loggedIn = false;
      let promptCount = 0;
      const handle = (event: OmpLoginOutputEvent) => {
        switch (event._tag) {
          case "authorization":
            return publishFor(flow, {
              phase: "waiting",
              authorizationUrl: event.url,
              instructions: event.instructions,
            });
          case "progress":
            return publishFor(flow, { phase: "waiting", progress: event.message });
          case "loggedIn":
            loggedIn = true;
            return Effect.void;
          case "prompt":
            return publishFor(flow, {
              phase: "waiting",
              prompt: {
                id: `prompt-${++promptCount}`,
                message: event.message,
                secret: event.secret,
              },
            });
        }
      };
      // Each chunk restarts the quiet period; a pending one is dropped when stdout ends, so a
      // question printed as the process dies never becomes a prompt.
      let settle: Fiber.Fiber<void> | undefined;
      const cancelSettle = Effect.suspend(() => {
        const pending = settle;
        settle = undefined;
        return pending === undefined ? Effect.void : Fiber.interrupt(pending);
      });
      yield* child.stdout.pipe(
        Stream.runForEach((chunk) =>
          Effect.gen(function* () {
            yield* cancelSettle;
            yield* Effect.forEach(scanner.push(chunk), handle, { discard: true });
            if (!scanner.hasPendingTail()) return;
            settle = yield* Effect.sleep(PROMPT_SETTLE).pipe(
              Effect.andThen(
                Effect.suspend(() =>
                  Effect.forEach(scanner.flush(), handle, { discard: true }),
                ).pipe(Effect.uninterruptible),
              ),
              Effect.forkIn(flow.scope),
            );
          }),
        ),
        Effect.ensuring(cancelSettle),
      );
      const exitCode = yield* child.exitCode;
      const stderr = yield* Fiber.join(stderrFiber);
      return { kind: "exited" as const, loggedIn, exitCode, stderr };
    }).pipe(
      Effect.provideService(Scope.Scope, flow.scope),
      Effect.timeoutOrElse({
        duration: FLOW_TIMEOUT,
        orElse: () =>
          Effect.fail(new OmpProcessError({ detail: "Sign-in timed out. Start again." })),
      }),
      Effect.catchTags({
        OmpProcessError: (error) =>
          Effect.succeed({ kind: "failed" as const, detail: error.detail }),
      }),
      Effect.catchCause(() =>
        Effect.succeed({ kind: "failed" as const, detail: "Sign-in failed. Start again." }),
      ),
    );
    yield* Scope.close(flow.scope, Exit.void);
    const succeeded = outcome.kind === "exited" && outcome.loggedIn && outcome.exitCode === 0;
    const message =
      flow.cancelled || succeeded
        ? null
        : outcome.kind === "failed"
          ? outcome.detail
          : (parseOmpLoginFailure(outcome.stderr) ??
            "Oh My Pi did not store a credential for this provider.");
    if (succeeded) yield* options.onCredentialsChanged;
    yield* publishFor(flow, {
      phase: flow.cancelled ? "cancelled" : succeeded ? "succeeded" : "failed",
      authorizationUrl: null,
      instructions: null,
      progress: null,
      prompt: null,
      message: message === null ? null : message.slice(0, MAX_FAILURE_MESSAGE),
    });
    if (active === flow) active = undefined;
  });

  const rpc = <A>(
    reason: AcpRegistryOperationErrorReason,
    timeoutMessage: string,
    use: (
      spawn: OmpSpawn,
    ) => Effect.Effect<A, OmpProcessError, ChildProcessSpawner.ChildProcessSpawner>,
  ) =>
    options.resolveSpawn.pipe(
      Effect.flatMap(use),
      Effect.provideService(ChildProcessSpawner.ChildProcessSpawner, spawner),
      Effect.catchTags({
        OmpProcessError: (error) => Effect.fail(failure(reason, error.detail)),
      }),
      Effect.timeoutOrElse({
        duration: RPC_TIMEOUT,
        orElse: () => Effect.fail(failure(reason, timeoutMessage)),
      }),
    );

  return {
    listProviders: Effect.suspend(() =>
      rpc("login_list_failed", "Listing Oh My Pi providers timed out.", (spawn) =>
        withOmpRpc(spawn, (call) => call({ type: "get_login_providers" })).pipe(
          Effect.map(parseOmpLoginProviders),
        ),
      ),
    ),
    start: Effect.fn("OmpLogin.start")(function* (providerId: string) {
      const spawn = yield* options.resolveSpawn;
      return yield* lock.withPermit(
        Effect.gen(function* () {
          if (active !== undefined) {
            return yield* failure("login_failed", "Another sign-in is already in progress.");
          }
          const flowId = yield* crypto
            .randomUUIDv4()
            .pipe(Effect.mapError(() => failure("login_failed", "Could not start sign-in.")));
          const scope = yield* Scope.fork(instanceScope, "sequential");
          const flow: ActiveFlow = {
            flowId,
            scope,
            write: () => Effect.void,
            fiber: undefined,
            cancelled: false,
          };
          active = flow;
          yield* SubscriptionRef.set(state, {
            ...idle,
            phase: "starting",
            flowId,
            providerId: providerId as OmpLoginState["providerId"],
          });
          flow.fiber = yield* runFlow(flow, spawn, providerId).pipe(Effect.forkIn(instanceScope));
          return yield* SubscriptionRef.get(state);
        }),
      );
    }),
    respond: Effect.fn("OmpLogin.respond")(function* (input: {
      readonly flowId: string;
      readonly promptId: string;
      readonly value: string;
    }) {
      if (/[\r\n]/.test(input.value)) {
        return yield* failure("login_failed", "Pasted text must be a single line.");
      }
      return yield* lock.withPermit(
        Effect.gen(function* () {
          const current = yield* SubscriptionRef.get(state);
          if (
            active === undefined ||
            active.flowId !== input.flowId ||
            current.prompt?.id !== input.promptId
          ) {
            return yield* failure("login_stale_flow", "This sign-in step is no longer active.");
          }
          yield* SubscriptionRef.update(state, (latest) => ({ ...latest, prompt: null }));
          yield* active.write(`${input.value}\n`);
          return yield* SubscriptionRef.get(state);
        }),
      );
    }),
    cancel: Effect.fn("OmpLogin.cancel")(function* (flowId: string) {
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
    signOut: Effect.fn("OmpLogin.signOut")(function* (providerId: string) {
      if (active !== undefined) {
        return yield* failure(
          "login_sign_out_failed",
          "Finish or cancel the sign-in in progress first.",
        );
      }
      const result = yield* rpc("login_sign_out_failed", "Signing out timed out.", (spawn) =>
        withOmpRpc(spawn, (call) =>
          Effect.gen(function* () {
            const accounts = parseOmpLogoutCredentialIds(
              yield* call({ type: "get_logout_accounts", providerId }),
            );
            let remainingSource: string | undefined;
            for (const credentialId of accounts) {
              const removed = yield* call({ type: "logout", providerId, credentialId });
              const source = (removed as { readonly remainingSource?: unknown } | null)
                ?.remainingSource;
              remainingSource = typeof source === "string" ? source : undefined;
            }
            return {
              removed: accounts.length,
              ...(remainingSource === undefined
                ? {}
                : { remainingSource: remainingSource.slice(0, 256) }),
            } satisfies OmpLoginSignOutResult;
          }),
        ),
      );
      yield* options.onCredentialsChanged;
      return result;
    }),
    state: SubscriptionRef.changes(state),
  } satisfies ProviderModelLogin;
});
