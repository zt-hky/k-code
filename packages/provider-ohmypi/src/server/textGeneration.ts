import { AcpRegistryOperationError, TextGenerationError } from "@t3tools/contracts";
import * as TextGenerationOperations from "@t3tools/provider-core/server/textGenerationOperations";
import type { ProviderTextGeneration } from "@t3tools/provider-core/server/textGeneration";
import { getModelSelectionStringOptionValue } from "@t3tools/shared/model";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import * as ChildProcessSpawner from "effect/process/ChildProcessSpawner";

import { stripAnsi } from "./ansi.ts";
import { spawnOmp, type OmpSpawn } from "./process.ts";

const OMP_TIMEOUT_MS = 180_000;
const MAX_OUTPUT = 1_000_000;
const MAX_STDERR = 2_048;

// One quiet, tool-less turn: no session file, and nothing from the user's setup runs.
const OMP_PRINT_ARGS = [
  "-p",
  "--no-session",
  "--no-tools",
  "--no-extensions",
  "--no-skills",
  "--no-rules",
  "--no-context-files",
  "--no-lsp",
] as const;

const isTextGenerationError = Schema.is(TextGenerationError);

const firstLine = (text: string): string | undefined =>
  stripAnsi(text)
    .split("\n")
    .map((line) => line.trim())
    .find((line) => line !== "");

export const makeOhMyPiTextGeneration = Effect.fn("makeOhMyPiTextGeneration")(function* (options: {
  readonly resolveSpawn: (cwd: string) => Effect.Effect<OmpSpawn, AcpRegistryOperationError>;
}): Effect.fn.Return<ProviderTextGeneration, never, ChildProcessSpawner.ChildProcessSpawner> {
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;

  const run: TextGenerationOperations.Runner = Effect.fn("OhMyPiTextGeneration.run")(
    function* (request) {
      const { operation, cwd, prompt, modelSelection } = request;
      const spawn = yield* options
        .resolveSpawn(cwd)
        .pipe(
          Effect.mapError(
            (cause) =>
              new TextGenerationError({ operation, detail: "Could not locate Oh My Pi.", cause }),
          ),
        );
      const thinking = getModelSelectionStringOptionValue(modelSelection, "thinking");
      const args = [
        ...OMP_PRINT_ARGS,
        ...(modelSelection.model === "default" ? [] : ["--model", modelSelection.model]),
        ...(thinking === undefined ? [] : ["--thinking", thinking]),
      ];
      const child = yield* spawnOmp(spawn, args).pipe(
        Effect.provideService(ChildProcessSpawner.ChildProcessSpawner, spawner),
        Effect.mapError(
          (cause) => new TextGenerationError({ operation, detail: cause.detail, cause }),
        ),
      );
      yield* child.write(prompt);
      yield* child.endInput;
      const [stdout, stderr] = yield* Effect.all(
        [
          child.stdout.pipe(
            Stream.runFold(
              () => "",
              (all, chunk) => (all.length < MAX_OUTPUT ? all + chunk : all),
            ),
          ),
          child.stderr.pipe(
            Stream.runFold(
              () => "",
              (all, chunk) => (all.length < MAX_STDERR ? all + chunk : all),
            ),
          ),
        ],
        { concurrency: "unbounded" },
      );
      const exitCode = yield* child.exitCode;
      if (exitCode !== 0) {
        return yield* new TextGenerationError({
          operation,
          detail: firstLine(stderr) ?? `Oh My Pi exited with code ${exitCode}.`,
        });
      }
      const text = stdout.trim();
      if (!text) {
        return yield* new TextGenerationError({
          operation,
          detail: "Oh My Pi returned empty output.",
        });
      }
      return yield* TextGenerationOperations.decodeJsonReply(request, "Oh My Pi", text);
    },
    (effect, request) =>
      effect.pipe(
        Effect.timeoutOption(OMP_TIMEOUT_MS),
        Effect.flatMap(
          Option.match({
            onNone: () =>
              Effect.fail(
                new TextGenerationError({
                  operation: request.operation,
                  detail: "Oh My Pi request timed out.",
                }),
              ),
            onSome: (value) => Effect.succeed(value),
          }),
        ),
        Effect.mapError((cause) =>
          isTextGenerationError(cause)
            ? cause
            : new TextGenerationError({
                operation: request.operation,
                detail: "Oh My Pi text generation failed.",
                cause,
              }),
        ),
        Effect.scoped,
      ),
  );

  return TextGenerationOperations.fromRunner(
    "OhMyPiTextGeneration",
    TextGenerationOperations.withoutInvestigation("Oh My Pi", run),
  );
});
