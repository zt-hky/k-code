import { readCustomModelEntries } from "@t3tools/shared/model";
import * as HostProcess from "@t3tools/shared/HostProcess";
import { resolveSelfInvocation, type SelfInvocation } from "@t3tools/shared/nodeRuntime";
import * as Crypto from "effect/Crypto";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import type * as Scope from "effect/Scope";
import * as ChildProcessSpawner from "effect/process/ChildProcessSpawner";
import * as EffectAcpErrors from "effect-acp/errors";

import * as AcpRegistryRuntimeCoordinator from "@t3tools/provider-acp-registry/server/AcpRegistryRuntimeCoordinator";
import * as AcpRegistrySupport from "@t3tools/provider-acp-registry/server/AcpRegistrySupport";
import {
  normalizeAcpRegistryCommands,
  normalizeAcpRegistryLiveConfiguration,
} from "@t3tools/provider-acp-registry/server/probe";
import * as AcpSessionRuntime from "@t3tools/provider-acp/server/AcpSessionRuntime";
import {
  AcpProviderCapabilitiesV2,
  makeAcpAdapterV2,
  type AcpAdapterV2Flavor,
  type AcpAdapterV2RuntimeInput,
} from "@t3tools/provider-acp/server/adapter";
import { makeAcpNativeLoggerFactory } from "@t3tools/provider-acp/server/nativeLogging";
import {
  ProviderAdapterDriverCreateError,
  type ProviderAdapterDriver,
  type ProviderAdapterDriverCreateInput,
} from "@t3tools/provider-core/server/adapterDriver";
import * as IdAllocator from "@t3tools/provider-core/server/IdAllocator";
import { mergeProviderInstanceEnvironment } from "@t3tools/provider-core/server/instanceEnvironment";
import * as McpProviderSessions from "@t3tools/provider-core/server/McpProviderSessions";
import * as ProviderContinuationRequests from "@t3tools/provider-core/server/ProviderContinuationRequests";
import * as ProviderEventLoggers from "@t3tools/provider-core/server/ProviderEventLoggers";
import * as ProviderHost from "@t3tools/provider-core/server/ProviderHost";
import { makeProviderFailure } from "@t3tools/provider-core/server/failure";
import * as Schema from "effect/Schema";

import { OhMyPiSettings } from "../settings.ts";
import {
  extractOmpPlanApprovalElicitation,
  extractOmpProposedPlanMarkdown,
  extractOmpSubagentUpdate,
  makeOmpSubagentStopper,
  makeOmpSubagentTranscriptReader,
  OMP_MODE_OPTION_ID,
} from "./acp.ts";
import { makeAnsiFilter, type AnsiFilter } from "./ansi.ts";
import { extractOmpAskElicitationForm, isOmpAskToolCall } from "./ask.ts";
import { OHMYPI_DRIVER_KIND } from "./kind.ts";
import { toAcpRegistrySettings } from "./registrySettings.ts";
import { OMP_SKILL_PREFIXES, rewriteOmpSkillMentions } from "./skills.ts";
import {
  materializeOmpStopExtension,
  T3_OMP_STOP_DIR_ENV,
  type OmpStopExtension,
} from "./stopExtension.ts";

const DEFAULT_SETTINGS = Schema.decodeSync(OhMyPiSettings)({});
const isAcpRequestError = Schema.is(EffectAcpErrors.AcpRequestError);

const ompPromptFailure = (cause: unknown) =>
  makeProviderFailure({
    cause,
    ...(isAcpRequestError(cause)
      ? {
          message: cause.errorMessage,
          code: String(cause.code),
          class: "provider_error" as const,
        }
      : { class: "provider_error" as const }),
  });

export interface OhMyPiAdapterV2Options {
  readonly instanceId: Parameters<typeof makeAcpAdapterV2>[0]["instanceId"];
  readonly settings: OhMyPiSettings;
  readonly environment: NodeJS.ProcessEnv;
  readonly selfInvocation: SelfInvocation;
  /** When set, omp loads the extension that lets one subagent be cancelled on request. */
  readonly stopExtension?: OmpStopExtension;
  readonly nativeLogging?: Parameters<typeof makeAcpAdapterV2>[0]["nativeLogging"];
  readonly makeRuntime?: (
    input: AcpAdapterV2RuntimeInput,
  ) => Effect.Effect<
    AcpSessionRuntime.AcpSessionRuntime["Service"],
    EffectAcpErrors.AcpError,
    ChildProcessSpawner.ChildProcessSpawner | Crypto.Crypto | Scope.Scope
  >;
  readonly continuationRequests?: Parameters<typeof makeAcpAdapterV2>[0]["continuationRequests"];
}

