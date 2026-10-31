import * as NodeServices from "@effect/platform-node/NodeServices";
import { expect, it } from "@effect/vitest";
import { ProviderInstanceId } from "@t3tools/contracts";
import { createModelSelection } from "@t3tools/shared/model";
import * as Effect from "effect/Effect";
import * as Queue from "effect/Queue";
import * as ChildProcessSpawner from "effect/process/ChildProcessSpawner";

import { makeHarness, type FakeChild } from "./loginHarness.testkit.ts";
import { makeOhMyPiTextGeneration } from "./textGeneration.ts";

const run = (
  script: (child: FakeChild, written: string) => Effect.Effect<void>,
  model = "default",
  options?: Parameters<typeof createModelSelection>[2],
) =>
  Effect.gen(function* () {
    const h = yield* makeHarness(script);
    const textGeneration = yield* makeOhMyPiTextGeneration({
      resolveSpawn: (cwd) => Effect.succeed({ command: "omp", env: {}, cwd }),
    }).pipe(Effect.provideService(ChildProcessSpawner.ChildProcessSpawner, h.spawner));
    const result = yield* textGeneration
      .generateBranchName({
        cwd: process.cwd(),
        message: "Fix login",
        modelSelection: createModelSelection(ProviderInstanceId.make("omp"), model, options),
      })
      .pipe(Effect.result);
    const child = yield* Queue.take(h.spawned);
    return { result, child };
  });

it.live("runs omp print mode with the prompt on stdin and decodes the JSON reply", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const { result, child } = yield* run(
        (c) => c.emit('Here:\n{"branch":"fix-login"}\n').pipe(Effect.andThen(c.exit(0))),
        "anthropic/claude-sonnet-4-5",
        [{ id: "thinking", value: "low" }],
      );
      expect(result._tag).toBe("Success");
      expect(child.args).toEqual([
        "-p",
        "--no-session",
        "--no-tools",
        "--no-extensions",
        "--no-skills",
        "--no-rules",
        "--no-context-files",
        "--no-lsp",
        "--model",
        "anthropic/claude-sonnet-4-5",
        "--thinking",
        "low",
      ]);
      const prompt = yield* Queue.take(child.written);
      expect(prompt).toContain("Fix login");
    }),
  ).pipe(Effect.provide(NodeServices.layer)),
);

it.live("surfaces the first stderr line when omp exits non-zero", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const { result } = yield* run((c) =>
        c.emitStderr('Model "nope" not found\nmore\n').pipe(Effect.andThen(c.exit(1))),
      );
      expect(result._tag).toBe("Failure");
      if (result._tag === "Failure") {
        expect(result.failure.detail).toBe('Model "nope" not found');
      }
    }),
  ).pipe(Effect.provide(NodeServices.layer)),
);

it.live("fails on empty output", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const { result, child } = yield* run((c) => c.emit("  \n").pipe(Effect.andThen(c.exit(0))));
      expect(child.args).not.toContain("--model");
      expect(result._tag).toBe("Failure");
      if (result._tag === "Failure") {
        expect(result.failure.detail).toBe("Oh My Pi returned empty output.");
      }
    }),
  ).pipe(Effect.provide(NodeServices.layer)),
);
