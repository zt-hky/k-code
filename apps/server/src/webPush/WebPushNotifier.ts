import {
  type AuthSessionId,
  type ThreadId,
  WebPushError,
  type WebPushSubscribeInput,
  type WebPushUnsubscribeInput,
} from "@t3tools/contracts";
import * as Cause from "effect/Cause";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Ref from "effect/Ref";
import * as Schema from "effect/Schema";
import * as SqlClient from "effect/sql/SqlClient";
import * as SqlSchema from "effect/sql/SqlSchema";
import type * as Scope from "effect/Scope";
import * as Stream from "effect/Stream";
import * as FetchHttpClient from "effect/http/FetchHttpClient";
import * as HttpClient from "effect/http/HttpClient";
import * as HttpClientRequest from "effect/http/HttpClientRequest";
import webpush from "web-push";

import * as ServerSecretStore from "../auth/ServerSecretStore.ts";
import * as ServerEnvironment from "../environment/ServerEnvironment.ts";
import * as ThreadManagement from "../orchestration-v2/ThreadManagementService.ts";
import * as WebPushSubscriptions from "../persistence/WebPushSubscriptions.ts";
import * as ProjectService from "../project/ProjectService.ts";
import {
  makeAgentAwarenessPublishWorker,
  shouldPublishAgentAwarenessEvent,
} from "../relay/AgentAwarenessRelay.ts";
import { forkParked } from "../serverActivation.ts";
import {
  makeWebPushAlertTracker,
  resolveWebPushAlert,
  type WebPushAlert,
  webPushBody,
  webPushQuestionsDetail,
} from "./webPushAlert.ts";

const VAPID_KEYS_SECRET = "web-push-vapid-keys";
// Push services reject VAPID subjects that are not mailto: or https: URLs.
const VAPID_SUBJECT = "https://t3.codes";

const VapidKeys = Schema.fromJsonString(
  Schema.Struct({ publicKey: Schema.String, privateKey: Schema.String }),
);
type VapidKeys = typeof VapidKeys.Type;
const decodeVapidKeys = Schema.decodeUnknownEffect(VapidKeys);
const encodeVapidKeys = Schema.encodeEffect(VapidKeys);

/** Read by `apps/web/public/sw.js`. */
const PushPayload = Schema.fromJsonString(
  Schema.Struct({
    title: Schema.String,
    body: Schema.String,
    tag: Schema.String,
    url: Schema.String,
    environmentId: Schema.String,
    threadId: Schema.String,
  }),
);
const encodePushPayload = Schema.encodeEffect(PushPayload);

export class WebPushNotifier extends Context.Service<
  WebPushNotifier,
  {
    readonly getPublicKey: Effect.Effect<string, WebPushError>;
    readonly subscribe: (
      input: WebPushSubscribeInput & { readonly sessionId: AuthSessionId },
    ) => Effect.Effect<void, WebPushError>;
    readonly unsubscribe: (
      input: WebPushUnsubscribeInput & { readonly sessionId: AuthSessionId },
    ) => Effect.Effect<void, WebPushError>;
    readonly drain: Effect.Effect<void>;
    readonly start: () => Effect.Effect<void, never, Scope.Scope>;
  }
>()("t3/webPush/WebPushNotifier") {}

const toWebPushError = (detail: string) => (cause: unknown) =>
  new WebPushError({
    detail: `${detail}: ${cause instanceof Error ? cause.message : String(cause)}`,
  });

