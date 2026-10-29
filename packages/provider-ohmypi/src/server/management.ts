import {
  AcpRegistryListExtensionsResult,
  AcpRegistryListProjectsResult,
  AcpRegistryOperationError,
  AcpRegistrySetExtensionSourceResult,
  type ServerProviderUsageAccount,
} from "@t3tools/contracts";
import {
  boundedOpaqueValue,
  boundedText,
  makeAcpRegistryManagementRuntime,
  managementFailure,
  type AcpRegistryManagementInput,
} from "@t3tools/provider-acp-registry/server/probe";
import * as DateTime from "effect/DateTime";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

import { OHMYPI_DRIVER_KIND } from "./kind.ts";
import {
  OMP_EXTENSIONS_METHOD,
  OMP_EXTENSIONS_TOGGLE_METHOD,
  OMP_PROJECTS_LIST_METHOD,
} from "./acp.ts";
import { OMP_USAGE_METHOD, ompUsageToAccounts } from "./usageAccounts.ts";

const MANAGEMENT_TIMEOUT = Duration.seconds(60);

const OmpNativeProject = Schema.Struct({
  cwd: Schema.String,
  sessionCount: Schema.Number,
  lastActivityAt: Schema.optional(Schema.NullOr(Schema.Number)),
  lastTitle: Schema.optional(Schema.NullOr(Schema.String)),
});
const OmpProjectsResponse = Schema.Struct({ projects: Schema.Array(Schema.Unknown) });
const decodeOmpNativeProject = Schema.decodeUnknownOption(OmpNativeProject);
const decodeOmpProjectsResponse = Schema.decodeUnknownOption(OmpProjectsResponse);

export const listAcpRegistryProjects = Effect.fn("AcpRegistryProbe.listProjects")(
  function* (input: AcpRegistryManagementInput) {
    const runtime = yield* makeAcpRegistryManagementRuntime(input);
    yield* runtime.initialize();
    const response = yield* runtime.request(OMP_PROJECTS_LIST_METHOD, {});
    const entries = Option.getOrUndefined(decodeOmpProjectsResponse(response))?.projects ?? [];
    const projects = entries.flatMap((entry) => {
      const decoded = decodeOmpNativeProject(entry);
      if (Option.isNone(decoded)) return [];
      const cwd = boundedOpaqueValue(decoded.value.cwd, 4_096);
      const { sessionCount, lastActivityAt: activityMs } = decoded.value;
      if (cwd === undefined || !Number.isSafeInteger(sessionCount) || sessionCount < 0) return [];
      const lastActivityAt =
        activityMs == null
          ? null
          : Option.getOrNull(Option.map(DateTime.make(activityMs), DateTime.formatIso));
      return [
        {
          cwd,
          sessionCount,
          lastActivityAt,
          lastTitle: boundedText(decoded.value.lastTitle ?? "", 1_024) || null,
        },
      ];
    });
    return AcpRegistryListProjectsResult.make({
      projects: projects
        .toSorted((left, right) =>
          (right.lastActivityAt ?? "").localeCompare(left.lastActivityAt ?? ""),
        )
        .slice(0, 200),
    });
  },
  (effect) =>
    effect.pipe(
      Effect.scoped,
      Effect.timeoutOrElse({
        duration: MANAGEMENT_TIMEOUT,
        orElse: () =>
          Effect.fail(
            new AcpRegistryOperationError({
              reason: "projects_list_failed",
              message: "The ACP project list request timed out.",
            }),
          ),
      }),
      Effect.mapError((error) => managementFailure("projects_list", error)),
    ),
);

const OmpOptionalText = Schema.optional(Schema.NullOr(Schema.String));
const OmpExtension = Schema.Struct({
  id: Schema.String,
  kind: Schema.String,
  displayName: Schema.String,
  description: OmpOptionalText,
  source: Schema.Struct({
    provider: Schema.String,
    providerName: Schema.String,
    level: Schema.Literals(["user", "project", "native"]),
  }),
  state: Schema.Literals(["active", "disabled", "shadowed"]),
  disabledReason: OmpOptionalText,
  shadowedBy: OmpOptionalText,
});
const OmpExtensionsResponse = Schema.Struct({ extensions: Schema.Array(Schema.Unknown) });
const decodeOmpExtension = Schema.decodeUnknownOption(OmpExtension);
const decodeOmpExtensionsResponse = Schema.decodeUnknownOption(OmpExtensionsResponse);

