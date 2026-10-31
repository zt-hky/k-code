// @effect-diagnostics nodeBuiltinImport:off -- the marker name must match the hash the extension computes inside omp.
import * as NodeCrypto from "node:crypto";

import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";

export const T3_OMP_STOP_DIR_ENV = "T3_OMP_STOP_DIR";

/** omp rebinds extensions into every subagent session; each one polls for its own marker. */
export const OMP_STOP_EXTENSION_SOURCE = `\
import { createHash } from "node:crypto";
import { existsSync, rmSync } from "node:fs";
import { join } from "node:path";

export default function t3StopExtension(pi) {
  const dir = process.env.${T3_OMP_STOP_DIR_ENV};
  if (!dir) return;
  let timer;
  pi.on("agent_start", async (_event, ctx) => {
    const file = ctx.sessionManager.getSessionFile();
    if (ctx.agent?.kind !== "sub" || !file) return;
    const marker = join(dir, createHash("sha256").update(file).digest("hex"));
    clearInterval(timer);
    timer = setInterval(() => {
      if (!existsSync(marker)) return;
      rmSync(marker, { force: true });
      ctx.abort();
    }, 500);
  });
  pi.on("agent_end", async () => {
    clearInterval(timer);
    timer = undefined;
  });
}
`;

/** Marker file name that cancels exactly the subagent whose session file is `sessionFile`. */
export const ompSubagentStopMarkerName = (sessionFile: string): string =>
  NodeCrypto.createHash("sha256").update(sessionFile).digest("hex");

export interface OmpStopExtension {
  readonly extensionPath: string;
  readonly stopDir: string;
}

/** Writes the extension under a content-hashed name and ensures the marker directory exists. */
export const materializeOmpStopExtension = Effect.fn("materializeOmpStopExtension")(function* (
  stateDir: string,
) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const root = path.join(stateDir, "provider-ohmypi");
  const stopDir = path.join(root, "subagent-stop");
  const extensionPath = path.join(
    root,
    `stop-extension-${NodeCrypto.createHash("sha256").update(OMP_STOP_EXTENSION_SOURCE).digest("hex").slice(0, 12)}.ts`,
  );
  yield* fs.makeDirectory(stopDir, { recursive: true });
  const existing = yield* fs.readFileString(extensionPath).pipe(Effect.orElseSucceed(() => ""));
  if (existing !== OMP_STOP_EXTENSION_SOURCE) {
    yield* fs.writeFileString(extensionPath, OMP_STOP_EXTENSION_SOURCE);
  }
  return { extensionPath, stopDir } satisfies OmpStopExtension;
});
