import type {
  ProviderInstanceId,
  ServerProvider,
  ServerProviderUsageWindow,
  UsageLimitSourceSnapshots,
  UsageLimitsReport,
} from "@t3tools/contracts";
import {
  isPinnableAccount,
  pinnedAccount,
  type SessionPin,
  sessionPinCommandText,
} from "@t3tools/client-runtime/sessionPin";
import { ChevronDownIcon } from "lucide-react";
import {
  collectProviderUsageLimits,
  formatDuration,
  type LimitPace,
  limitsNotice,
  paceOf,
  remainingPercent,
} from "@t3tools/shared/usageLimits";
import type { ReactNode } from "react";

import { useClientSettings, usePrimarySettings } from "../../hooks/useSettings";
import { useNowMinute } from "../../hooks/useNowMinute";
import { type ContextWindowSnapshot, formatContextWindowTokens } from "../../lib/contextWindow";
import { cn } from "../../lib/utils";
import { formatUpcomingTimestamp } from "../../timestampFormat";
import { redactedPlaceholder, RedactedSensitiveText } from "../settings/RedactedSensitiveText";
import {
  Menu,
  MenuGroup,
  MenuGroupLabel,
  MenuPopup,
  MenuRadioGroup,
  MenuRadioItem,
  MenuTrigger,
} from "../ui/menu";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { formatContextWindowCompactionMessage } from "./ContextWindowMeter.logic";
import { ThreadDetailsSection } from "./ThreadDetailsSection";

type UsageLimitsAccount = UsageLimitsReport["accounts"][number];

const PACE_LABEL: Record<LimitPace, string> = {
  ahead: "Ahead of pace",
  on: "On pace",
  under: "Under pace",
};

export interface ThreadDetailsUsageInput {
  readonly providerInstanceId: ProviderInstanceId | null;
  readonly providers: readonly ServerProvider[];
  readonly sources: UsageLimitSourceSnapshots;
  readonly contextWindow: ContextWindowSnapshot | null;
  /** Upstream login of the selected model (`<upstream>/<model>`); picks the account of a multi-login harness. */
  readonly upstreamProvider?: string | null;
  /** What decides the serving account for `upstreamProvider` (`threadUsagePin`). */
  readonly pin?: SessionPin;
  /** Sends a `/session pin` prompt; set when the thread can change its pinned account. */
  readonly onPinAccount?: (commandText: string) => void;
  readonly pinDisabled?: boolean;
}

type UsageTone = "error" | "warning" | null;

const NO_PIN: SessionPin = { selector: undefined, credentialPin: undefined };

/** The selected provider's limit windows. Each row reads as room left. */
export function ThreadDetailsUsage({
  providerInstanceId,
  providers,
  sources,
  upstreamProvider = null,
  pin = NO_PIN,
  onPinAccount,
  pinDisabled = false,
}: Omit<ThreadDetailsUsageInput, "contextWindow">) {
  const nowMinute = useNowMinute();
  const now = Date.parse(`${nowMinute}:00Z`);
  const report =
    providerInstanceId !== null
      ? collectProviderUsageLimits(providerInstanceId, providers, sources, now)
      : null;
  // Only this instance's data: the report keeps one instance per login, and any other entry may be
  // a different login or workspace, so fall back to the instance's own snapshot. A harness that
  // multiplexes several upstream logins (Oh My Pi) reports one account each; the selected model's
  // upstream decides which one this thread draws from.
  const instanceAccounts =
    report?.accounts.filter((entry) => entry.instanceId === providerInstanceId) ?? [];
  const upstreamAccounts = instanceAccounts.filter(
    (entry) => upstreamProvider !== null && entry.nativeProvider === upstreamProvider,
  );
  const pinned = pinnedAccount(upstreamAccounts, upstreamProvider, pin);
  const limits =
    (pinned ?? upstreamAccounts[0] ?? instanceAccounts[0])?.limits ??
    providers.find((provider) => provider.instanceId === providerInstanceId)?.usageLimits;
  if (!limits) return null;
  const notice = limitsNotice(limits);
  const pinnableAccounts = upstreamAccounts.filter((account) =>
    isPinnableAccount(account, upstreamProvider),
  );

  return (
    <ThreadDetailsSection
      headingId="thread-details-usage-heading"
      title="Usage limits"
      showHeading={false}
    >
      <div className="grid grid-cols-[auto_minmax(3rem,1fr)_auto] gap-x-3 text-xs">
        {onPinAccount && pinnableAccounts.length > 0 ? (
          <PinnedAccountRow
            accounts={pinnableAccounts}
            pinned={pinned}
            disabled={pinDisabled}
            onPin={onPinAccount}
          />
        ) : null}
        {notice ? (
          <UsageRow
            label="Limits"
            fill={null}
            tone={null}
            value="Unavailable"
            tooltip={<span className="text-foreground">{notice}</span>}
          />
        ) : (
          limits.windows.map((window) => <LimitRow key={window.id} window={window} now={now} />)
        )}
      </div>
    </ThreadDetailsSection>
  );
}

