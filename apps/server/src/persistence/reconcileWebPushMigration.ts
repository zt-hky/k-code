import * as Effect from "effect/Effect";
import * as Migrator from "effect/sql/Migrator";
import * as SqlClient from "effect/sql/SqlClient";

/** The fork's only migration; it stays after upstream's last id so upstream ids are never skipped. */
export const WEB_PUSH_MIGRATION_ID = 80;

// Earlier fork builds recorded Web Push at an id upstream later took (73, then 74, then 78). The migrator
// skips every id up to the highest recorded one, so forget that stale row while it is still the
// newest: the migrator then runs upstream's ids from there and Web Push again (CREATE IF NOT EXISTS).
export const reconcileWebPushMigration = Effect.fn("reconcileWebPushMigration")(function* () {
  const sql = yield* SqlClient.SqlClient;
  yield* sql.withTransaction(
    Effect.gen(function* () {
      const tables = yield* sql`
        SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'effect_sql_migrations'
      `;
      if (tables.length === 0) return;
      const stale = yield* sql<{ readonly migration_id: number }>`
        SELECT migration_id FROM effect_sql_migrations
        WHERE name = 'WebPushSubscriptions' AND migration_id < ${WEB_PUSH_MIGRATION_ID}
      `;
      const staleId = stale[0]?.migration_id;
      if (staleId === undefined) return;
      const later = yield* sql`
        SELECT migration_id FROM effect_sql_migrations WHERE migration_id > ${staleId}
      `;
      if (later.length > 0) {
        return yield* new Migrator.MigrationError({
          kind: "BadState",
          message: `Cannot reconcile Web Push migration ${staleId} with unexpected later migrations in this database.`,
        });
      }
      yield* sql`
        DELETE FROM effect_sql_migrations
        WHERE migration_id = ${staleId} AND name = 'WebPushSubscriptions'
      `;
    }),
  );
});
