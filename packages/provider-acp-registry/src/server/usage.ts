import * as Effect from "effect/Effect";
import * as Path from "effect/Path";

import type { ProviderUsageReader, UsageRecord } from "@t3tools/provider-core/server/usage";
import * as HostProcess from "@t3tools/shared/HostProcess";
import { piUsageFormat } from "@t3tools/provider-pi/server/usage";
import type { AcpRegistrySettings } from "../settings.ts";
import { OMP_AGENT_ID } from "./ompAcp.ts";

type PiParseState = Parameters<typeof piUsageFormat.parseLine>[1];

const asOmp = (records: readonly UsageRecord[]): readonly UsageRecord[] =>
  records.map((record) => ({ ...record, provider: "omp" as const }));

const ompUsageFormat = {
  ...piUsageFormat,
  parseLine: (line: string, state: PiParseState) => asOmp(piUsageFormat.parseLine(line, state)),
  parseProjected: (projected: unknown, state: PiParseState) =>
    asOmp(piUsageFormat.parseProjected(projected, state)),
} satisfies typeof piUsageFormat;

export const acpRegistryUsageReader: ProviderUsageReader<AcpRegistrySettings, Path.Path> = {
  kind: "transcripts",
  provider: "omp",
  format: ompUsageFormat,
  directories: Effect.fn("acpRegistryUsageReader.directories")(function* ({ config }) {
    if (config?.agentId !== OMP_AGENT_ID) return [];
    const path = yield* Path.Path;
    const home = yield* HostProcess.HomeDirectory;
    return [{ dir: path.join(home, ".omp", "agent", "sessions") }];
  }),
};
