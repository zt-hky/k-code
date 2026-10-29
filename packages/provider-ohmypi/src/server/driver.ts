import {
  AcpRegistryOperationError,
  TextGenerationError,
  type ServerProvider,
} from "@t3tools/contracts";
import * as AcpRegistryRuntimeCoordinator from "@t3tools/provider-acp-registry/server/AcpRegistryRuntimeCoordinator";
import * as AcpRegistrySupport from "@t3tools/provider-acp-registry/server/AcpRegistrySupport";
import {
  deleteAcpRegistrySession,
  disableAcpRegistryProvider,
  listAcpRegistryProviders,
  listAcpRegistrySessions,
  probeAcpRegistryConfiguration,
  setAcpRegistryProvider,
} from "@t3tools/provider-acp-registry/server/probe";
import {
  defaultProviderContinuationIdentity,
  type ProviderDriver,
  type ProviderInstance,
} from "@t3tools/provider-core/server/driver";
import { ProviderDriverError } from "@t3tools/provider-core/server/errors";
import { mergeProviderInstanceEnvironment } from "@t3tools/provider-core/server/instanceEnvironment";
import {
  enrichProviderSnapshotWithVersionAdvisory,
  type ProviderMaintenanceCapabilities,
} from "@t3tools/provider-core/server/maintenanceResolver";
import { makeManagedServerProvider } from "@t3tools/provider-core/server/managedProvider";
import * as ProviderHost from "@t3tools/provider-core/server/ProviderHost";
import * as ProviderLatestVersions from "@t3tools/provider-core/server/ProviderLatestVersions";
import {
  haveProviderSnapshotSettingsChanged,
  makeProviderSnapshotSettingsSource,
  type ProviderSnapshotSettings,
} from "@t3tools/provider-core/server/snapshotSettings";
import type { ProviderTextGeneration } from "@t3tools/provider-core/server/textGeneration";
import * as HostProcess from "@t3tools/shared/HostProcess";
import * as Clock from "effect/Clock";
import * as Crypto from "effect/Crypto";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Ref from "effect/Ref";
import * as Schema from "effect/Schema";
import * as Scope from "effect/Scope";
import * as Semaphore from "effect/Semaphore";
import * as HttpClient from "effect/http/HttpClient";
import * as ChildProcessSpawner from "effect/process/ChildProcessSpawner";

import { OhMyPiSettings } from "../settings.ts";
import { OhMyPiAdapterV2Driver, type OhMyPiAdapterV2DriverEnv } from "./adapter.ts";
import { OHMYPI_DRIVER_KIND } from "./kind.ts";
import { makeOmpLogin } from "./login.ts";
import {
  listAcpRegistryExtensions,
  listAcpRegistryProjects,
  readAcpRegistryUsageAccounts,
  setAcpRegistryExtensionSource,
} from "./management.ts";
import { ompMaintenance } from "./maintenance.ts";
import { toAcpRegistrySettings } from "./registrySettings.ts";
import { OMP_SKILL_PREFIXES } from "./skills.ts";
import {
  applyOhMyPiLiveConfiguration,
  buildOhMyPiSnapshot,
  probeOhMyPiInstall,
  signedInModelProviders,
  type OhMyPiInstall,
  type OhMyPiSignedIn,
} from "./status.ts";
import { ohMyPiUsageReader } from "./usage.ts";

const decodeSettings = Schema.decodeSync(OhMyPiSettings);
// Cache only successful probes so sign-in changes remain visible.
const PROBE_SUCCESS_TTL_MS = 15 * 60 * 1_000;
const SIGNED_IN_READ_TIMEOUT_MS = 15_000;

const makeUnsupportedTextGeneration = (): ProviderTextGeneration => {
  const unsupported = (operation: string) =>
    Effect.fail(
      new TextGenerationError({
        operation,
        detail: "Oh My Pi instances do not provide application text generation.",
      }),
    );
  return {
    generateCommitMessage: () => unsupported("generateCommitMessage"),
    generatePrContent: () => unsupported("generatePrContent"),
    generateBranchName: () => unsupported("generateBranchName"),
    generateThreadTitle: () => unsupported("generateThreadTitle"),
    generateReviewGuide: () => unsupported("generateReviewGuide"),
  };
};

export type OhMyPiDriverEnv =
  | OhMyPiAdapterV2DriverEnv
  | ProviderHost.ProviderHost
  | ProviderLatestVersions.ProviderLatestVersions
  | HttpClient.HttpClient;

