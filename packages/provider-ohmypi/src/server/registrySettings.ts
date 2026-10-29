import { AcpRegistrySettings } from "@t3tools/provider-acp-registry/settings";
import { readCustomModelEntries } from "@t3tools/shared/model";
import * as Schema from "effect/Schema";

import type { OhMyPiSettings } from "../settings.ts";

const decodeRegistrySettings = Schema.decodeSync(AcpRegistrySettings);

/**
 * The ACP Registry machinery (probe, session management, runtime launch) is agent-agnostic once
 * it has a local command, so Oh My Pi feeds it `omp acp` as a local source.
 */
export const toAcpRegistrySettings = (settings: OhMyPiSettings): AcpRegistrySettings =>
  decodeRegistrySettings({
    source: "local",
    enabled: settings.enabled,
    commandPath: settings.binaryPath,
    commandArgs: ["acp"],
    customModels: readCustomModelEntries(settings.customModels).map((entry) => entry.slug),
    instructionInteractionMode: settings.instructionInteractionMode,
    instructionT3Tools: settings.instructionT3Tools,
    instructionRuntimeInfo: settings.instructionRuntimeInfo,
    instructionPullRequestLinking: settings.instructionPullRequestLinking,
  });
