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
