import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";

/** omp has no env var for `compaction.enabled`; a config overlay is its only per-process switch. */
const OMP_AUTO_COMPACTION_OFF_CONFIG = "compaction:\n  enabled: false\n";

/** Writes the overlay that turns omp's automatic compaction off and returns its path. */
export const materializeOmpAutoCompactionOffConfig = Effect.fn(
  "materializeOmpAutoCompactionOffConfig",
)(function* (stateDir: string) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const root = path.join(stateDir, "provider-ohmypi");
  const configPath = path.join(root, "auto-compaction-off.yml");
  yield* fs.makeDirectory(root, { recursive: true });
  const existing = yield* fs.readFileString(configPath).pipe(Effect.orElseSucceed(() => ""));
  if (existing !== OMP_AUTO_COMPACTION_OFF_CONFIG) {
    yield* fs.writeFileString(configPath, OMP_AUTO_COMPACTION_OFF_CONFIG);
  }
  return configPath;
});

/** Adds `configPath` after any overlays the user already lists in `PI_CONFIG_FILES`. */
export const withOmpConfigOverlay = (
  existing: string | undefined,
  configPath: string,
  platform: NodeJS.Platform,
): string => {
  const delimiter = platform === "win32" ? ";" : ":";
  return existing === undefined || existing === ""
    ? configPath
    : `${existing}${delimiter}${configPath}`;
};
