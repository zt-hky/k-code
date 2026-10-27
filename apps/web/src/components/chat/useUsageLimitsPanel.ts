import type {
  EnvironmentId,
  ProviderInstanceId,
  ServerProvider,
  UsageLimitSourceSnapshots,
} from "@t3tools/contracts";
import { collectProviderUsageLimits, hasProviderUsageLimits } from "@t3tools/shared/usageLimits";
import { useState } from "react";
import { useStableCallback } from "../../hooks/useStableCallback";
import { toastManager } from "../ui/toast";
import { usageLimitsBannerItem } from "./ComposerUsageLimits";
import { isPinnableAccount, modelUpstreamProvider } from "./sessionPin";

/** Keep opened data live. Retain hidden panels during reconnect; clear when quota-spending work resumes. */
export function useUsageLimitsPanel(input: {
  readonly environmentId: EnvironmentId;
  readonly threadKey: string;
  readonly panelKey: string | null;
  readonly providerInstanceId: ProviderInstanceId | null;
  readonly providerDriver: ServerProvider["driver"] | null;
  readonly providers: readonly ServerProvider[];
  readonly sources: UsageLimitSourceSnapshots;
  /** Current model slug (`<upstream>/<model>`); selects which hub accounts are pinnable. */
  readonly modelSlug: string | null;
  readonly pinDisabled: boolean;
  readonly sendPinCommand: (commandText: string) => void;
}) {
  const {
    environmentId,
    threadKey,
    panelKey,
    providerInstanceId,
    providerDriver,
    providers,
    sources,
    modelSlug,
    pinDisabled,
    sendPinCommand,
  } = input;
  const upstream = modelUpstreamProvider(modelSlug);
  const [panel, setPanel] = useState<{
    readonly key: string;
    readonly threadKey: string;
    readonly now: number;
    readonly pinnableOnly: boolean;
  } | null>(null);
  if (panel !== null && panelKey !== null && panel.key !== panelKey) {
    setPanel(null);
  }
  const fullReport =
    panel !== null && panelKey !== null && panel.key === panelKey && providerInstanceId !== null
      ? collectProviderUsageLimits(providerInstanceId, providers, sources, panel.now)
      : null;
  const pinnableAccounts = fullReport?.accounts.filter((account) =>
    isPinnableAccount(account, upstream),
  );
  const report =
    fullReport !== null && panel?.pinnableOnly && pinnableAccounts && pinnableAccounts.length > 0
      ? { ...fullReport, accounts: pinnableAccounts }
      : fullReport;
  const banner =
    report !== null && panel !== null
      ? // A fresh id per opening: the stack keeps the last dismissed id as "exiting".
        usageLimitsBannerItem(
          `usage-limits:${panel.key}:${panel.now}`,
          report,
          environmentId,
          () => setPanel(null),
          {
            upstream,
            disabled: pinDisabled,
            onPin: (commandText) => {
              setPanel(null);
              sendPinCommand(commandText);
            },
          },
        )
      : null;
  // Intercept /usage-limits only when Limits has selected-provider data.
  const offered =
    providerDriver !== null &&
    providerInstanceId !== null &&
    hasProviderUsageLimits(
      { driver: providerDriver, instanceId: providerInstanceId },
      providers,
      sources,
    );

  // Bare `/session pin` is intercepted only when this provider reports pinnable hub accounts.
  const sessionPinOffered =
    offered &&
    upstream !== null &&
    providers.some(
      (provider) =>
        provider.instanceId === providerInstanceId &&
        provider.usageLimitAccounts?.some((account) => account.nativeProvider === upstream),
    );

  const open = useStableCallback((options?: { readonly pinnableOnly?: boolean }) => {
    const now = Date.now();
    const nextReport =
      providerInstanceId !== null && panelKey !== null
        ? collectProviderUsageLimits(providerInstanceId, providers, sources, now)
        : null;
    if (nextReport && panelKey !== null) {
      setPanel({ key: panelKey, threadKey, now, pinnableOnly: options?.pinnableOnly === true });
      return true;
    }
    setPanel(null);
    toastManager.add({ type: "info", title: "Usage limits are unavailable for this provider" });
    return false;
  });
  // Async responses may clear only their originating thread's panel.
  const clearFor = useStableCallback((originThreadKey: string) =>
    setPanel((current) =>
      current !== null && current.threadKey === originThreadKey ? null : current,
    ),
  );

  return { banner, offered, sessionPinOffered, open, clearFor };
}
