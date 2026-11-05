// Context tags are runtime singletons; drivers need multiple instances.
import type {
  ProviderConsumeResetCreditOutcome,
  AcpRegistryListSessionsResult,
  AcpRegistryListExtensionsResult,
  AcpRegistryListProjectsResult,
  AcpRegistryListProvidersResult,
  AcpRegistrySetExtensionSourceResult,
  AcpRegistryOperationError,
  AcpRegistrySetProviderInput,
  OmpLoginProvider,
  OmpLoginImportCredentialsResult,
  OmpLoginSignOutResult,
  OmpLoginState,
  OmpMcpAddServerInput,
  OmpMcpAuthState,
  OmpMcpChangeResult,
  OmpMcpInspectResult,
  OmpMcpListResult,
  OmpMcpRemoveServerInput,
  OmpMcpSetServerEnabledInput,
  OmpMcpTestServerResult,
  ServerProviderSlashSubcommand,
  ProviderDriverKind,
  ResolvedProviderInstanceEnvironment,
  ProviderInstanceId,
  ServerProvider,
  ServerProviderWorkspaceSnapshot,
} from "@t3tools/contracts";
import type * as Effect from "effect/Effect";
import type * as Schema from "effect/Schema";
import type * as Scope from "effect/Scope";
import type * as Stream from "effect/Stream";

import type * as ProviderAdapter from "./ProviderAdapter.ts";
import type { ProviderAuthController } from "./auth.ts";
import type { ProviderDriverError } from "./errors.ts";
import type { ManagedServerProvider } from "./snapshot.ts";
import type { ProviderTextGeneration } from "./textGeneration.ts";
import type { ProviderUsageReader } from "./usage.ts";

export interface ProviderDriverMetadata {
  readonly displayName: string;
  /** Defaults to true; false rejects multiple instances of a global resource. */
  readonly supportsMultipleInstances?: boolean;
  readonly hasDefaultInstance?: boolean;
}

export type ProviderWorkspaceSnapshot = ServerProvider &
  Pick<ServerProviderWorkspaceSnapshot, "slashCommandsPending" | "optionDescriptors">;

/** Signing in to the model providers behind an agent that has its own login command. */
export interface ProviderModelLogin {
  readonly listProviders: Effect.Effect<ReadonlyArray<OmpLoginProvider>, AcpRegistryOperationError>;
  readonly start: (providerId: string) => Effect.Effect<OmpLoginState, AcpRegistryOperationError>;
  readonly respond: (input: {
    readonly flowId: string;
    readonly promptId: string;
    readonly value: string;
  }) => Effect.Effect<OmpLoginState, AcpRegistryOperationError>;
  readonly cancel: (flowId: string) => Effect.Effect<OmpLoginState, AcpRegistryOperationError>;
  /** Removes one stored account (`credentialId`), or every account of the provider. */
  readonly signOut: (
    providerId: string,
    credentialId?: number,
  ) => Effect.Effect<OmpLoginSignOutResult, AcpRegistryOperationError>;
  /** Merges credentials exported by another machine's `omp auth export` into this instance. */
  readonly importCredentials: (
    credentials: string,
  ) => Effect.Effect<OmpLoginImportCredentialsResult, AcpRegistryOperationError>;
  readonly state: Stream.Stream<OmpLoginState>;
}

/** Where an MCP operation runs: a project's workspace root, or `undefined` for a neutral directory with only user-scoped servers. */
export interface ProviderMcpTarget {
  readonly cwd: string | undefined;
}

/** MCP server and skill management through the agent's own commands; K-code never edits its config. */
export interface ProviderMcpManagement {
  readonly list: (
    cwd: string | undefined,
  ) => Effect.Effect<OmpMcpListResult, AcpRegistryOperationError>;
  readonly addServer: (
    input: ProviderMcpTarget & Omit<OmpMcpAddServerInput, "instanceId" | "projectId">,
  ) => Effect.Effect<OmpMcpChangeResult, AcpRegistryOperationError>;
  readonly removeServer: (
    input: ProviderMcpTarget & Omit<OmpMcpRemoveServerInput, "instanceId" | "projectId">,
  ) => Effect.Effect<OmpMcpChangeResult, AcpRegistryOperationError>;
  readonly setServerEnabled: (
    input: ProviderMcpTarget & Omit<OmpMcpSetServerEnabledInput, "instanceId" | "projectId">,
  ) => Effect.Effect<OmpMcpChangeResult, AcpRegistryOperationError>;
  readonly testServer: (
    input: ProviderMcpTarget & { readonly name: string },
  ) => Effect.Effect<OmpMcpTestServerResult, AcpRegistryOperationError>;
  readonly inspect: (
    cwd: string | undefined,
  ) => Effect.Effect<OmpMcpInspectResult, AcpRegistryOperationError>;
  readonly startAuth: (
    input: ProviderMcpTarget & { readonly name: string },
  ) => Effect.Effect<OmpMcpAuthState, AcpRegistryOperationError>;
  /** Finishes a flow whose browser could not reach the host's loopback callback; `callbackUrl` must be the flow's own redirect URI. */
  readonly completeAuth: (input: {
    readonly flowId: string;
    readonly callbackUrl: string;
  }) => Effect.Effect<OmpMcpAuthState, AcpRegistryOperationError>;
  readonly cancelAuth: (
    flowId: string,
  ) => Effect.Effect<OmpMcpAuthState, AcpRegistryOperationError>;
  readonly authState: Stream.Stream<OmpMcpAuthState>;
  /** Subcommands of the agent's builtin slash commands, by command name; loaded once and kept. */
  readonly subcommandCatalog: Effect.Effect<
    ReadonlyMap<string, ReadonlyArray<ServerProviderSlashSubcommand>>,
    AcpRegistryOperationError
  >;
  /** The catalog if it was already loaded; never starts a process. */
  readonly cachedSubcommandCatalog: Effect.Effect<
    ReadonlyMap<string, ReadonlyArray<ServerProviderSlashSubcommand>> | undefined
  >;
}

