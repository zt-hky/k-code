import {
  type AcpRegistryOperationError,
  type AcpRegistryProbeModel,
  type ProviderInstanceId,
  type ServerProvider,
  type ServerProviderAuth,
  type ServerProviderModel,
} from "@t3tools/contracts";
import type {
  AcpRegistryConfigurationProbeResult,
  AcpRegistryLiveConfiguration,
} from "@t3tools/provider-acp-registry/server/probe";
import {
  isCommandMissingCause,
  parseGenericCliVersion,
  providerModelsFromSettings,
  spawnAndCollect,
} from "@t3tools/provider-core/server/snapshotProbe";
import { createModelCapabilities } from "@t3tools/shared/model";
import { resolveSpawnCommand } from "@t3tools/shared/shell";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as ChildProcess from "effect/process/ChildProcess";
import type * as ChildProcessSpawner from "effect/process/ChildProcessSpawner";

import type { OhMyPiSettings } from "../settings.ts";
import { OMP_MODE_OPTION_ID } from "./acp.ts";
import { OHMYPI_DRIVER_KIND } from "./kind.ts";
import { OMP_SEARCH_PROVIDER_IDS } from "./loginOutput.ts";

const OHMYPI_DOCUMENTATION_URL = "https://omp.sh";
const VERSION_PROBE_TIMEOUT_MS = 10_000;
const EMPTY_CAPABILITIES = createModelCapabilities({ optionDescriptors: [] });
const MAX_AUTH_LABEL_PROVIDERS = 3;

export interface OhMyPiSnapshotIdentity {
  readonly instanceId: ProviderInstanceId;
  readonly displayName: string | undefined;
  readonly accentColor: string | undefined;
  readonly continuationKey: string;
}

export type OhMyPiInstall =
  | { readonly installed: true; readonly version: string | null }
  | { readonly installed: false; readonly detail: string };

/** `omp --version` prints `omp/18.13.2`. */
export function parseOmpVersion(output: string): string | null {
  return parseGenericCliVersion(output);
}

/** Runs `omp --version` the way the instance's sessions would start omp. */
export const probeOhMyPiInstall = Effect.fn("OhMyPiStatus.probeInstall")(function* (
  settings: Pick<OhMyPiSettings, "binaryPath">,
  environment: NodeJS.ProcessEnv,
): Effect.fn.Return<OhMyPiInstall, never, ChildProcessSpawner.ChildProcessSpawner> {
  const command = settings.binaryPath || "omp";
  const outcome = yield* Effect.gen(function* () {
    const spawnCommand = yield* resolveSpawnCommand(command, ["--version"], { env: environment });
    return yield* spawnAndCollect(
      command,
      ChildProcess.make(spawnCommand.command, spawnCommand.args, {
        env: environment,
        shell: spawnCommand.shell,
      }),
    );
  }).pipe(Effect.timeoutOption(VERSION_PROBE_TIMEOUT_MS), Effect.result);
  if (outcome._tag === "Failure") {
    return {
      installed: false,
      detail: isCommandMissingCause(outcome.failure)
        ? `Oh My Pi (\`${command}\`) was not found on this environment's PATH.`
        : `Could not run \`${command} --version\`.`,
    };
  }
  if (Option.isNone(outcome.success)) {
    return { installed: false, detail: `\`${command} --version\` timed out.` };
  }
  const { code, stdout, stderr } = outcome.success.value;
  if (code !== 0) {
    return { installed: false, detail: `\`${command} --version\` exited with code ${code}.` };
  }
  return { installed: true, version: parseOmpVersion(`${stdout}\n${stderr}`) };
});

export interface OhMyPiSignedIn {
  readonly providers: ReadonlyArray<{ readonly providerId: string; readonly name: string }>;
}

/** Search-only keys (Tavily, Kagi, ...) are not model providers. */
export function signedInModelProviders(
  providers: ReadonlyArray<{
    readonly providerId: string;
    readonly name: string;
    readonly authenticated: boolean;
  }>,
): OhMyPiSignedIn {
  return {
    providers: providers.filter(
      (provider) => provider.authenticated && !OMP_SEARCH_PROVIDER_IDS.has(provider.providerId),
    ),
  };
}

