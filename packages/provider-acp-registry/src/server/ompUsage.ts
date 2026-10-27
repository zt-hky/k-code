import {
  ProviderDriverKind,
  type ServerProviderUsageAccount,
  type ServerProviderUsageWindow,
} from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

export const OMP_USAGE_METHOD = "_omp/usage";

const OmpUsageWindow = Schema.Struct({
  id: Schema.String,
  label: Schema.optional(Schema.String),
  durationMs: Schema.optional(Schema.Number),
  resetsAt: Schema.optional(Schema.Number),
});

const OmpUsageLimit = Schema.Struct({
  id: Schema.NonEmptyString,
  label: Schema.NonEmptyString,
  window: Schema.optional(OmpUsageWindow),
  amount: Schema.Struct({
    usedFraction: Schema.optional(Schema.Number),
    used: Schema.optional(Schema.Number),
    limit: Schema.optional(Schema.Number),
  }),
});

const OmpUsageReport = Schema.Struct({
  provider: Schema.NonEmptyString,
  fetchedAt: Schema.optional(Schema.Number),
  limits: Schema.Array(Schema.Unknown),
  metadata: Schema.optional(Schema.Record(Schema.String, Schema.Unknown)),
  resetCredits: Schema.optional(Schema.Struct({ availableCount: Schema.Number })),
});

const OmpUsageResponse = Schema.Struct({ reports: Schema.Array(Schema.Unknown) });

const decodeResponse = Schema.decodeUnknownOption(OmpUsageResponse);
const decodeReport = Schema.decodeUnknownOption(OmpUsageReport);
const decodeLimit = Schema.decodeUnknownOption(OmpUsageLimit);

const UPSTREAM_DRIVERS: Readonly<Record<string, string>> = {
  anthropic: "claudeAgent",
  "openai-codex": "codex",
  "google-antigravity": "antigravity",
};

const UPSTREAM_LABELS: Readonly<Record<string, string>> = {
  anthropic: "Claude",
  "openai-codex": "Codex",
  "google-antigravity": "Antigravity",
};

const WINDOW_KINDS: Readonly<Record<string, ServerProviderUsageWindow["kind"]>> = {
  "5h": "session",
  session: "session",
  "7d": "weekly",
  weekly: "weekly",
  monthly: "monthly",
  "30d": "monthly",
};

const clampPercent = (value: number): number => Math.min(100, Math.max(0, value));

const metadataText = (
  metadata: Readonly<Record<string, unknown>> | undefined,
  ...keys: readonly string[]
): string | undefined => {
  for (const key of keys) {
    const value = metadata?.[key];
    if (typeof value === "string" && value.trim().length > 0) return value.trim();
  }
  return undefined;
};

const isoFromMs = (value: number | undefined): string | undefined =>
  value === undefined
    ? undefined
    : Option.getOrUndefined(Option.map(DateTime.make(value), DateTime.formatIso));

function usedPercent(amount: typeof OmpUsageLimit.Type.amount): number | undefined {
  if (amount.usedFraction !== undefined && Number.isFinite(amount.usedFraction)) {
    return clampPercent(amount.usedFraction * 100);
  }
  if (amount.used !== undefined && amount.limit !== undefined && amount.limit > 0) {
    return clampPercent((amount.used / amount.limit) * 100);
  }
  return undefined;
}

function toWindow(limit: typeof OmpUsageLimit.Type): ServerProviderUsageWindow | undefined {
  const percent = usedPercent(limit.amount);
  if (percent === undefined) return undefined;
  const window = limit.window;
  const windowLabel = window?.label?.trim();
  const label =
    windowLabel && !limit.label.toLowerCase().includes(windowLabel.toLowerCase())
      ? `${limit.label} · ${windowLabel}`
      : limit.label;
  const resetsAt = isoFromMs(window?.resetsAt);
  const durationMins =
    window?.durationMs !== undefined && Number.isFinite(window.durationMs) && window.durationMs >= 0
      ? Math.round(window.durationMs / 60_000)
      : undefined;
  return {
    id: limit.id,
    kind: (window && WINDOW_KINDS[window.id.toLowerCase()]) || "other",
    label,
    usedPercent: percent,
    ...(resetsAt ? { resetsAt } : {}),
    ...(durationMins === undefined ? {} : { windowDurationMins: durationMins }),
  };
}

/** Malformed reports or limits are skipped so one bad upstream cannot hide the others. */
export function ompUsageToAccounts(
  response: unknown,
  fallbackDriver: ProviderDriverKind,
  now: DateTime.DateTime,
): ReadonlyArray<ServerProviderUsageAccount> {
  const decoded = decodeResponse(response);
  if (Option.isNone(decoded)) return [];
  const seen = new Map<string, number>();
  return decoded.value.reports.flatMap((rawReport): ServerProviderUsageAccount[] => {
    const report = decodeReport(rawReport);
    if (Option.isNone(report)) return [];
    const { provider, metadata } = report.value;
    const windows = report.value.limits.flatMap((rawLimit) => {
      const limit = decodeLimit(rawLimit);
      const window = Option.isSome(limit) ? toWindow(limit.value) : undefined;
      return window ? [window] : [];
    });
    const email = metadataText(metadata, "email");
    const nativeAccountId = metadataText(metadata, "accountId");
    const identity = nativeAccountId ?? email;
    const base = `${provider}:${identity ?? "default"}`;
    const occurrence = seen.get(base) ?? 0;
    seen.set(base, occurrence + 1);
    const plan = metadataText(metadata, "plan", "planType", "orgName");
    const credits = report.value.resetCredits;
    const upstreamDriver = UPSTREAM_DRIVERS[provider];
    return [
      {
        id: occurrence === 0 ? base : `${base}#${occurrence}`,
        driver: upstreamDriver ? ProviderDriverKind.make(upstreamDriver) : fallbackDriver,
        nativeProvider: provider,
        ...(UPSTREAM_LABELS[provider] ? { nativeProviderLabel: UPSTREAM_LABELS[provider] } : {}),
        ...(nativeAccountId ? { nativeAccountId } : {}),
        ...(email ? { email } : {}),
        ...(plan ? { plan } : {}),
        usageLimits: {
          checkedAt: isoFromMs(report.value.fetchedAt) ?? DateTime.formatIso(now),
          windows,
          ...(credits && credits.availableCount > 0
            ? { resetCredits: { availableCount: Math.max(0, Math.round(credits.availableCount)) } }
            : {}),
        },
      },
    ];
  });
}
