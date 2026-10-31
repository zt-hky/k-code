import type { OrchestrationV2DomainEvent, ThreadId } from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import type * as Scope from "effect/Scope";
import * as Stream from "effect/Stream";

import * as ProviderInstanceRegistry from "../provider/ProviderInstanceRegistry.ts";
import { forkParked } from "../serverActivation.ts";
import * as Orchestrator from "./Orchestrator.ts";
import * as ProjectionStore from "./ProjectionStore.ts";

/**
 * Keeps an agent's own session record in step with the T3 thread title, for agents whose
 * driver can rename a session. Only a title that changes while the server runs is written:
 * a thread's first-seen title is the baseline, so a placeholder title never overwrites a
 * title the agent chose for itself.
 */
export class ProviderSessionTitleWriteBack extends Context.Service<
  ProviderSessionTitleWriteBack,
  {
    readonly start: () => Effect.Effect<void, never, Scope.Scope>;
    readonly handle: (event: OrchestrationV2DomainEvent) => Effect.Effect<void>;
  }
>()("t3/orchestration-v2/ProviderSessionTitleWriteBack") {}

const make = Effect.gen(function* () {
  const engine = yield* Orchestrator.OrchestratorV2;
  const projections = yield* ProjectionStore.ProjectionStoreV2;
  const instances = yield* ProviderInstanceRegistry.ProviderInstanceRegistry;
  const knownTitles = new Map<ThreadId, string>();

  const seed = projections.getShellSnapshot({ location: "active" }).pipe(
    Effect.tap((snapshot) =>
      Effect.sync(() => {
        for (const thread of snapshot.threads) {
          if (!knownTitles.has(thread.id)) knownTitles.set(thread.id, thread.title);
        }
      }),
    ),
    Effect.catchCause((cause) =>
      Effect.logWarning("seeding thread titles for session write-back failed", { cause }),
    ),
  );

  const handle: ProviderSessionTitleWriteBack["Service"]["handle"] = Effect.fnUntraced(
    function* (event) {
      if (event.type === "thread.created") {
        knownTitles.set(event.payload.id, event.payload.title);
        return;
      }
      if (event.type !== "thread.metadata-updated") return;
      const thread = event.payload;
      const previous = knownTitles.get(thread.id);
      knownTitles.set(thread.id, thread.title);
      if (previous === undefined || previous === thread.title) return;
      if (thread.activeProviderThreadId === null) return;
      const rename = (yield* instances.getInstance(thread.providerInstanceId))?.acpSessionManagement
        ?.renameSession;
      if (rename === undefined) return;
      const { providerThreads } = yield* projections.getThreadRecords(thread.id, [
        "providerThreads",
      ]);
      const nativeId = providerThreads.find(
        (providerThread) => providerThread.id === thread.activeProviderThreadId,
      )?.nativeThreadRef?.nativeId;
      if (nativeId === null || nativeId === undefined) return;
      yield* rename({ sessionId: nativeId, title: thread.title });
    },
    (effect, event) =>
      effect.pipe(
        Effect.catchCause((cause) =>
          Effect.logWarning("writing a thread title back to its provider session failed", {
            threadId: event.threadId,
            cause,
          }),
        ),
      ),
  );

  const start: ProviderSessionTitleWriteBack["Service"]["start"] = () =>
    forkParked(
      seed.pipe(
        Effect.andThen(Stream.runForEach(engine.streamDomainEvents, handle)),
        Effect.catchCause((cause) =>
          Effect.logWarning("provider session title write-back stream failed", { cause }),
        ),
      ),
    );

  return { start, handle } satisfies ProviderSessionTitleWriteBack["Service"];
});

export const layer = Layer.effect(ProviderSessionTitleWriteBack, make);