const authenticatedAuth = (signedIn: OhMyPiSignedIn | undefined): ServerProviderAuth => {
  const names = signedIn?.providers.map((provider) => provider.name) ?? [];
  const shown = names.slice(0, MAX_AUTH_LABEL_PROVIDERS).join(", ");
  const extra = names.length - MAX_AUTH_LABEL_PROVIDERS;
  return {
    status: "authenticated",
    type: "model_providers",
    ...(shown ? { label: extra > 0 ? `${shown} +${extra}` : shown } : {}),
    // Sign-out is per model provider and lives in the sign-in panel.
    canLogout: false,
  };
};

/** Discovery's mode option is hidden: T3's Build/Plan toggle owns omp's native plan mode. */
export function ompModelsFromDiscovery(
  discovery:
    | Pick<AcpRegistryLiveConfiguration, "models" | "currentModelId" | "configOptions">
    | undefined,
  customModels: ReadonlyArray<string>,
): ReadonlyArray<ServerProviderModel> {
  const discovered = discovery?.models ?? [];
  const optionDescriptors = discovery?.configOptions.filter(
    (option) => option.id !== OMP_MODE_OPTION_ID,
  );
  const capabilities =
    optionDescriptors === undefined || optionDescriptors.length === 0
      ? EMPTY_CAPABILITIES
      : createModelCapabilities({ optionDescriptors });
  const builtIn: ReadonlyArray<ServerProviderModel> =
    discovered.length === 0
      ? [{ slug: "default", name: "Default", isCustom: false, isDefault: true, capabilities }]
      : discovered.map((model: AcpRegistryProbeModel) => {
          // omp ids read `<model provider>/<model>`.
          const separator = model.id.indexOf("/");
          return {
            slug: model.id,
            name: model.name,
            ...(separator > 0 ? { subProvider: model.id.slice(0, separator) } : {}),
            isCustom: false,
            ...(model.id === discovery?.currentModelId ? { isDefault: true } : {}),
            capabilities,
          };
        });
  return providerModelsFromSettings(builtIn, customModels, capabilities);
}

export interface OhMyPiSnapshotInput extends OhMyPiSnapshotIdentity {
  readonly settings: OhMyPiSettings;
  readonly checkedAt: string;
  /** Absent while the install check has not run. */
  readonly install?: OhMyPiInstall;
  /** From `get_login_providers`; undefined when it could not be read. */
  readonly signedIn?: OhMyPiSignedIn;
  readonly probe?: AcpRegistryConfigurationProbeResult;
  readonly probeError?: AcpRegistryOperationError;
}

const SIGN_IN_MESSAGE =
  "Sign in to a model provider (Claude, ChatGPT, GitHub Copilot, an API key ...) to use Oh My Pi.";