export const listAcpRegistryExtensions = Effect.fn("AcpRegistryProbe.listExtensions")(
  function* (input: AcpRegistryManagementInput) {
    const runtime = yield* makeAcpRegistryManagementRuntime(input);
    yield* runtime.initialize();
    const response = yield* runtime.request(OMP_EXTENSIONS_METHOD, { cwd: input.cwd });
    const entries = Option.getOrUndefined(decodeOmpExtensionsResponse(response))?.extensions ?? [];
    const extensions = entries.flatMap((entry) => {
      const decoded = decodeOmpExtension(entry);
      if (Option.isNone(decoded)) return [];
      const extension = decoded.value;
      const id = boundedOpaqueValue(extension.id, 512);
      const kind = boundedOpaqueValue(extension.kind, 64);
      const sourceProvider = boundedOpaqueValue(extension.source.provider, 128);
      if (id === undefined || kind === undefined || sourceProvider === undefined) return [];
      const description = boundedText(extension.description ?? "", 1_024);
      const disabledReason = boundedText(extension.disabledReason ?? "", 64);
      const shadowedBy = boundedText(extension.shadowedBy ?? "", 512);
      return [
        {
          id,
          kind,
          displayName: boundedText(extension.displayName, 256),
          ...(description ? { description } : {}),
          sourceProvider,
          sourceName: boundedText(extension.source.providerName, 256),
          sourceLevel: extension.source.level,
          state: extension.state,
          ...(disabledReason ? { disabledReason } : {}),
          ...(shadowedBy ? { shadowedBy } : {}),
        },
      ];
    });
    return AcpRegistryListExtensionsResult.make({ extensions: extensions.slice(0, 500) });
  },
  (effect) =>
    effect.pipe(
      Effect.scoped,
      Effect.timeoutOrElse({
        duration: MANAGEMENT_TIMEOUT,
        orElse: () =>
          Effect.fail(
            new AcpRegistryOperationError({
              reason: "extensions_list_failed",
              message: "The ACP extension list request timed out.",
            }),
          ),
      }),
      Effect.mapError((error) => managementFailure("extensions_list", error)),
    ),
);

export const setAcpRegistryExtensionSource = Effect.fn("AcpRegistryProbe.setExtensionSource")(
  function* (
    input: AcpRegistryManagementInput & { readonly providerId: string; readonly enabled: boolean },
  ) {
    const runtime = yield* makeAcpRegistryManagementRuntime(input);
    yield* runtime.initialize();
    yield* runtime.request(OMP_EXTENSIONS_TOGGLE_METHOD, {
      providerId: input.providerId,
      enabled: input.enabled,
    });
    return AcpRegistrySetExtensionSourceResult.make({ enabled: input.enabled });
  },
  (effect) =>
    effect.pipe(
      Effect.scoped,
      Effect.timeoutOrElse({
        duration: MANAGEMENT_TIMEOUT,
        orElse: () =>
          Effect.fail(
            new AcpRegistryOperationError({
              reason: "extension_toggle_failed",
              message: "The ACP extension update request timed out.",
            }),
          ),
      }),
      Effect.mapError((error) => managementFailure("extensions_toggle", error)),
    ),
);

const OMP_USAGE_TIMEOUT = Duration.seconds(30);

export interface AcpRegistryUsageRead {
  readonly accounts: ReadonlyArray<ServerProviderUsageAccount>;
  readonly sessionId: string;
}

/**
 * omp only reports usage once a session exists. Reuse one usage session via `session/resume`
 * so periodic reads don't add an empty session to the agent's resume list each time.
 * Best-effort: failures yield undefined so callers keep their last good accounts.
 */
export const readAcpRegistryUsageAccounts = Effect.fn("AcpRegistryProbe.readUsageAccounts")(
  function* (input: AcpRegistryManagementInput & { readonly usageSessionId?: string }) {
    const read = Effect.fn("AcpRegistryProbe.readUsageAccountsOnce")(function* (
      resumeSessionId: string | undefined,
    ) {
      const runtime = yield* makeAcpRegistryManagementRuntime({
        ...input,
        ...(resumeSessionId ? { resumeSessionId } : {}),
      });
      const started = yield* runtime.start();
      const response = yield* runtime.request(OMP_USAGE_METHOD, {});
      const now = yield* DateTime.now;
      return {
        accounts: ompUsageToAccounts(response, OHMYPI_DRIVER_KIND, now),
        sessionId: started.sessionId,
      } satisfies AcpRegistryUsageRead;
    }, Effect.scoped);
    return yield* input.usageSessionId === undefined
      ? read(undefined)
      : read(input.usageSessionId).pipe(Effect.catch(() => read(undefined)));
  },
  (effect) =>
    effect.pipe(
      Effect.timeoutOption(OMP_USAGE_TIMEOUT),
      Effect.map(Option.getOrUndefined),
      Effect.catch((error) =>
        Effect.logWarning("could not read omp usage", { cause: error }).pipe(Effect.as(undefined)),
      ),
    ),
);
