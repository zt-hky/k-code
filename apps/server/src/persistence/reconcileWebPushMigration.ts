import * as Effect from "effect/Effect";
import * as Migrator from "effect/sql/Migrator";
import * as SqlClient from "effect/sql/SqlClient";

// Fork builds recorded Web Push subscriptions as migration 73, before upstream reserved 73 for
// ActiveTurnItemIndexes. The migrator skips every id up to the highest recorded one, so such a
// database would never get upstream's indexes. Forget the stale 73 row: the migrator then runs
// 73 (the indexes, which that database lacks) and 74 (web push, an idempotent CREATE IF NOT EXISTS).
export const reconcileWebPushMigration = Effect.fn("reconcileWebPushMigration")(function* () {
  const sql = yield* SqlClient.SqlClient;
  yield* sql.withTransaction(
    Effect.gen(function* () {
      const tables = yield* sql`
        SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'effect_sql_migrations'
      `;
      if (tables.length === 0) return;
      const legacy = yield* sql`
        SELECT migration_id FROM effect_sql_migrations
        WHERE migration_id = 73 AND name = 'WebPushSubscriptions'
      `;
      if (legacy.length === 0) return;
      const later =
        yield* sql`SELECT migration_id FROM effect_sql_migrations WHERE migration_id > 73`;
      if (later.length > 0) {
        return yield* new Migrator.MigrationError({
          kind: "BadState",
          message:
            "Cannot reconcile Web Push migration 73 with unexpected later migrations in this database.",
        });
      }
      yield* sql`DELETE FROM effect_sql_migrations WHERE migration_id = 73 AND name = 'WebPushSubscriptions'`;
    }),
  );
});
