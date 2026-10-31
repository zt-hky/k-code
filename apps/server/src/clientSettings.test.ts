import * as Context from "effect/Context";
import { DEFAULT_CLIENT_SETTINGS } from "@t3tools/contracts";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as Stream from "effect/Stream";

import * as ClientSettings from "./clientSettings.ts";
import * as ServerConfig from "./config.ts";

const layerClientSettings = () =>
  ClientSettings.layer.pipe(
    Layer.provideMerge(
      Layer.fresh(
        ServerConfig.layerTest(process.cwd(), { prefix: "t3code-client-settings-test-" }),
      ),
    ),
  );

const settingsFile = Effect.gen(function* () {
  const config = yield* ServerConfig.ServerConfig;
  const path = yield* Path.Path;
  return path.join(config.stateDir, ClientSettings.CLIENT_SETTINGS_FILE_NAME);
});

it.layer(NodeServices.layer)("client settings sync service", (it) => {
  it.effect("reports defaults as unseeded before anything is written", () =>
    Effect.gen(function* () {
      const service = yield* ClientSettings.ClientSettingsService;
      const fs = yield* FileSystem.FileSystem;

      const snapshot = yield* service.get;

      assert.equal(snapshot.seeded, false);
      assert.equal(snapshot.settings.wordWrap, DEFAULT_CLIENT_SETTINGS.wordWrap);
      assert.equal(yield* fs.exists(yield* settingsFile), false);
    }).pipe(Effect.provide(layerClientSettings())),
  );

  it.effect("merges patches key by key and persists across a restart", () =>
    Effect.gen(function* () {
      const service = yield* ClientSettings.ClientSettingsService;
      const fs = yield* FileSystem.FileSystem;

      yield* service.update({ patch: { chatWidth: "comfortable", wordWrap: false } });
      const merged = yield* service.update({ patch: { wordWrap: true } });

      assert.equal(merged.seeded, true);
      assert.equal(merged.settings.chatWidth, "comfortable");
      assert.equal(merged.settings.wordWrap, true);
      assert.equal(merged.settings.timestampFormat, DEFAULT_CLIENT_SETTINGS.timestampFormat);

      const restarted = yield* Layer.build(ClientSettings.layer).pipe(
        Effect.map((context) => Context.get(context, ClientSettings.ClientSettingsService)),
      );
      assert.deepEqual(yield* restarted.get, merged);
      assert.include(yield* fs.readFileString(yield* settingsFile), '"chatWidth": "comfortable"');
    }).pipe(Effect.scoped, Effect.provide(layerClientSettings())),
  );

  it.effect("applies a seeding patch only while nothing is stored", () =>
    Effect.gen(function* () {
      const service = yield* ClientSettings.ClientSettingsService;

      const seeded = yield* service.update({
        patch: { chatWidth: "comfortable" },
        onlyIfUnseeded: true,
      });
      const ignored = yield* service.update({
        patch: { chatWidth: "full" },
        onlyIfUnseeded: true,
      });

      assert.equal(seeded.seeded, true);
      assert.equal(ignored.settings.chatWidth, "comfortable");
    }).pipe(Effect.provide(layerClientSettings())),
  );

  it.effect("fills defaults for keys a stored file lacks and keeps damaged files intact", () =>
    Effect.gen(function* () {
      const service = yield* ClientSettings.ClientSettingsService;
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const file = yield* settingsFile;
      yield* fs.makeDirectory(path.dirname(file), { recursive: true });
      yield* fs.writeFileString(file, `{ "chatWidth": "comfortable" }`);

      const loaded = yield* service.get;
      assert.equal(loaded.seeded, true);
      assert.equal(loaded.settings.chatWidth, "comfortable");
      assert.equal(loaded.settings.wordWrap, DEFAULT_CLIENT_SETTINGS.wordWrap);
    }).pipe(Effect.provide(layerClientSettings())),
  );

  it.effect("refuses to overwrite an unreadable settings file", () =>
    Effect.gen(function* () {
      const service = yield* ClientSettings.ClientSettingsService;
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const file = yield* settingsFile;
      yield* fs.makeDirectory(path.dirname(file), { recursive: true });
      yield* fs.writeFileString(file, `{ "chatWidth": `);

      const error = yield* Effect.flip(service.update({ patch: { wordWrap: false } }));

      assert.equal(error.operation, "decode-file");
      assert.equal(yield* fs.readFileString(file), `{ "chatWidth": `);
    }).pipe(Effect.provide(layerClientSettings())),
  );

  it.effect("publishes each applied update to subscribers", () =>
    Effect.gen(function* () {
      const service = yield* ClientSettings.ClientSettingsService;
      const updates = yield* service.subscribeChanges;

      yield* service.update({ patch: { chatWidth: "comfortable" } });
      yield* service.update({ patch: { wordWrap: false } });

      const received = yield* updates.pipe(Stream.take(2), Stream.runCollect);
      assert.deepEqual(
        Array.from(received).map((snapshot) => [
          snapshot.settings.chatWidth,
          snapshot.settings.wordWrap,
        ]),
        [
          ["comfortable", true],
          ["comfortable", false],
        ],
      );
    }).pipe(Effect.scoped, Effect.provide(layerClientSettings())),
  );
});
