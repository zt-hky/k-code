import type { UsageLimitsReport } from "@t3tools/contracts";

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

/** Selectors of every `/session pin <email|account id>` the user sent in this thread, newest first. */
export function sessionPinSelectors(
  messages: ReadonlyArray<{ readonly role: string; readonly text: string }>,
): string[] {
  const selectors: string[] = [];
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index]!;
    if (message.role !== "user") continue;
    const selector = SESSION_PIN_ARGUMENT.exec(message.text.trim())?.[1]?.trim().toLowerCase();
    if (selector) selectors.push(selector);
  }
  return selectors;
}

/**
 * The account this thread pinned for `upstream`: the newest pin selector naming one of its
 * accounts. A positional selector (`/session pin 2`) names none, so it never matches.
 */
export function pinnedAccount<
  T extends Pick<UsageLimitsAccount, "nativeProvider" | "email" | "nativeAccountId">,
>(selectors: readonly string[], accounts: readonly T[], upstream: string | null): T | undefined {
  if (upstream === null) return undefined;
  for (const selector of selectors) {
    const match = accounts.find(
      (account) =>
        account.nativeProvider === upstream &&
        [account.email, account.nativeAccountId].some((value) => value?.toLowerCase() === selector),
    );
    if (match) return match;
  }
  return undefined;
}
