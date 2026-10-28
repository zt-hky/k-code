import {
  ChatAttachmentId,
  DEFAULT_SERVER_SETTINGS,
  isProviderSendTurnSupportedImageMimeType,
  PROVIDER_SEND_TURN_MAX_IMAGE_BYTES,
  type ServerSettings,
} from "@t3tools/contracts";
import * as ProviderHost from "@t3tools/provider-core/server/ProviderHost";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Base64 from "effect/encoding/Base64";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Ref from "effect/Ref";
import * as Stream from "effect/Stream";

const IMAGE_EXTENSION_BY_MIME: Readonly<Record<string, string>> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/gif": "gif",
  "image/webp": "webp",
};

export interface TestProviderHostOptions {
  readonly cwd?: string;
  readonly settings?: ServerSettings;
  readonly runBackgroundWork?: boolean;
}

export class TestProviderHostSettings extends Context.Service<
  TestProviderHostSettings,
  { readonly set: (settings: ServerSettings) => Effect.Effect<void> }
>()("@t3tools/provider-testing/TestProviderHost/TestProviderHostSettings") {}

export const layer = (
  options: TestProviderHostOptions = {},
): Layer.Layer<
  ProviderHost.ProviderHost | TestProviderHostSettings,
  never,
  FileSystem.FileSystem | Path.Path
> =>
  Layer.effectContext(
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const baseDir = yield* fileSystem
        .makeTempDirectoryScoped({ prefix: "t3-provider-host-" })
        .pipe(Effect.orDie);
      const stateDir = path.join(baseDir, "userdata");
      const providerStatusCacheDir = path.join(baseDir, "caches");
      const attachmentsDir = path.join(stateDir, "attachments");
      for (const directory of [stateDir, providerStatusCacheDir, attachmentsDir]) {
        yield* fileSystem.makeDirectory(directory, { recursive: true }).pipe(Effect.orDie);
      }
      const settings = yield* Ref.make(options.settings ?? DEFAULT_SERVER_SETTINGS);
      const credentials = new Map<string, Uint8Array>();
      const host = ProviderHost.ProviderHost.of({
        paths: {
          cwd: options.cwd ?? process.cwd(),
          baseDir,
          stateDir,
          providerStatusCacheDir,
          attachmentsDir,
        },
        settings: {
          get: Ref.get(settings),
          withSnapshot: (use) => Ref.get(settings).pipe(Effect.flatMap(use)),
          changes: Stream.empty,
          subscribe: Effect.succeed(Stream.empty),
        },
        shouldRunBackgroundWork: Effect.fn("ProviderHost.shouldRunBackgroundWork")(function () {
          return Effect.succeed(options.runBackgroundWork ?? true);
        }),
        resolveAttachmentPath: (attachment) => path.join(attachmentsDir, attachment.id),
        persistImageAttachment: Effect.fn("ProviderHost.persistImageAttachment")(
          function* (input) {
            if (!isProviderSendTurnSupportedImageMimeType(input.mimeType)) return null;
            const bytes = yield* Effect.fromResult(Base64.decode(input.base64));
            if (bytes.byteLength > PROVIDER_SEND_TURN_MAX_IMAGE_BYTES) return null;
            const persisted = {
              type: "image" as const,
              id: ChatAttachmentId.make(
                `${`${input.threadId}-${input.messageId}`.replace(/[^a-z0-9_-]+/gi, "-").slice(0, 100)}-${input.index}`,
              ),
              name: `image-${input.index + 1}.${IMAGE_EXTENSION_BY_MIME[input.mimeType.toLowerCase()] ?? "png"}`,
              mimeType: input.mimeType.toLowerCase(),
              sizeBytes: bytes.byteLength,
            };
            yield* fileSystem.writeFile(path.join(attachmentsDir, persisted.id), bytes);
            return persisted;
          },
          (effect) => effect.pipe(Effect.orElseSucceed(() => null)),
        ),
        credentials: Effect.fn("ProviderHost.credentials")(function (namespace, bindingId) {
          return Effect.sync(() => {
            const key = `${namespace}:${bindingId}`;
            return {
              binding: { owner: "t3" as const, key },
              get: Effect.sync(() => Option.fromUndefinedOr(credentials.get(key))),
              set: (value: Uint8Array) => Effect.sync(() => void credentials.set(key, value)),
              remove: Effect.sync(() => void credentials.delete(key)),
            };
          });
        }),
      });
      return Context.make(ProviderHost.ProviderHost, host).pipe(
        Context.add(TestProviderHostSettings, {
          set: (next) => Ref.set(settings, next),
        }),
      );
    }),
  );
