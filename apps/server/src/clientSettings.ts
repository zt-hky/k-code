import {
  ClientSettingsSyncError,
  type ClientSettingsSyncSnapshot,
  type ClientSettingsSyncUpdateInput,
  SyncedClientSettingsSchema,
  type SyncedClientSettings,
} from "@t3tools/contracts";
import { writeFileStringAtomically } from "@t3tools/shared/atomicWrite";
import { fromJsonStringPretty, fromLenientJson } from "@t3tools/shared/schemaJson";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as PubSub from "effect/PubSub";
import * as Ref from "effect/Ref";
import * as Schema from "effect/Schema";
import * as Semaphore from "effect/Semaphore";
import * as Stream from "effect/Stream";
import * as Scope from "effect/Scope";

import * as ServerConfig from "./config.ts";

export const CLIENT_SETTINGS_FILE_NAME = "client-settings.json";

const decodeSettingsJson = Schema.decodeUnknownEffect(fromLenientJson(SyncedClientSettingsSchema));
const encodeSettingsJson = Schema.encodeEffect(fromJsonStringPretty(SyncedClientSettingsSchema));

export class ClientSettingsService extends Context.Service<
  ClientSettingsService,
  {
    readonly get: Effect.Effect<ClientSettingsSyncSnapshot, ClientSettingsSyncError>;
    readonly update: (
      input: ClientSettingsSyncUpdateInput,
    ) => Effect.Effect<ClientSettingsSyncSnapshot, ClientSettingsSyncError>;
    /** Subscribe before reading a snapshot so no change falls between the two. */
    readonly subscribeChanges: Effect.Effect<
      Stream.Stream<ClientSettingsSyncSnapshot>,
      never,
      Scope.Scope
    >;
  }
>()("t3/clientSettings/ClientSettingsService") {}

const make = Effect.gen(function* () {
  const { stateDir } = yield* ServerConfig.ServerConfig;
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const settingsPath = path.join(stateDir, CLIENT_SETTINGS_FILE_NAME);
  const writeSemaphore = yield* Semaphore.make(1);
  const changes = yield* PubSub.unbounded<ClientSettingsSyncSnapshot>();
  // Unset until first read; a missing file is cached as an unseeded snapshot.
  const cache = yield* Ref.make(Option.none<ClientSettingsSyncSnapshot>());

  const failure =
    (operation: ClientSettingsSyncError["operation"]) =>
    (cause: unknown): ClientSettingsSyncError =>
      new ClientSettingsSyncError({ settingsPath, operation, cause });

  const loadFromDisk = Effect.gen(function* () {
    const exists = yield* fs.exists(settingsPath).pipe(Effect.mapError(failure("check-exists")));
    if (!exists) {
      const defaults = yield* decodeSettingsJson("{}").pipe(
        Effect.mapError(failure("decode-file")),
      );
      return { settings: defaults, seeded: false };
    }
    const raw = yield* fs.readFileString(settingsPath).pipe(Effect.mapError(failure("read-file")));
    // A damaged file is reported, never replaced by defaults, so the next write cannot erase it.
    const settings = yield* decodeSettingsJson(raw).pipe(Effect.mapError(failure("decode-file")));
    return { settings, seeded: true };
  });

  const current = Effect.gen(function* () {
    const cached = yield* Ref.get(cache);
    if (Option.isSome(cached)) return cached.value;
    const loaded = yield* loadFromDisk;
    yield* Ref.set(cache, Option.some(loaded));
    return loaded;
  });

  const persist = Effect.fnUntraced(function* (settings: SyncedClientSettings) {
    const contents = yield* encodeSettingsJson(settings).pipe(
      Effect.mapError(failure("encode-file")),
    );
    yield* writeFileStringAtomically({ filePath: settingsPath, contents: `${contents}\n` }).pipe(
      Effect.provideService(FileSystem.FileSystem, fs),
      Effect.provideService(Path.Path, path),
      Effect.mapError(failure("write-file")),
    );
  });

  return ClientSettingsService.of({
    get: writeSemaphore.withPermits(1)(current),
    update: Effect.fn("clientSettings.update")(function* (input) {
      return yield* writeSemaphore.withPermits(1)(
        Effect.gen(function* () {
          const before = yield* current;
          if (input.onlyIfUnseeded === true && before.seeded) return before;
          const next = {
            // Later writes win per key they name.
            settings: { ...before.settings, ...input.patch },
            seeded: true,
          };
          yield* persist(next.settings);
          yield* Ref.set(cache, Option.some(next));
          yield* PubSub.publish(changes, next);
          return next;
        }),
      );
    }),
    subscribeChanges: PubSub.subscribe(changes).pipe(
      Effect.map((subscription) => Stream.fromSubscription(subscription)),
    ),
  });
});

export const layer = Layer.effect(ClientSettingsService, make);
