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
 * Selectors of the `/session pin <email|account id>` commands sent since the last prompt that
 * reached a model, newest first. omp records the serving account only when a model answers, so
 * until then these are the only sign of the new pin.
 */
export function pendingSessionPinSelectors(
  messages: ReadonlyArray<{ readonly role: string; readonly text: string }>,
): string[] {
  const selectors: string[] = [];
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index]!;
    if (message.role !== "user") continue;
    const text = message.text.trim();
    const selector = SESSION_PIN_ARGUMENT.exec(text)?.[1]?.trim().toLowerCase();
    if (selector) selectors.push(selector);
    else if (!text.startsWith("/")) break;
  }
  return selectors;
}

/**
 * The account serving this thread for `upstream`: a pin command not yet followed by a model turn,
 * else the account omp last recorded for it (`credentialPin`). A positional selector
 * (`/session pin 2`) names no account, so it is skipped.
 */
export function pinnedAccount<
  T extends Pick<
    UsageLimitsAccount,
    "nativeProvider" | "email" | "nativeAccountId" | "credentialPin"
  >,
>(
  accounts: readonly T[],
  upstream: string | null,
  pin: {
    readonly pendingSelectors: readonly string[];
    readonly credentialPin: string | undefined;
  },
): T | undefined {
  if (upstream === null) return undefined;
  const ofUpstream = accounts.filter((account) => account.nativeProvider === upstream);
  for (const selector of pin.pendingSelectors) {
    const match = ofUpstream.find((account) =>
      [account.email, account.nativeAccountId].some((value) => value?.toLowerCase() === selector),
    );
    if (match) return match;
  }
  return pin.credentialPin === undefined
    ? undefined
    : ofUpstream.find((account) => account.credentialPin === pin.credentialPin);
}

/** omp's hash of the account that last served the thread for `upstream`. */
export function threadCredentialPin(
  providerThread:
    | { readonly nativeMetadata?: OrchestrationV2ProviderThread["nativeMetadata"] }
    | undefined,
  upstream: string | null,
): string | undefined {
  return upstream === null ? undefined : providerThread?.nativeMetadata?.credentialPins?.[upstream];
}