/** One pure mapping from what was observed to the snapshot clients render. */
export function buildOhMyPiSnapshot(input: OhMyPiSnapshotInput): ServerProvider {
  const { settings } = input;
  const base = {
    instanceId: input.instanceId,
    driver: OHMYPI_DRIVER_KIND,
    ...(input.displayName ? { displayName: input.displayName } : {}),
    ...(input.accentColor ? { accentColor: input.accentColor } : {}),
    continuation: { groupKey: input.continuationKey },
    supportsTextGeneration: false,
    enabled: settings.enabled,
    checkedAt: input.checkedAt,
    showInteractionModeToggle: true,
    modelProviderLogin: true,
    slashCommands: input.probe?.slashCommands ?? [],
    skills: input.probe?.skills ?? [],
  } satisfies Partial<ServerProvider>;
  const installed = input.install?.installed === true;
  const version = input.install?.installed === true ? input.install.version : null;

  if (!settings.enabled) {
    return {
      ...base,
      installed,
      version,
      status: "disabled",
      auth: { status: "unknown" },
      setup: { canAuthenticate: false, canInstall: false },
      message: "Oh My Pi is disabled in T3 Code settings.",
      models: ompModelsFromDiscovery(undefined, settings.customModels as ReadonlyArray<string>),
    };
  }
  if (input.install === undefined) {
    return {
      ...base,
      installed: true,
      version: null,
      status: "warning",
      auth: { status: "unknown" },
      setup: { canAuthenticate: false, canInstall: false },
      message: "Checking Oh My Pi...",
      models: ompModelsFromDiscovery(undefined, settings.customModels as ReadonlyArray<string>),
    };
  }
  if (!input.install.installed) {
    return {
      ...base,
      installed: false,
      version: null,
      status: "error",
      auth: { status: "unknown" },
      setup: {
        canAuthenticate: false,
        canInstall: false,
        documentationUrl: OHMYPI_DOCUMENTATION_URL,
      },
      message: `${input.install.detail} Install Oh My Pi from ${OHMYPI_DOCUMENTATION_URL}, or set its binary path in provider settings.`,
      models: ompModelsFromDiscovery(undefined, settings.customModels as ReadonlyArray<string>),
    };
  }

  const customModels = settings.customModels as ReadonlyArray<string>;
  const setup = {
    canAuthenticate: true,
    canInstall: false,
    documentationUrl: OHMYPI_DOCUMENTATION_URL,
  };
  const withProbe = input.probe === undefined ? {} : nativeSessionFlags(input.probe);
  const discoveredModels = input.probe?.probe.models ?? [];
  const signedIn = input.signedIn;

  // omp lists a model only when a model provider's credential is usable, so an answered
  // discovery with no models means nothing is signed in, even if the provider list was unclear.
  const noCredential =
    signedIn !== undefined
      ? signedIn.providers.length === 0
      : input.probe !== undefined && discoveredModels.length === 0;
  if (noCredential && input.probeError === undefined) {
    return {
      ...base,
      ...withProbe,
      installed: true,
      version,
      status: "error",
      auth: { status: "unauthenticated", canLogout: false },
      setup,
      message: SIGN_IN_MESSAGE,
      models: ompModelsFromDiscovery(input.probe?.probe, customModels),
    };
  }
  if (input.probeError !== undefined) {
    return {
      ...base,
      installed: true,
      version,
      // Failed discovery is a warning: an installed agent may still run real turns.
      status: "warning",
      auth: signedIn !== undefined ? authenticatedAuth(signedIn) : { status: "unknown" },
      setup,
      message: input.probeError.message,
      models: ompModelsFromDiscovery(undefined, customModels),
    };
  }
  if (input.probe === undefined) {
    return {
      ...base,
      installed: true,
      version,
      status: "ready",
      auth: signedIn !== undefined ? authenticatedAuth(signedIn) : { status: "unknown" },
      setup,
      message: "Loading Oh My Pi models and commands in the background...",
      models: ompModelsFromDiscovery(undefined, customModels),
    };
  }
  if (discoveredModels.length === 0) {
    return {
      ...base,
      ...withProbe,
      installed: true,
      version,
      status: "warning",
      auth: authenticatedAuth(signedIn),
      setup,
      message: "Oh My Pi did not list any models. Check its configuration or sign in again.",
      models: ompModelsFromDiscovery(input.probe.probe, customModels),
    };
  }
  return {
    ...base,
    ...withProbe,
    installed: true,
    version,
    status: "ready",
    auth: authenticatedAuth(signedIn),
    setup,
    models: ompModelsFromDiscovery(input.probe.probe, customModels),
  };
}

function nativeSessionFlags(probe: AcpRegistryConfigurationProbeResult) {
  const management = probe.probe.sessionManagement;
  return {
    nativeSessions: {
      canList: management.canList,
      canLoad: management.canLoad,
      canResume: management.canResume,
      canDelete: management.canDelete,
      canListProjects: true,
    },
    configurableProviders: management.canConfigureProviders,
    manageableExtensions: true,
  } satisfies Partial<ServerProvider>;
}

/** Live session configuration replaces the discovered models without a new probe. */
export function applyOhMyPiLiveConfiguration(
  provider: ServerProvider,
  configuration: AcpRegistryLiveConfiguration,
  customModels: ReadonlyArray<string>,
): ServerProvider {
  const { message: _staleProbeMessage, ...snapshot } = provider;
  return {
    ...snapshot,
    status:
      provider.enabled && provider.auth.status !== "unauthenticated" ? "ready" : provider.status,
    models: ompModelsFromDiscovery(configuration, customModels),
  };
}