/** @public */
export const make = Effect.gen(function* () {
  const secrets = yield* ServerSecretStore.ServerSecretStore;
  const serverEnvironment = yield* ServerEnvironment.ServerEnvironment;
  const threads = yield* ThreadManagement.ThreadManagementService;
  const projects = yield* ProjectService.ProjectService;
  const repository = yield* WebPushSubscriptions.WebPushSubscriptionRepository;
  const httpClient = yield* HttpClient.HttpClient;
  const scope = yield* Effect.scope;
  const tracker = makeWebPushAlertTracker((yield* DateTime.now).epochMilliseconds);
  const sql = yield* SqlClient.SqlClient;

  // The thread shell names the pending request but not its questions.
  const pendingQuestions = SqlSchema.findAll({
    Request: Schema.Struct({ threadId: Schema.String, requestId: Schema.String }),
    Result: Schema.Struct({
      questions: Schema.fromJsonString(Schema.Array(Schema.Struct({ question: Schema.String }))),
    }),
    execute: ({ threadId, requestId }) => sql`
      SELECT json_extract(payload_json, '$.questions') AS questions
      FROM orchestration_v2_projection_turn_items
      WHERE thread_id = ${threadId}
        AND type = 'user_input_request'
        AND json_extract(payload_json, '$.requestId') = ${requestId}
      LIMIT 1
    `,
  });

  // Shells carry no message text, so read the run's last assistant message.
  const latestReply = SqlSchema.findAll({
    Request: Schema.Struct({ threadId: Schema.String, runId: Schema.String }),
    Result: Schema.Struct({ text: Schema.String }),
    execute: ({ threadId, runId }) => sql`
      SELECT json_extract(payload_json, '$.text') AS text
      FROM orchestration_v2_projection_messages
      WHERE thread_id = ${threadId} AND run_id = ${runId} AND role = 'assistant'
        AND json_extract(payload_json, '$.text') IS NOT NULL
      ORDER BY created_at DESC, message_id DESC
      LIMIT 1
    `,
  });
  const hasSubscribers = yield* Ref.make(false);

  const readStoredKeys = secrets.get(VAPID_KEYS_SECRET).pipe(
    Effect.flatMap(
      Option.match({
        onNone: () => Effect.succeedNone,
        onSome: (bytes) => decodeVapidKeys(new TextDecoder().decode(bytes)).pipe(Effect.asSome),
      }),
    ),
  );
  const vapidKeys = yield* Effect.cached(
    Effect.gen(function* () {
      const stored = yield* readStoredKeys;
      if (Option.isSome(stored)) return stored.value;
      const generated = webpush.generateVAPIDKeys();
      const created = yield* secrets
        .create(VAPID_KEYS_SECRET, new TextEncoder().encode(yield* encodeVapidKeys(generated)))
        .pipe(
          Effect.as(true),
          Effect.catchIf(ServerSecretStore.isSecretAlreadyExistsError, () => Effect.succeed(false)),
        );
      if (created) return generated;
      // Another caller created the keys first; use theirs.
      return yield* readStoredKeys.pipe(Effect.flatMap(Effect.fromOption));
    }).pipe(Effect.mapError(toWebPushError("Could not load web push keys"))),
  );

  const refreshHasSubscribers = repository.hasAny.pipe(
    Effect.flatMap((present) => Ref.set(hasSubscribers, present)),
    Effect.catchCause((cause) =>
      Effect.logWarning("web push subscriber check failed", { cause: Cause.pretty(cause) }),
    ),
  );

  const deliver = Effect.fnUntraced(function* (
    keys: VapidKeys,
    subscription: WebPushSubscriptions.WebPushSubscriptionRecord,
    payload: string,
  ) {
    const details = webpush.generateRequestDetails(
      {
        endpoint: subscription.endpoint,
        keys: { p256dh: subscription.p256dh, auth: subscription.auth },
      },
      payload,
      {
        vapidDetails: {
          subject: VAPID_SUBJECT,
          publicKey: keys.publicKey,
          privateKey: keys.privateKey,
        },
        TTL: 3600,
        urgency: "high",
        contentEncoding: "aes128gcm",
      },
    );
    const headers: Record<string, string> = {};
    for (const [name, value] of Object.entries(details.headers)) {
      // The HTTP client derives these from the body.
      const lower = name.toLowerCase();
      if (lower === "content-length" || lower === "content-type") continue;
      headers[name] = String(value);
    }
    const response = yield* httpClient.execute(
      HttpClientRequest.post(details.endpoint).pipe(
        HttpClientRequest.setHeaders(headers),
        HttpClientRequest.bodyUint8Array(new Uint8Array(details.body), "application/octet-stream"),
      ),
    );
    return response.status;
  });

  const send = Effect.fn("WebPushNotifier.send")(function* (alert: WebPushAlert) {
    const keys = yield* vapidKeys;
    const now = yield* DateTime.now;
    const subscriptions = yield* repository.listDeliverable({ now });
    const payload = yield* encodePushPayload({
      title: alert.title,
      body: alert.body,
      tag: alert.tag,
      url: alert.url,
      environmentId: alert.environmentId,
      threadId: alert.threadId,
    });
    const outcomes = yield* Effect.forEach(
      subscriptions,
      (subscription) =>
        deliver(keys, subscription, payload).pipe(
          Effect.timeout("10 seconds"),
          Effect.flatMap((status) => {
            if (status >= 200 && status < 300) return Effect.succeed("delivered" as const);
            if (status === 404 || status === 410) {
              return repository
                .removeEndpoint({ endpoint: subscription.endpoint })
                .pipe(Effect.as("removed" as const));
            }
            return Effect.logWarning("web push rejected", { status }).pipe(
              Effect.as("failed" as const),
            );
          }),
          Effect.catchCause((cause) =>
            Effect.logWarning("web push delivery failed", { cause: Cause.pretty(cause) }).pipe(
              Effect.as("failed" as const),
            ),
          ),
        ),
      { concurrency: 4 },
    );
    const removed = outcomes.filter((outcome) => outcome === "removed").length;
    if (removed > 0 || subscriptions.length === 0) yield* refreshHasSubscribers;
    yield* Effect.logInfo("web push delivered", {
      threadId: alert.threadId,
      kind: alert.kind,
      delivered: outcomes.filter((outcome) => outcome === "delivered").length,
      removed,
      failed: outcomes.filter((outcome) => outcome === "failed").length,
    });
  });

  let enqueue: (threadId: ThreadId) => Effect.Effect<void> = () => Effect.void;

  const processThreadUnsafe = Effect.fn("WebPushNotifier.processThread")(function* (
    threadId: ThreadId,
  ) {
    const shell = yield* threads.getThreadShell(threadId);
    let alert: WebPushAlert | null = null;
    if (shell !== null && shell.archivedAt === null) {
      const project = yield* projects.getById(shell.projectId);
      if (Option.isSome(project)) {
        alert = resolveWebPushAlert({
          environmentId: yield* serverEnvironment.getEnvironmentId,
          thread: shell,
          project: project.value,
        });
      }
    }
    const decision = tracker.observe(
      threadId,
      shell,
      alert,
      (yield* DateTime.now).epochMilliseconds,
    );
    switch (decision._tag) {
      case "None":
        return;
      case "Hold":
        yield* Effect.sleep(decision.delayMs).pipe(
          Effect.andThen(Effect.suspend(() => enqueue(threadId))),
          Effect.forkIn(scope),
        );
        return;
      case "Send": {
        if (shell === null) {
          yield* send(decision.alert);
          return;
        }
        const requestId = shell.pendingRuntimeRequest?.id;
        // Detail is best effort; the notification still goes out without it.
        const detail = yield* (
          decision.alert.kind === "input" && requestId !== undefined
            ? pendingQuestions({ threadId, requestId }).pipe(
                Effect.map((rows) => webPushQuestionsDetail(rows[0]?.questions ?? [])),
              )
            : decision.alert.kind === "completed" && shell.latestRunId !== null
              ? latestReply({ threadId, runId: shell.latestRunId }).pipe(
                  Effect.map((rows) => rows[0]?.text),
                )
              : Effect.succeedNone.pipe(Effect.map(Option.getOrUndefined<string>))
        ).pipe(
          Effect.catchCause((cause) =>
            Effect.logWarning("web push detail lookup failed", {
              threadId,
              cause: Cause.pretty(cause),
            }).pipe(Effect.as(undefined)),
          ),
        );
        yield* send(
          detail === undefined
            ? decision.alert
            : { ...decision.alert, body: webPushBody(shell.title, detail) },
        );
        return;
      }
    }
  });

  const processThread = (threadId: ThreadId) =>
    processThreadUnsafe(threadId).pipe(
      Effect.catchCause((cause) =>
        Cause.hasInterruptsOnly(cause)
          ? Effect.void
          : Effect.logWarning("web push processing failed", {
              threadId,
              cause: Cause.pretty(cause),
            }),
      ),
    );

  const worker = yield* makeAgentAwarenessPublishWorker(processThread);
  enqueue = worker.enqueue;

  const getPublicKey: WebPushNotifier["Service"]["getPublicKey"] = vapidKeys.pipe(
    Effect.map((keys) => keys.publicKey),
    Effect.withSpan("WebPushNotifier.getPublicKey"),
  );

  const subscribe: WebPushNotifier["Service"]["subscribe"] = Effect.fn("WebPushNotifier.subscribe")(
    function* (input) {
      yield* repository
        .upsert({
          endpoint: input.endpoint,
          sessionId: input.sessionId,
          p256dh: input.keys.p256dh,
          auth: input.keys.auth,
          createdAt: yield* DateTime.now,
        })
        .pipe(Effect.mapError(toWebPushError("Could not save the push subscription")));
      yield* Ref.set(hasSubscribers, true);
    },
  );

  const unsubscribe: WebPushNotifier["Service"]["unsubscribe"] = Effect.fn(
    "WebPushNotifier.unsubscribe",
  )(function* (input) {
    yield* repository
      .remove({ endpoint: input.endpoint, sessionId: input.sessionId })
      .pipe(Effect.mapError(toWebPushError("Could not remove the push subscription")));
    yield* refreshHasSubscribers;
  });

  const start: WebPushNotifier["Service"]["start"] = Effect.fn("WebPushNotifier.start")(
    function* () {
      yield* refreshHasSubscribers;
      yield* forkParked(
        Stream.runForEach(threads.streamDomainEvents, (event) =>
          shouldPublishAgentAwarenessEvent(event)
            ? Ref.get(hasSubscribers).pipe(
                Effect.flatMap((present) => (present ? enqueue(event.threadId) : Effect.void)),
              )
            : Effect.void,
        ),
      );
    },
  );

  return WebPushNotifier.of({ getPublicKey, subscribe, unsubscribe, drain: worker.drain, start });
});

export const layer = Layer.effect(WebPushNotifier, make).pipe(
  Layer.provide(WebPushSubscriptions.layer),
  Layer.provide(FetchHttpClient.layer),
);