/** The thread's context window. The bar fills as context is used; the tick marks auto-compaction. */
export function ThreadDetailsContext({ usage }: { readonly usage: ContextWindowSnapshot }) {
  const maxTokens = usage.maxTokens != null && usage.maxTokens > 0 ? usage.maxTokens : null;
  const used =
    maxTokens !== null && usage.usedPercentage !== null
      ? Math.round(Math.max(0, Math.min(100, usage.usedPercentage)))
      : null;
  const threshold = usage.autoCompactThreshold ?? null;
  const tick =
    maxTokens !== null && threshold !== null && threshold > 0 && threshold < maxTokens
      ? (threshold / maxTokens) * 100
      : null;
  const usedTokens = formatContextWindowTokens(usage.usedTokens);
  return (
    <ThreadDetailsSection
      headingId="thread-details-context-heading"
      title="Context window"
      showHeading={false}
    >
      <div className="grid grid-cols-[auto_minmax(3rem,1fr)_auto] gap-x-3 text-xs">
        <UsageRow
          label="Context"
          fill={used}
          tone={used === null ? null : used >= 90 ? "error" : used >= 80 ? "warning" : null}
          tick={tick}
          muted
          value={
            maxTokens !== null
              ? `${usedTokens} / ${formatContextWindowTokens(maxTokens)}`
              : usedTokens
          }
          ariaValue={used !== null ? `${used}% used` : `${usedTokens} tokens used`}
          tooltip={
            <>
              <span className="text-foreground">
                {used !== null ? `Context: ${used}% used` : `Context: ${usedTokens} tokens used`}
              </span>
              {maxTokens !== null ? (
                <span className="text-muted-foreground">
                  {usage.usedTokens.toLocaleString("en-US")} of {maxTokens.toLocaleString("en-US")}{" "}
                  tokens
                </span>
              ) : null}
              {threshold !== null && threshold > 0 ? (
                <span className="text-muted-foreground">
                  {formatContextWindowCompactionMessage(null, threshold)}
                </span>
              ) : null}
            </>
          }
        />
      </div>
    </ThreadDetailsSection>
  );
}

function LimitRow({
  window,
  now,
}: {
  readonly window: ServerProviderUsageWindow;
  readonly now: number;
}) {
  const timestampFormat = usePrimarySettings((settings) => settings.timestampFormat);
  const left = remainingPercent(window);
  const pace = paceOf(window, now);
  const resetsAt = window.resetsAt ? Date.parse(window.resetsAt) : Number.NaN;
  return (
    <UsageRow
      label={window.label}
      fill={left}
      tone={left <= 10 ? "error" : left <= 20 ? "warning" : null}
      value={`${left}%`}
      ariaValue={`${left}% left`}
      tooltip={
        <>
          <span className="text-foreground">
            {window.label}: {left}% left
          </span>
          {window.resetsAt && resetsAt > now ? (
            <span className="text-muted-foreground">
              Resets in {formatDuration(resetsAt - now)} ·{" "}
              {formatUpcomingTimestamp(window.resetsAt, timestampFormat, now)}
            </span>
          ) : null}
          {pace ? <span className="text-muted-foreground">{PACE_LABEL[pace]}</span> : null}
        </>
      }
    />
  );
}

