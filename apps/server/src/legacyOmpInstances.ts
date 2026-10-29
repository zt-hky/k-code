import {
  ProviderDriverKind,
  type ProviderInstanceConfig,
  type ServerSettings,
} from "@t3tools/contracts";

const ACP_REGISTRY_DRIVER = ProviderDriverKind.make("acpRegistry");
const OHMYPI_DRIVER = ProviderDriverKind.make("ohmypi");
const OMP_REGISTRY_AGENT_ID = "omp";
const OMP_EXECUTABLE = /^omp(?:\.exe|\.cmd)?$/i;

const INSTRUCTION_KEYS = [
  "instructionInteractionMode",
  "instructionT3Tools",
  "instructionRuntimeInfo",
  "instructionPullRequestLinking",
] as const;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const nonEmptyString = (value: unknown): string | undefined =>
  typeof value === "string" && value.trim() !== "" ? value.trim() : undefined;

/**
 * Oh My Pi used to run as an ACP Registry agent (`agentId: "omp"`), or as a local `omp acp`
 * command. Returns the config of the `ohmypi` driver that replaces it, or undefined for any
 * other instance. Only fields the new driver reads survive.
 */
function ompDriverConfig(instance: ProviderInstanceConfig): Record<string, unknown> | undefined {
  if (instance.driver !== ACP_REGISTRY_DRIVER || !isRecord(instance.config)) return undefined;
  const config = instance.config;
  const commandPath = nonEmptyString(config.commandPath);
  const registryOmp =
    config.source !== "local" && nonEmptyString(config.agentId) === OMP_REGISTRY_AGENT_ID;
  const localOmp =
    config.source === "local" &&
    commandPath !== undefined &&
    OMP_EXECUTABLE.test(commandPath.split(/[\\/]/).pop() ?? "") &&
    Array.isArray(config.commandArgs) &&
    config.commandArgs.length === 1 &&
    config.commandArgs[0] === "acp";
  if (!registryOmp && !localOmp) return undefined;
  return {
    ...(commandPath === undefined ? {} : { binaryPath: commandPath }),
    ...(Array.isArray(config.customModels) ? { customModels: config.customModels } : {}),
    ...Object.fromEntries(
      INSTRUCTION_KEYS.flatMap((key) =>
        typeof config[key] === "boolean" ? [[key, config[key]]] : [],
      ),
    ),
  };
}

/**
 * Moves legacy Oh My Pi ACP Registry instances to the `ohmypi` driver. The instance id stays, so
 * threads, project overrides and model selections keep pointing at it; identity, environment and
 * the enabled flag carry over unchanged.
 */
export function migrateLegacyOmpInstances(settings: ServerSettings): ServerSettings {
  let changed = false;
  const providerInstances: Record<string, ProviderInstanceConfig> = {};
  for (const [instanceId, instance] of Object.entries(settings.providerInstances)) {
    const config = ompDriverConfig(instance);
    if (config === undefined) {
      providerInstances[instanceId] = instance;
      continue;
    }
    changed = true;
    providerInstances[instanceId] = { ...instance, driver: OHMYPI_DRIVER, config };
  }
  return changed
    ? { ...settings, providerInstances: providerInstances as ServerSettings["providerInstances"] }
    : settings;
}
