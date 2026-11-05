import type { OmpLoginAccount, OmpLoginProvider } from "@t3tools/contracts";

export interface OmpServiceAccount extends OmpLoginAccount {
  /** The way into the service that lists this account, which signs it out. */
  readonly providerId: OmpLoginProvider["providerId"];
}

/**
 * The accounts signed in to one service across its ways in. ChatGPT's browser and device-code
 * ways read the same credential store, so an account they both list appears once.
 */
export function serviceLoginAccounts(
  ways: ReadonlyArray<OmpLoginProvider>,
): ReadonlyArray<OmpServiceAccount> {
  const seen = new Set<number>();
  return ways.flatMap((way) =>
    (way.accounts ?? []).flatMap((account) => {
      if (seen.has(account.credentialId)) return [];
      seen.add(account.credentialId);
      return [{ ...account, providerId: way.providerId }];
    }),
  );
}