/** The email of the account serving the thread; with other accounts, hover reveals the switcher. */
function PinnedAccountRow({
  accounts,
  pinned,
  disabled,
  onPin,
}: {
  readonly accounts: readonly UsageLimitsAccount[];
  readonly pinned: UsageLimitsAccount | undefined;
  readonly disabled: boolean;
  readonly onPin: (commandText: string) => void;
}) {
  const revealEmails = useClientSettings((settings) => settings.revealAccountEmails);
  const pinnedLabel = pinned?.email ?? pinned?.nativeAccountId;
  if (accounts.length < 2) {
    return pinnedLabel ? (
      <div className="col-span-3 flex h-6 min-w-0 items-center px-2.5">
        <RedactedSensitiveText
          key={pinnedLabel}
          value={pinnedLabel}
          ariaLabel="Toggle pinned account visibility"
          revealTooltip="Click to reveal account"
          hideTooltip="Click to hide account"
          className="max-w-full truncate font-sans text-xs"
        />
      </div>
    ) : null;
  }
  return (
    <Menu>
      <MenuTrigger
        disabled={disabled}
        render={
          <button
            type="button"
            aria-label={`Pinned account${revealEmails && pinnedLabel ? `: ${pinnedLabel}` : ""}. Change account`}
            className="group col-span-3 flex h-6 min-w-0 cursor-pointer items-center gap-1 rounded-lg px-2.5 text-start outline-none hover:bg-black/[0.035] focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring disabled:cursor-default data-popup-open:bg-black/[0.035] dark:hover:bg-white/[0.08] dark:data-popup-open:bg-white/[0.08]"
          />
        }
      >
        <span
          className={cn(
            "min-w-0 truncate text-foreground/80",
            pinnedLabel && !revealEmails && "select-none blur-xs",
            !pinnedLabel && "text-muted-foreground",
          )}
        >
          {pinnedLabel
            ? revealEmails
              ? pinnedLabel
              : redactedPlaceholder(pinnedLabel)
            : "Choose an account"}
        </span>
        <ChevronDownIcon
          aria-hidden
          className="size-3.5 shrink-0 text-muted-foreground opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100 group-data-popup-open:opacity-100"
        />
      </MenuTrigger>
      <MenuPopup align="start">
        <MenuGroup>
          <MenuGroupLabel>Pin an account to this thread</MenuGroupLabel>
          <MenuRadioGroup
            value={pinned?.id ?? ""}
            onValueChange={(value) => {
              const account = accounts.find((candidate) => candidate.id === value);
              if (account && account.id !== pinned?.id) onPin(sessionPinCommandText(account));
            }}
          >
            {accounts.map((account) => {
              const label = account.email ?? account.nativeAccountId ?? account.label;
              return (
                <MenuRadioItem key={account.id} value={account.id} closeOnClick>
                  <span className={cn("min-w-0", !revealEmails && "select-none blur-xs")}>
                    {revealEmails ? label : redactedPlaceholder(label)}
                  </span>
                  {account.plan ? (
                    <span className="ms-auto ps-3 text-muted-foreground">{account.plan}</span>
                  ) : null}
                </MenuRadioItem>
              );
            })}
          </MenuRadioGroup>
        </MenuGroup>
      </MenuPopup>
    </Menu>
  );
}

/** One label, hairline, and value row; the whole row opens the details tooltip. */
function UsageRow({
  label,
  fill,
  tone,
  tick = null,
  value,
  ariaValue = value,
  tooltip,
  muted = false,
}: {
  readonly label: string;
  /** Bar fill from 0 to 100. Null hides the bar. */
  readonly fill: number | null;
  readonly tone: UsageTone;
  /** A marker on the bar, from 0 to 100. */
  readonly tick?: number | null;
  readonly value: string;
  readonly ariaValue?: string;
  readonly tooltip: ReactNode;
  readonly muted?: boolean;
}) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <div
            tabIndex={0}
            aria-label={`${label}: ${ariaValue}`}
            className="col-span-3 grid h-6 cursor-default grid-cols-subgrid items-center rounded-lg px-2.5 outline-none hover:bg-black/[0.035] focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring data-popup-open:bg-black/[0.035] dark:hover:bg-white/[0.08] dark:data-popup-open:bg-white/[0.08]"
          />
        }
      >
        <span className="max-w-28 truncate text-muted-foreground">{label}</span>
        {fill !== null ? (
          <span className="relative h-[3px] rounded-full bg-muted-foreground/30 dark:bg-muted-foreground/20">
            {fill > 0 ? (
              <span
                className={cn(
                  "absolute inset-y-0 left-0 rounded-full",
                  tone === "error"
                    ? "bg-error"
                    : tone === "warning"
                      ? "bg-warning"
                      : muted
                        ? "bg-muted-foreground"
                        : "bg-foreground/80",
                )}
                style={{ width: `max(${fill}%, 6px)` }}
              />
            ) : null}
            {tick !== null ? (
              <span
                aria-hidden
                className="absolute -top-[3px] h-[9px] w-px -translate-x-1/2 bg-foreground/60"
                style={{ left: `${tick}%` }}
              />
            ) : null}
          </span>
        ) : null}
        <span
          className={cn(
            // Text-only rows span the bar column so they never widen the shared value column.
            "text-end font-medium tabular-nums",
            fill === null && "col-span-2",
            tone === "error"
              ? "text-error-foreground"
              : tone === "warning"
                ? "text-warning-foreground"
                : fill === null
                  ? "text-muted-foreground"
                  : "text-foreground/80",
          )}
        >
          {value}
        </span>
      </TooltipTrigger>
      {/* Rows sit 8px inside the card; clear its edge instead of overlapping it. */}
      <TooltipPopup side="left" sideOffset={16}>
        <div className="flex flex-col gap-0.5">{tooltip}</div>
      </TooltipPopup>
    </Tooltip>
  );
}
