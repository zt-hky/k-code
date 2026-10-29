import { assert, it } from "@effect/vitest";
import { AuthSessionId } from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as SqlClient from "effect/sql/SqlClient";

import * as Sqlite from "./Sqlite.ts";
import * as WebPushSubscriptions from "./WebPushSubscriptions.ts";

const layer = WebPushSubscriptions.layer.pipe(Layer.provideMerge(Sqlite.layerMemory));

const now = DateTime.makeUnsafe("2026-05-22T12:00:00.000Z");
const live = AuthSessionId.make("session-live");
const revoked = AuthSessionId.make("session-revoked");
const expired = AuthSessionId.make("session-expired");

const insertSession = (sessionId: string, expiresAt: string, revokedAt: string | null) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    yield* sql`
      INSERT INTO auth_sessions (session_id, subject, scopes, method, issued_at, expires_at, revoked_at)
      VALUES (${sessionId}, 'owner', '[]', 'browser-session-cookie', '2026-05-01T00:00:00.000Z', ${expiresAt}, ${revokedAt})
    `;
  });

it.effect("delivers only to subscriptions of live sessions and prunes the rest", () =>
  Effect.gen(function* () {
    const repository = yield* WebPushSubscriptions.WebPushSubscriptionRepository;
    yield* insertSession(live, "2026-06-01T00:00:00.000Z", null);
    yield* insertSession(revoked, "2026-06-01T00:00:00.000Z", "2026-05-10T00:00:00.000Z");
    yield* insertSession(expired, "2026-05-20T00:00:00.000Z", null);
    for (const [endpoint, sessionId] of [
      ["https://push.example/live", live],
      ["https://push.example/revoked", revoked],
      ["https://push.example/expired", expired],
    ] as const) {
      yield* repository.upsert({ endpoint, sessionId, p256dh: "p", auth: "a", createdAt: now });
    }

    const deliverable = yield* repository.listDeliverable({ now });
    assert.deepStrictEqual(
      deliverable.map((row) => row.endpoint),
      ["https://push.example/live"],
    );

    // Re-registering a pruned endpoint under the live session makes it deliverable again.
    yield* repository.upsert({
      endpoint: "https://push.example/revoked",
      sessionId: live,
      p256dh: "p2",
      auth: "a2",
      createdAt: now,
    });
    yield* repository.remove({ endpoint: "https://push.example/live", sessionId: revoked });
    assert.deepStrictEqual(
      (yield* repository.listDeliverable({ now })).map((row) => row.endpoint).toSorted(),
      ["https://push.example/live", "https://push.example/revoked"],
    );
  }).pipe(Effect.provide(layer)),
);