export const OhMyPiDriver: ProviderDriver<OhMyPiSettings, OhMyPiDriverEnv, Path.Path> = {
  driverKind: OHMYPI_DRIVER_KIND,
  metadata: {
    displayName: "Oh My Pi",
    supportsMultipleInstances: true,
  },
  usage: ohMyPiUsageReader,
  configSchema: OhMyPiSettings,
  defaultConfig: () => decodeSettings({}),
  create: Effect.fn("OhMyPiDriver.create")(function* ({
    instanceId,
    displayName,
    accentColor,
    environment,
    enabled,
    config,
  }) {
    const catalog = yield* AcpRegistrySupport.AcpRegistryCatalog;
    const runtimeCoordinator = yield* Effect.serviceOption(
      AcpRegistryRuntimeCoordinator.AcpRegistryRuntimeCoordinator,
    );
    const clearLiveState = Option.isSome(runtimeCoordinator)
      ? runtimeCoordinator.value
          .clearLiveConfiguration(instanceId)
          .pipe(Effect.andThen(runtimeCoordinator.value.clearAvailableCommands(instanceId)))
      : Effect.void;
    yield* clearLiveState;
    yield* Effect.addFinalizer(() => clearLiveState);
    const crypto = yield* Crypto.Crypto;
    const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
    const hostEnvironment = yield* HostProcess.Environment;
    const host = yield* ProviderHost.ProviderHost;
    const latestVersions = yield* ProviderLatestVersions.ProviderLatestVersions;
    const httpClient = yield* HttpClient.HttpClient;
    const instanceScope = yield* Scope.Scope;
    const continuationIdentity = defaultProviderContinuationIdentity({
      driverKind: OHMYPI_DRIVER_KIND,
      instanceId,
    });
    const identity = {
      instanceId,
      displayName,
      accentColor,
      continuationKey: continuationIdentity.continuationKey,
    };
    const effectiveConfig = { ...config, enabled } satisfies OhMyPiSettings;
    const customModels = effectiveConfig.customModels as ReadonlyArray<string>;
    const registrySettings = toAcpRegistrySettings(effectiveConfig);
    const processEnvironment = yield* mergeProviderInstanceEnvironment(
      environment,
      hostEnvironment,
    );
    const orchestrationAdapter = yield* OhMyPiAdapterV2Driver.create({
      instanceId,
      displayName,
      accentColor,
      environment,
      enabled,
      config,
    }).pipe(
      Effect.mapError(
        (cause) =>
          new ProviderDriverError({
            driver: OHMYPI_DRIVER_KIND,
            instanceId,
            detail: "Failed to build Oh My Pi orchestration adapter.",
            cause,
          }),
      ),
    );

    const installation: ProviderMaintenanceCapabilities = ompMaintenance({
      executable: effectiveConfig.binaryPath || "omp",
      env: processEnvironment,
      spawner,
    });
    const provideSpawner = <A, E, R>(
      effect: Effect.Effect<A, E, R | ChildProcessSpawner.ChildProcessSpawner>,
    ) => effect.pipe(Effect.provideService(ChildProcessSpawner.ChildProcessSpawner, spawner));
    const provideAcpManagementServices = <A, E>(
      effect: Effect.Effect<
        A,
        E,
        | AcpRegistrySupport.AcpRegistryCatalog
        | ChildProcessSpawner.ChildProcessSpawner
        | Crypto.Crypto
      >,
    ): Effect.Effect<A, E> => {
      const provided = effect.pipe(
        Effect.provideService(AcpRegistrySupport.AcpRegistryCatalog, catalog),
        Effect.provideService(ChildProcessSpawner.ChildProcessSpawner, spawner),
        Effect.provideService(Crypto.Crypto, crypto),
      );
      return Option.isSome(runtimeCoordinator)
        ? provided.pipe(
            Effect.provideService(
              AcpRegistryRuntimeCoordinator.AcpRegistryRuntimeCoordinator,
              runtimeCoordinator.value,
            ),
          )
        : provided;
    };
    const managementInput = (cwd: string) => ({
      instanceId,
      settings: registrySettings,
      cwd,
      environment: processEnvironment,
      skillPrefixes: OMP_SKILL_PREFIXES,
    });

    const enrichmentCache = yield* Ref.make<{
      readonly generation: number;
      readonly entry: {
        readonly provider: ServerProvider;
        readonly expiresAt: number;
      } | null;
    }>({ generation: 0, entry: null });
    const liveSnapshotSemaphore = yield* Semaphore.make(1);
    const invalidateEnrichmentCache = Ref.update(enrichmentCache, (current) => ({
      generation: current.generation + 1,
      entry: null,
    }));
    // The enrichment step builds on what the readiness step observed.
    const lastReadiness = yield* Ref.make<
      { readonly install: OhMyPiInstall; readonly signedIn: OhMyPiSignedIn | undefined } | undefined
    >(undefined);
    // Readiness snapshots replace the published one before enrichment lands; keep the last read.
    const lastUsageAccounts = yield* Ref.make<ServerProvider["usageLimitAccounts"]>(undefined);
    const usageSessionId = yield* Ref.make<string | undefined>(undefined);

    // The login service and the snapshot depend on each other: sign-in refreshes the snapshot,
    // and the snapshot reads which providers are signed in.
    let refreshSnapshot: Effect.Effect<void> = Effect.void;
    const login = yield* makeOmpLogin({
      instanceId,
      resolveSpawn: catalog.resolve(registrySettings, host.paths.cwd, processEnvironment).pipe(
        Effect.map(({ spawn }) => ({
          command: spawn.command,
          env: spawn.env ?? processEnvironment,
          cwd: host.paths.cwd,
        })),
        Effect.mapError(AcpRegistrySupport.toAcpRegistryOperationError),
      ),
      // A probe takes seconds; the login result must not wait for it.
      onCredentialsChanged: clearLiveState.pipe(
        Effect.andThen(liveSnapshotSemaphore.withPermit(invalidateEnrichmentCache)),
        Effect.andThen(Effect.suspend(() => refreshSnapshot)),
        Effect.asVoid,
        Effect.forkIn(instanceScope),
        Effect.asVoid,
      ),
    }).pipe(
      Effect.provideService(ChildProcessSpawner.ChildProcessSpawner, spawner),
      Effect.provideService(Crypto.Crypto, crypto),
    );

    const readInstall = probeOhMyPiInstall(effectiveConfig, processEnvironment).pipe(
      provideSpawner,
    );
    const readSignedIn = login.listProviders.pipe(
      Effect.timeoutOption(SIGNED_IN_READ_TIMEOUT_MS),
      Effect.map((providers) =>
        Option.isSome(providers) ? signedInModelProviders(providers.value) : undefined,
      ),
      Effect.orElseSucceed(() => undefined),
    );

    const withLiveRuntimeState = Effect.fn("OhMyPiDriver.withLiveRuntimeState")(function* (
      input: ServerProvider,
    ) {
      if (Option.isNone(runtimeCoordinator) || input.auth.status === "unauthenticated") {
        return input;
      }
      const { commands, configuration } = yield* Effect.all({
        commands: runtimeCoordinator.value.getAvailableCommands(instanceId),
        configuration: runtimeCoordinator.value.getLiveConfiguration(instanceId),
      });
      const withCommands = Option.match(commands, {
        onNone: () => input,
        onSome: ({ slashCommands, skills }) => ({ ...input, slashCommands, skills }),
      });
      return Option.match(configuration, {
        onNone: () => withCommands,
        onSome: (live) => applyOhMyPiLiveConfiguration(withCommands, live, customModels),
      });
    });

    const checkProvider = Effect.gen(function* () {
      const checkedAt = DateTime.formatIso(yield* DateTime.now);
      if (!effectiveConfig.enabled) {
        return buildOhMyPiSnapshot({ ...identity, settings: effectiveConfig, checkedAt });
      }
      const install = yield* readInstall;
      const signedIn = install.installed ? yield* readSignedIn : undefined;
      yield* Ref.set(lastReadiness, { install, signedIn });
      const provider = buildOhMyPiSnapshot({
        ...identity,
        settings: effectiveConfig,
        checkedAt,
        install,
        ...(signedIn === undefined ? {} : { signedIn }),
      });
      const live = yield* withLiveRuntimeState(provider);
      const usageLimitAccounts = yield* Ref.get(lastUsageAccounts);
      return usageLimitAccounts === undefined || !live.installed
        ? live
        : { ...live, usageLimitAccounts };
    });

    const enrichProvider = Effect.gen(function* () {
      const checkedAt = DateTime.formatIso(yield* DateTime.now);
      const readiness = yield* Ref.get(lastReadiness);
      if (readiness === undefined) {
        return buildOhMyPiSnapshot({ ...identity, settings: effectiveConfig, checkedAt });
      }
      const probed = yield* Effect.result(
        probeAcpRegistryConfiguration(managementInput(host.paths.cwd)).pipe(
          Effect.provideService(AcpRegistrySupport.AcpRegistryCatalog, catalog),
          Effect.provideService(ChildProcessSpawner.ChildProcessSpawner, spawner),
          Effect.provideService(Crypto.Crypto, crypto),
        ),
      );
      return buildOhMyPiSnapshot({
        ...identity,
        settings: effectiveConfig,
        checkedAt,
        install: readiness.install,
        ...(readiness.signedIn === undefined ? {} : { signedIn: readiness.signedIn }),
        ...(probed._tag === "Success" ? { probe: probed.success } : { probeError: probed.failure }),
      });
    });

    const withUsageAccounts = Effect.fn("OhMyPiDriver.withUsageAccounts")(function* (
      provider: ServerProvider,
    ) {
      if (!provider.enabled || !provider.installed || provider.auth.status === "unauthenticated") {
        return provider;
      }
      const previousSessionId = yield* Ref.get(usageSessionId);
      const fetched = yield* provideAcpManagementServices(
        readAcpRegistryUsageAccounts({
          ...managementInput(host.paths.cwd),
          ...(previousSessionId === undefined ? {} : { usageSessionId: previousSessionId }),
        }),
      );
      if (fetched !== undefined) yield* Ref.set(usageSessionId, fetched.sessionId);
      const usageLimitAccounts = fetched?.accounts ?? (yield* Ref.get(lastUsageAccounts));
      if (usageLimitAccounts === undefined) return provider;
      yield* Ref.set(lastUsageAccounts, usageLimitAccounts);
      return { ...provider, usageLimitAccounts };
    });

    const enrichProviderCached = Effect.fn("OhMyPiDriver.enrichProviderCached")(function* (
      baseSnapshot: ServerProvider,
    ) {
      const now = yield* Clock.currentTimeMillis;
      const cacheState = yield* Ref.get(enrichmentCache);
      const cached = cacheState.entry;
      if (
        cached !== null &&
        cached.expiresAt > now &&
        cached.provider.version === baseSnapshot.version
      ) {
        // Usage limits move faster than the probe cache, so re-read them on every refresh.
        const refreshed = yield* withUsageAccounts({
          ...cached.provider,
          checkedAt: baseSnapshot.checkedAt,
        });
        return { provider: refreshed, generation: cacheState.generation };
      }
      const enriched = yield* withUsageAccounts(yield* enrichProvider);
      if (enriched.status === "ready") {
        yield* Ref.update(enrichmentCache, (current) =>
          current.generation === cacheState.generation
            ? { ...current, entry: { provider: enriched, expiresAt: now + PROBE_SUCCESS_TTL_MS } }
            : current,
        );
      }
      return { provider: enriched, generation: cacheState.generation };
    });

    const withVersionAdvisory = (provider: ServerProvider, enableProviderUpdateChecks: boolean) =>
      enrichProviderSnapshotWithVersionAdvisory(provider, installation, {
        enableProviderUpdateChecks,
      }).pipe(
        Effect.provideService(HttpClient.HttpClient, httpClient),
        Effect.provideService(ProviderLatestVersions.ProviderLatestVersions, latestVersions),
      );

    const snapshotSettings = yield* makeProviderSnapshotSettingsSource(effectiveConfig);
    const snapshot = yield* makeManagedServerProvider<ProviderSnapshotSettings<OhMyPiSettings>>({
      resolveMaintenance: () => Effect.succeed(installation),
      getSettings: snapshotSettings.getSettings,
      streamSettings: snapshotSettings.streamSettings,
      haveSettingsChanged: haveProviderSnapshotSettingsChanged,
      initialSnapshot: () =>
        DateTime.now.pipe(
          Effect.map((now) =>
            buildOhMyPiSnapshot({
              ...identity,
              settings: effectiveConfig,
              checkedAt: DateTime.formatIso(now),
            }),
          ),
        ),
      checkProvider,
      enrichSnapshot: Effect.fn("enrichSnapshot")(function ({
        settings,
        snapshot,
        getSnapshot,
        publishSnapshot,
      }) {
        // Nothing to discover without an installed omp, and an account-less omp lists no models.
        if (!snapshot.installed || snapshot.auth.status === "unauthenticated") {
          return Effect.void;
        }
        const publishEnrichment = (
          Option.isSome(runtimeCoordinator)
            ? runtimeCoordinator.value.runBackgroundProbe(
                `ohmypi:${instanceId}`,
                enrichProviderCached(snapshot),
              )
            : enrichProviderCached(snapshot).pipe(Effect.asSome)
        ).pipe(
          Effect.flatMap(
            Option.match({
              onNone: () => Effect.void,
              onSome: ({ provider, generation }) =>
                liveSnapshotSemaphore.withPermit(
                  Ref.get(enrichmentCache).pipe(
                    Effect.flatMap((current) =>
                      current.generation === generation
                        ? withLiveRuntimeState(provider).pipe(
                            Effect.flatMap((live) =>
                              withVersionAdvisory(live, settings.enableProviderUpdateChecks),
                            ),
                            Effect.flatMap(publishSnapshot),
                          )
                        : Effect.void,
                    ),
                  ),
                ),
            }),
          ),
        );
        if (Option.isNone(runtimeCoordinator)) return publishEnrichment;

        const publishLiveCommands = runtimeCoordinator.value.watchAvailableCommands(
          instanceId,
          ({ slashCommands, skills }) =>
            liveSnapshotSemaphore.withPermit(
              getSnapshot.pipe(
                Effect.flatMap((current) => publishSnapshot({ ...current, slashCommands, skills })),
              ),
            ),
        );
        const publishLiveConfiguration = runtimeCoordinator.value.watchLiveConfiguration(
          instanceId,
          (configuration) =>
            liveSnapshotSemaphore.withPermit(
              getSnapshot.pipe(
                Effect.flatMap((current) =>
                  publishSnapshot(
                    applyOhMyPiLiveConfiguration(current, configuration, customModels),
                  ),
                ),
              ),
            ),
        );
        return Effect.all([publishEnrichment, publishLiveCommands, publishLiveConfiguration], {
          concurrency: "unbounded",
          discard: true,
        });
      }),
    }).pipe(
      Effect.mapError(
        (cause) =>
          new ProviderDriverError({
            driver: OHMYPI_DRIVER_KIND,
            instanceId,
            detail: "Failed to build the Oh My Pi provider snapshot.",
            cause,
          }),
      ),
    );
    refreshSnapshot = snapshot.refresh.pipe(Effect.asVoid);

    return {
      instanceId,
      driverKind: OHMYPI_DRIVER_KIND,
      continuationIdentity,
      displayName,
      accentColor,
      enabled,
      snapshot,
      orchestrationAdapter,
      textGeneration: makeUnsupportedTextGeneration(),
      modelProviderLogin: login,
      acpSessionManagement: {
        listSessions: ({ cwd, cursor }) =>
          provideAcpManagementServices(
            listAcpRegistrySessions({
              ...managementInput(cwd),
              ...(cursor === undefined ? {} : { cursor }),
            }),
          ),
        deleteSession: ({ cwd, sessionId }) =>
          provideAcpManagementServices(
            deleteAcpRegistrySession({ ...managementInput(cwd), sessionId }),
          ),
        listProviders: (cwd) =>
          provideAcpManagementServices(listAcpRegistryProviders(managementInput(cwd))),
        setProvider: ({ cwd, providerId, apiType, baseUrl, headers }) =>
          provideAcpManagementServices(
            setAcpRegistryProvider({
              ...managementInput(cwd),
              providerId,
              apiType,
              baseUrl,
              ...(headers === undefined ? {} : { headers }),
            }),
          ).pipe(Effect.tap(() => liveSnapshotSemaphore.withPermit(invalidateEnrichmentCache))),
        disableProvider: ({ cwd, providerId }) =>
          provideAcpManagementServices(
            disableAcpRegistryProvider({ ...managementInput(cwd), providerId }),
          ).pipe(Effect.tap(() => liveSnapshotSemaphore.withPermit(invalidateEnrichmentCache))),
        listProjects: () =>
          provideAcpManagementServices(listAcpRegistryProjects(managementInput(host.paths.cwd))),
        listExtensions: (cwd: string) =>
          provideAcpManagementServices(listAcpRegistryExtensions(managementInput(cwd))),
        // omp has no account-wide sign-out: each model provider signs out from the sign-in panel.
        logout: () =>
          Effect.fail(
            new AcpRegistryOperationError({
              reason: "logout_unsupported",
              message: "Sign out of each model provider from Oh My Pi's sign-in panel.",
            }),
          ),
        setExtensionSource: ({ cwd, providerId, enabled: sourceEnabled }) =>
          provideAcpManagementServices(
            setAcpRegistryExtensionSource({
              ...managementInput(cwd),
              providerId,
              enabled: sourceEnabled,
            }),
          ).pipe(Effect.tap(() => liveSnapshotSemaphore.withPermit(invalidateEnrichmentCache))),
      },
    } satisfies ProviderInstance;
  }),
};
