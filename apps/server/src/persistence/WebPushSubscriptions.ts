import { AuthSessionId } from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as SqlClient from "effect/sql/SqlClient";
import * as SqlSchema from "effect/sql/SqlSchema";

import {
  PersistenceDecodeError,
  PersistenceSqlError,
  type WebPushSubscriptionRepositoryError,
} from "./Errors.ts";

export const WebPushSubscriptionRecord = Schema.Struct({
  endpoint: Schema.String,
  p256dh: Schema.String,
  auth: Schema.String,
});
export type WebPushSubscriptionRecord = typeof WebPushSubscriptionRecord.Type;

const UpsertWebPushSubscriptionInput = Schema.Struct({
  endpoint: Schema.String,
  sessionId: AuthSessionId,
  p256dh: Schema.String,
  auth: Schema.String,
  createdAt: Schema.DateTimeUtcFromString,
});
export type UpsertWebPushSubscriptionInput = typeof UpsertWebPushSubscriptionInput.Type;

const RemoveWebPushSubscriptionInput = Schema.Struct({
  endpoint: Schema.String,
  sessionId: AuthSessionId,
});
const RemoveWebPushEndpointInput = Schema.Struct({ endpoint: Schema.String });
const ListDeliverableInput = Schema.Struct({ now: Schema.DateTimeUtcFromString });

export class WebPushSubscriptionRepository extends Context.Service<
  WebPushSubscriptionRepository,
  {
    readonly upsert: (
      input: UpsertWebPushSubscriptionInput,
    ) => Effect.Effect<void, WebPushSubscriptionRepositoryError>;
    readonly remove: (
      input: typeof RemoveWebPushSubscriptionInput.Type,
    ) => Effect.Effect<void, WebPushSubscriptionRepositoryError>;
    readonly removeEndpoint: (
      input: typeof RemoveWebPushEndpointInput.Type,
    ) => Effect.Effect<void, WebPushSubscriptionRepositoryError>;
    /** Drops subscriptions whose session is revoked or expired, then lists the rest. */
    readonly listDeliverable: (
      input: typeof ListDeliverableInput.Type,
    ) => Effect.Effect<
      ReadonlyArray<WebPushSubscriptionRecord>,
      WebPushSubscriptionRepositoryError
    >;
    readonly hasAny: Effect.Effect<boolean, WebPushSubscriptionRepositoryError>;
  }
>()("t3/persistence/WebPushSubscriptions/WebPushSubscriptionRepository") {}

function toRepositoryError(operation: string) {
  return (cause: unknown): WebPushSubscriptionRepositoryError =>
    Schema.isSchemaError(cause)
      ? PersistenceDecodeError.fromSchemaError(`${operation}:decode`, cause)
      : new PersistenceSqlError({ operation: `${operation}:query`, cause });
}

/** @public */
export const make = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  const upsertRow = SqlSchema.void({
    Request: UpsertWebPushSubscriptionInput,
    execute: (input) => sql`
      INSERT INTO web_push_subscriptions (endpoint, session_id, p256dh, auth, created_at)
      VALUES (${input.endpoint}, ${input.sessionId}, ${input.p256dh}, ${input.auth}, ${input.createdAt})
      ON CONFLICT(endpoint) DO UPDATE SET
        session_id = excluded.session_id,
        p256dh = excluded.p256dh,
        auth = excluded.auth
    `,
  });

  const removeRow = SqlSchema.void({
    Request: RemoveWebPushSubscriptionInput,
    execute: ({ endpoint, sessionId }) => sql`
      DELETE FROM web_push_subscriptions
      WHERE endpoint = ${endpoint} AND session_id = ${sessionId}
    `,
  });

  const removeEndpointRow = SqlSchema.void({
    Request: RemoveWebPushEndpointInput,
    execute: ({ endpoint }) => sql`
      DELETE FROM web_push_subscriptions WHERE endpoint = ${endpoint}
    `,
  });

  const pruneUndeliverableRows = SqlSchema.void({
    Request: ListDeliverableInput,
    execute: ({ now }) => sql`
      DELETE FROM web_push_subscriptions
      WHERE session_id NOT IN (
        SELECT session_id FROM auth_sessions
        WHERE revoked_at IS NULL AND expires_at > ${now}
      )
    `,
  });

  const listRows = SqlSchema.findAll({
    Request: Schema.Struct({}),
    Result: WebPushSubscriptionRecord,
    execute: () => sql`
      SELECT endpoint, p256dh, auth FROM web_push_subscriptions ORDER BY created_at, endpoint
    `,
  });

  const anyRow = SqlSchema.findAll({
    Request: Schema.Struct({}),
    Result: Schema.Struct({ present: Schema.Number }),
    execute: () => sql`SELECT 1 AS present FROM web_push_subscriptions LIMIT 1`,
  });

  type Service = WebPushSubscriptionRepository["Service"];

  const upsert: Service["upsert"] = (input) =>
    upsertRow(input).pipe(
      Effect.mapError(toRepositoryError("WebPushSubscriptionRepository.upsert")),
    );

  const remove: Service["remove"] = (input) =>
    removeRow(input).pipe(
      Effect.mapError(toRepositoryError("WebPushSubscriptionRepository.remove")),
    );

  const removeEndpoint: Service["removeEndpoint"] = (input) =>
    removeEndpointRow(input).pipe(
      Effect.mapError(toRepositoryError("WebPushSubscriptionRepository.removeEndpoint")),
    );

  const listDeliverable: Service["listDeliverable"] = (input) =>
    sql
      .withTransaction(pruneUndeliverableRows(input).pipe(Effect.andThen(listRows({}))))
      .pipe(Effect.mapError(toRepositoryError("WebPushSubscriptionRepository.listDeliverable")));

  const hasAny: Service["hasAny"] = anyRow({}).pipe(
    Effect.map((rows) => rows.length > 0),
    Effect.mapError(toRepositoryError("WebPushSubscriptionRepository.hasAny")),
  );

  return { upsert, remove, removeEndpoint, listDeliverable, hasAny } satisfies Service;
});

export const layer = Layer.effect(WebPushSubscriptionRepository, make);