function makeOmpRuntime(
  options: OhMyPiAdapterV2Options,
  catalog: AcpRegistrySupport.AcpRegistryCatalog["Service"],
) {
  const registrySettings = toAcpRegistrySettings(options.settings);
  return (
    input: AcpAdapterV2RuntimeInput,
  ): Effect.Effect<
    AcpSessionRuntime.AcpSessionRuntime["Service"],
    EffectAcpErrors.AcpError,
    ChildProcessSpawner.ChildProcessSpawner | Crypto.Crypto | Scope.Scope
  > =>
    Effect.gen(function* () {
      const { processEnvironment, ...runtimeInput } = input;
      const resolved = yield* catalog
        .resolve(registrySettings, input.cwd, options.environment)
        .pipe(
          Effect.mapError(
            (cause) =>
              new EffectAcpErrors.AcpSpawnError({ command: options.settings.binaryPath, cause }),
          ),
        );
      const context = yield* Layer.build(
        AcpSessionRuntime.layer({
          ...runtimeInput,
          spawn: {
            ...resolved.spawn,
            ...(options.stopExtension === undefined
              ? {}
              : {
                  args: [
                    ...resolved.spawn.args,
                    "--extension",
                    options.stopExtension.extensionPath,
                  ],
                }),
            env: {
              ...resolved.spawn.env,
              ...(options.stopExtension === undefined
                ? {}
                : { [T3_OMP_STOP_DIR_ENV]: options.stopExtension.stopDir }),
              ...processEnvironment,
            },
          },
          customModels: readCustomModelEntries(options.settings.customModels).map(
            (entry) => entry.slug,
          ),
        }),
      );
      return yield* Effect.service(AcpSessionRuntime.AcpSessionRuntime).pipe(
        Effect.provide(context),
      );
    });
}

export const makeOhMyPiAdapterV2 = Effect.fn("makeOhMyPiAdapterV2")(function* (
  options: OhMyPiAdapterV2Options,
) {
  const catalog = yield* AcpRegistrySupport.AcpRegistryCatalog;
  const runtimeCoordinator = Option.getOrUndefined(
    yield* Effect.serviceOption(AcpRegistryRuntimeCoordinator.AcpRegistryRuntimeCoordinator),
  );
  const fileSystem = Option.getOrUndefined(yield* Effect.serviceOption(FileSystem.FileSystem));
  const path = Option.getOrUndefined(yield* Effect.serviceOption(Path.Path));
  let skillNames: ReadonlySet<string> = new Set();
  const ansiFilters = new Map<string, AnsiFilter>();
  // omp's default agent dir; PI_CODING_AGENT_DIR overrides it.
  const agentDir =
    options.environment.PI_CODING_AGENT_DIR ??
    (options.environment.HOME === undefined || path === undefined
      ? undefined
      : path.join(options.environment.HOME, ".omp", "agent"));
  const readSubagentTranscript =
    fileSystem === undefined || path === undefined || agentDir === undefined
      ? undefined
      : makeOmpSubagentTranscriptReader({ fileSystem, path, agentDir });
  const stopSubagent =
    fileSystem === undefined ||
    path === undefined ||
    agentDir === undefined ||
    options.stopExtension === undefined
      ? undefined
      : makeOmpSubagentStopper({
          fileSystem,
          path,
          agentDir,
          stopDir: options.stopExtension.stopDir,
        });
  const startupKey = `ohmypi:${options.instanceId}`;
  const flavor: AcpAdapterV2Flavor = {
    driver: OHMYPI_DRIVER_KIND,
    capabilities: AcpProviderCapabilitiesV2,
    runtimeHarness: "Oh My Pi",
    customModels: readCustomModelEntries(options.settings.customModels).map((entry) => entry.slug),
    promptFailure: ompPromptFailure,
    instructionSections: {
      interactionMode: options.settings.instructionInteractionMode,
      t3Tools: options.settings.instructionT3Tools,
      runtimeInfo: options.settings.instructionRuntimeInfo,
      pullRequestLinking: options.settings.instructionPullRequestLinking,
    },
    extractElicitationForm: extractOmpAskElicitationForm,
    isUserInputTool: isOmpAskToolCall,
    extractProposedPlanMarkdown: extractOmpProposedPlanMarkdown,
    planApprovalElicitation: extractOmpPlanApprovalElicitation,
    interactionModeOptionIds: [OMP_MODE_OPTION_ID],
    supportsSessionSteering: true,
    supportsCompaction: true,
    extractSubagentUpdate: extractOmpSubagentUpdate,
    ...(readSubagentTranscript === undefined ? {} : { readSubagentTranscript }),
    ...(stopSubagent === undefined ? {} : { stopSubagent }),
    rewriteUserText: (text: string) => Effect.succeed(rewriteOmpSkillMentions(text, skillNames)),
    normalizeSessionUpdate: (notification) => {
      const update = notification.update;
      if (
        (update.sessionUpdate !== "agent_message_chunk" &&
          update.sessionUpdate !== "agent_thought_chunk") ||
        update.content.type !== "text"
      ) {
        return notification;
      }
      const key = `${notification.sessionId}:${update.sessionUpdate}`;
      let filter = ansiFilters.get(key);
      if (filter === undefined) {
        filter = makeAnsiFilter();
        ansiFilters.set(key, filter);
      }
      return {
        ...notification,
        update: {
          ...update,
          content: { ...update.content, text: filter.push(update.content.text) },
        },
      };
    },
    makeRuntime: options.makeRuntime ?? makeOmpRuntime(options, catalog),
    onAvailableCommandsUpdate: (commands) => {
      const normalized = normalizeAcpRegistryCommands(commands, OMP_SKILL_PREFIXES);
      skillNames = new Set(normalized.skills.map((skill) => skill.name));
      return runtimeCoordinator === undefined
        ? Effect.void
        : runtimeCoordinator.publishAvailableCommands(options.instanceId, normalized);
    },
    ...(runtimeCoordinator === undefined
      ? {}
      : {
          onSessionConfigurationUpdate: (configOptions, modeState, modelState) =>
            runtimeCoordinator.publishLiveConfiguration(
              options.instanceId,
              normalizeAcpRegistryLiveConfiguration(configOptions, modeState, modelState),
            ),
          withRuntimeStartup: <A, E, R>(effect: Effect.Effect<A, E, R>) =>
            runtimeCoordinator.withForegroundStartup(startupKey, effect),
        }),
  };
  return yield* makeAcpAdapterV2({
    instanceId: options.instanceId,
    flavor,
    selfInvocation: options.selfInvocation,
    ...(options.continuationRequests === undefined
      ? {}
      : { continuationRequests: options.continuationRequests }),
    ...(options.nativeLogging === undefined ? {} : { nativeLogging: options.nativeLogging }),
  });
});

