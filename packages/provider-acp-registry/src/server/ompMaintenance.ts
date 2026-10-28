import { ProviderDriverKind } from "@t3tools/contracts";
import {
  makeProviderMaintenanceCapabilities,
  runMaintenanceProbe,
  type ProviderMaintenanceCapabilities,
} from "@t3tools/provider-core/server/maintenanceResolver";
import * as Effect from "effect/Effect";
import * as ChildProcessSpawner from "effect/process/ChildProcessSpawner";

const DRIVER = ProviderDriverKind.make("acpRegistry");

/** `omp update --check` prints "New version available: X" only when one exists. */
export function parseOmpLatestVersion(output: string): string | null {
  const available = output.match(/New version available:\s*v?(\d+\.\d+\.\d+\S*)/i);
  if (available) return available[1] ?? null;
  return output.match(/Current version:\s*v?(\d+\.\d+\.\d+\S*)/i)?.[1] ?? null;
}

/** omp updates itself in place, so the update command is its own `update` subcommand. */
export const ompMaintenance = (input: {
  readonly executable: string;
  readonly env: NodeJS.ProcessEnv;
  readonly spawner: ChildProcessSpawner.ChildProcessSpawner["Service"];
}): ProviderMaintenanceCapabilities =>
  makeProviderMaintenanceCapabilities({
    provider: DRIVER,
    packageName: null,
    updateExecutable: input.executable,
    updateArgs: ["update"],
    updateLockKey: `omp:${input.executable}`,
    env: input.env,
    lookupLatestVersion: runMaintenanceProbe(
      input.executable,
      ["update", "--check"],
      input.env,
    ).pipe(
      Effect.map((output) => (output ? parseOmpLatestVersion(output) : null)),
      Effect.provideService(ChildProcessSpawner.ChildProcessSpawner, input.spawner),
    ),
  });
