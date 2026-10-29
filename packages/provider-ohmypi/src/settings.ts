// Shared with the client settings form; keep schema code browser-safe.
import {
  CustomModelSetting,
  makeBinaryPathSetting,
  makeProviderSettingsSchema,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

const instructionToggle = (title: string, description: string) =>
  Schema.Boolean.pipe(
    Schema.withDecodingDefault(Effect.succeed(true)),
    Schema.annotateKey({ title, description, providerSettingsForm: { control: "switch" } }),
  );

export const OhMyPiSettings = makeProviderSettingsSchema(
  {
    // On by default, like Codex and Claude: an environment with `omp` on PATH needs no setup.
    enabled: Schema.Boolean.pipe(
      Schema.withDecodingDefault(Effect.succeed(true)),
      Schema.annotateKey({ providerSettingsForm: { hidden: true } }),
    ),
    binaryPath: makeBinaryPathSetting("omp").pipe(
      Schema.annotateKey({
        title: "Binary path",
        description: "Path to the Oh My Pi (omp) binary.",
        providerSettingsForm: { placeholder: "omp", clearWhenEmpty: "omit" },
      }),
    ),
    customModels: Schema.Array(CustomModelSetting).pipe(
      Schema.withDecodingDefault(Effect.succeed([])),
      Schema.annotateKey({ providerSettingsForm: { hidden: true } }),
    ),
    instructionInteractionMode: instructionToggle(
      "Interaction mode instructions",
      "Tells the agent whether T3 is in Default or Plan mode.",
    ),
    instructionT3Tools: instructionToggle(
      "T3 tool instructions",
      "Explains when to use T3 tools such as delegation, browser preview, and visuals. The tools stay available when this is off.",
    ),
    instructionRuntimeInfo: instructionToggle(
      "Runtime info",
      "Tells the agent which harness and model it runs as.",
    ),
    instructionPullRequestLinking: instructionToggle(
      "Pull request linking",
      "Asks the agent to link pull requests it creates or pushes to this thread.",
    ),
  },
  {
    order: ["binaryPath"],
  },
);
export type OhMyPiSettings = typeof OhMyPiSettings.Type;