export type OhMyPiAdapterV2DriverEnv =
  | ChildProcessSpawner.ChildProcessSpawner
  | Crypto.Crypto
  | FileSystem.FileSystem
  | AcpRegistrySupport.AcpRegistryCatalog
  | IdAllocator.IdAllocatorV2
  | Path.Path
  | McpProviderSessions.McpProviderSessions
  | ProviderEventLoggers.ProviderEventLoggers
  | ProviderHost.ProviderHost;

export const OhMyPiAdapterV2Driver: ProviderAdapterDriver<
  OhMyPiSettings,
  OhMyPiAdapterV2DriverEnv
> = {
  driverKind: OHMYPI_DRIVER_KIND,
  configSchema: OhMyPiSettings,
  defaultConfig: (): OhMyPiSettings => DEFAULT_SETTINGS,
  create: Effect.fn("OhMyPiAdapterV2Driver.create")(
    function* (input: ProviderAdapterDriverCreateInput<OhMyPiSettings>) {
      const hostEnvironment = yield* HostProcess.Environment;
      const selfInvocation = yield* resolveSelfInvocation();
      const providerEventLoggers = yield* ProviderEventLoggers.ProviderEventLoggers;
      const providerHost = yield* ProviderHost.ProviderHost;
      const stopExtension = yield* materializeOmpStopExtension(providerHost.paths.stateDir).pipe(
        Effect.tapError((cause) =>
          Effect.logWarning("Oh My Pi subagent stop is unavailable", { cause }),
        ),
        Effect.option,
        Effect.map(Option.getOrUndefined),
      );
      const makeNativeLogger = yield* makeAcpNativeLoggerFactory();
      return yield* makeOhMyPiAdapterV2({
        instanceId: input.instanceId,
        settings: { ...input.config, enabled: input.enabled },
        environment: yield* mergeProviderInstanceEnvironment(input.environment, hostEnvironment),
        selfInvocation,
        ...(stopExtension === undefined ? {} : { stopExtension }),
        continuationRequests: yield* ProviderContinuationRequests.ProviderContinuationRequests,
        nativeLogging: (threadId) =>
          makeNativeLogger({
            nativeEventLogger: providerEventLoggers.native,
            provider: OHMYPI_DRIVER_KIND,
            threadId,
          }),
      });
    },
    (effect, input) =>
      effect.pipe(
        Effect.mapError(
          (cause) =>
            new ProviderAdapterDriverCreateError({
              driver: OHMYPI_DRIVER_KIND,
              instanceId: input.instanceId,
              detail: "Failed to create Oh My Pi adapter.",
              cause,
            }),
        ),
      ),
  ),
};
