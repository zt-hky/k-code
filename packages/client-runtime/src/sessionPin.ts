import type { OrchestrationV2ProviderThread, UsageLimitsReport } from "@t3tools/contracts";

type UsageLimitsAccount = UsageLimitsReport["accounts"][number];

export function isSessionPinCommand(prompt: string): boolean {
  return /^\/session\s+pin$/i.test(prompt.trim());
}

/** Model slugs read `<upstream>/<model>`; omp pins apply to that upstream's accounts. */
export function modelUpstreamProvider(model: string | null | undefined): string | null {
  const separator = model?.indexOf("/") ?? -1;
  return model && separator > 0 ? model.slice(0, separator) : null;
}

export function isPinnableAccount(account: UsageLimitsAccount, upstream: string | null): boolean {
  return (
    upstream !== null &&
    account.nativeProvider === upstream &&
    (account.email !== undefined || account.nativeAccountId !== undefined)
  );
}

export function sessionPinCommandText(account: UsageLimitsAccount): string {
  return `/session pin ${account.email ?? account.nativeAccountId}`;
}

const SESSION_PIN_ARGUMENT = /^\/session\s+pin\s+(\S.*)$/i;

/**
 * Selector of the `/session pin` that still decides `upstream`'s account: newer than omp's record
 * and not yet followed by a completed prompt to that upstream, which makes omp record the serving
 * account. Messages run oldest to newest; the scan stops where omp's record begins.
 */
export function activeSessionPinSelector(
  messages: ReadonlyArray<{
    readonly role: string;
    readonly text: string;
    readonly createdAt: string;
    readonly runId: string | null;
  }>,
  runs: ReadonlyArray<{
    readonly id: string;
    readonly status: string;
    readonly modelSelection: { readonly model: string };
  }>,
  upstream: string | null,
  recordedAt: string | undefined,
): string | undefined {
  if (upstream === null) return undefined;
  const recorded = recordedAt === undefined ? Number.NEGATIVE_INFINITY : Date.parse(recordedAt);
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index]!;
    if (Date.parse(message.createdAt) <= recorded) return undefined;
    if (message.role !== "user" || message.runId === null) continue;
    const run = runs.find((candidate) => candidate.id === message.runId);
    if (run === undefined || modelUpstreamProvider(run.modelSelection.model) !== upstream) continue;
    const text = message.text.trim();
    const selector = SESSION_PIN_ARGUMENT.exec(text)?.[1]?.trim().toLowerCase();
    if (selector !== undefined) return selector;
    if (!text.startsWith("/") && run.status === "completed") return undefined;
  }
  return undefined;
}

/**
 * The account serving this thread for `upstream`: the one an active `/session pin` names, else
 * the one omp last recorded (`credentialPin`). A positional selector (`/session pin 2`) names no
 * account, so omp's record decides.
 */
export function pinnedAccount<
  T extends Pick<
    UsageLimitsAccount,
    "nativeProvider" | "email" | "nativeAccountId" | "credentialPin"
  >,
>(
  accounts: readonly T[],
  upstream: string | null,
  pin: { readonly selector: string | undefined; readonly credentialPin: string | undefined },
): T | undefined {
  if (upstream === null) return undefined;
  const ofUpstream = accounts.filter((account) => account.nativeProvider === upstream);
  const { selector, credentialPin } = pin;
  return (
    (selector === undefined
      ? undefined
      : ofUpstream.find((account) =>
          [account.email, account.nativeAccountId].some(
            (value) => value?.toLowerCase() === selector,
          ),
        )) ??
    (credentialPin === undefined
      ? undefined
      : ofUpstream.find((account) => account.credentialPin === credentialPin))
  );
}

/** The account omp last recorded as serving the thread for `upstream`. */
export function threadAccountPin(
  providerThread:
    | { readonly nativeMetadata?: OrchestrationV2ProviderThread["nativeMetadata"] }
    | undefined,
  upstream: string | null,
) {
  return upstream === null ? undefined : providerThread?.nativeMetadata?.accountPins?.[upstream];
}