export interface ProviderInstance {
  readonly instanceId: ProviderInstanceId;
  readonly driverKind: ProviderDriverKind;
  readonly continuationIdentity: ProviderContinuationIdentity;
  readonly displayName: string | undefined;
  readonly accentColor?: string | undefined;
  readonly enabled: boolean;
  readonly snapshot: ManagedServerProvider;
  readonly snapshotForCwd?: (
    cwd: string,
  ) => Effect.Effect<ProviderWorkspaceSnapshot, ProviderDriverError>;
  readonly refreshModels?: () => Effect.Effect<void, ProviderDriverError>;
  readonly invalidateCaches?: Effect.Effect<void>;
  readonly consumeResetCredit?: () => Effect.Effect<
    ProviderConsumeResetCreditOutcome,
    ProviderDriverError
  >;
  readonly orchestrationAdapter: ProviderAdapter.ProviderAdapterV2["Service"];
  readonly textGeneration: ProviderTextGeneration;
  readonly auth?: ProviderAuthController;
  readonly acpSessionManagement?: {
    readonly listSessions: (input: {
      readonly cwd: string;
      readonly cursor?: string;
    }) => Effect.Effect<AcpRegistryListSessionsResult, AcpRegistryOperationError>;
    readonly logout: (cwd: string) => Effect.Effect<void, AcpRegistryOperationError>;
    readonly deleteSession: (input: {
      readonly cwd: string;
      readonly sessionId: string;
    }) => Effect.Effect<void, AcpRegistryOperationError>;
    readonly listProviders: (
      cwd: string,
    ) => Effect.Effect<AcpRegistryListProvidersResult, AcpRegistryOperationError>;
    readonly setProvider: (
      input: Omit<AcpRegistrySetProviderInput, "instanceId" | "projectId"> & {
        readonly cwd: string;
      },
    ) => Effect.Effect<void, AcpRegistryOperationError>;
    readonly disableProvider: (input: {
      readonly cwd: string;
      readonly providerId: string;
    }) => Effect.Effect<void, AcpRegistryOperationError>;
    readonly listProjects?: () => Effect.Effect<
      AcpRegistryListProjectsResult,
      AcpRegistryOperationError
    >;
    /** Sessions across every working directory; the caller attaches T3 project ids. */
    readonly listAllSessions?: (input: {
      readonly cursor?: string;
    }) => Effect.Effect<AcpRegistryListSessionsResult, AcpRegistryOperationError>;
    /** First user message per session id, for sessions the agent has not titled. Best-effort. */
    readonly resolveFirstMessages?: (
      sessionIds: ReadonlyArray<string>,
    ) => Effect.Effect<ReadonlyMap<string, string>>;
    /** Writes a T3 thread title back into the agent's own session record. Best-effort. */
    readonly renameSession?: (input: {
      readonly sessionId: string;
      readonly title: string;
    }) => Effect.Effect<void>;
    readonly listExtensions?: (
      cwd: string,
    ) => Effect.Effect<AcpRegistryListExtensionsResult, AcpRegistryOperationError>;
    readonly setExtensionSource?: (input: {
      readonly cwd: string;
      readonly providerId: string;
      readonly enabled: boolean;
    }) => Effect.Effect<AcpRegistrySetExtensionSourceResult, AcpRegistryOperationError>;
  };
  readonly modelProviderLogin?: ProviderModelLogin;
  readonly mcpManagement?: ProviderMcpManagement;
}

export interface ProviderContinuationIdentity {
  readonly driverKind: ProviderDriverKind;
  readonly continuationKey: string;
}

export function defaultProviderContinuationIdentity(input: {
  readonly driverKind: ProviderDriverKind;
  readonly instanceId: ProviderInstanceId;
}): ProviderContinuationIdentity {
  return {
    driverKind: input.driverKind,
    continuationKey: `${input.driverKind}:instance:${input.instanceId}`,
  };
}

export interface ProviderDriverCreateInput<Config> {
  readonly instanceId: ProviderInstanceId;
  readonly displayName: string | undefined;
  readonly accentColor?: string | undefined;
  readonly environment: ResolvedProviderInstanceEnvironment;
  readonly enabled: boolean;
  readonly config: Config;
}

/** create calls with different instanceId/config must share no mutable state. */
export interface ProviderDriver<Config, R = never, UsageR = never> {
  readonly driverKind: ProviderDriverKind;
  readonly metadata: ProviderDriverMetadata;
  // Codec keeps DecodingServices = never; Schema would widen it through AnyProviderDriver.
  readonly configSchema: Schema.Codec<Config, unknown>;
  readonly defaultConfig: () => Config;
  /** Failures become unavailable snapshots; never throw defects. */
  readonly create: (
    input: ProviderDriverCreateInput<Config>,
  ) => Effect.Effect<ProviderInstance, ProviderDriverError, R | Scope.Scope>;
  readonly usage?: ProviderUsageReader<Config, UsageR>;
}

export type AnyProviderDriver<R = never, UsageR = unknown> = ProviderDriver<any, R, UsageR>;

export type ProviderUsageReaderEnv<Driver> =
  Driver extends ProviderDriver<any, any, infer UsageR> ? UsageR : never;
