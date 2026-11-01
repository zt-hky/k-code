// @effect-diagnostics nodeBuiltinImport:off -- the digest must equal the synchronous one omp writes into session files.
import * as NodeCrypto from "node:crypto";

interface OmpCredentialIdentity {
  readonly accountId?: string | undefined;
  readonly email?: string | undefined;
  readonly orgId?: string | undefined;
  readonly projectId?: string | undefined;
}

/**
 * Mirrors omp's `credentialPinHash`: the digest of the account's full scope tuple is the persisted
 * contract of a session file's `credential_pin` entries. Undefined without an account key.
 */
export function ompCredentialPinHash(
  provider: string,
  identity: OmpCredentialIdentity,
): string | undefined {
  if (!identity.accountId && !identity.email) return undefined;
  return NodeCrypto.createHash("sha256")
    .update(
      [
        provider,
        identity.accountId ?? "",
        identity.email ?? "",
        identity.orgId ?? "",
        identity.projectId ?? "",
      ].join("\0"),
    )
    .digest("hex");
}

const CREDENTIAL_PIN_MARKER = '"credential_pin"';

/**
 * The account hash of the newest `credential_pin` per provider in a chunk of session-file lines.
 * `lines` come in file order, so a later entry replaces an earlier one for the same provider.
 */
export function readOmpCredentialPins(
  lines: Iterable<string>,
  into: Record<string, string> = {},
): Record<string, string> {
  for (const line of lines) {
    if (!line.includes(CREDENTIAL_PIN_MARKER)) continue;
    try {
      const entry: unknown = JSON.parse(line);
      if (typeof entry !== "object" || entry === null) continue;
      const { type, provider, hash } = entry as Record<string, unknown>;
      if (type === "credential_pin" && typeof provider === "string" && typeof hash === "string") {
        if (provider && hash) into[provider] = hash;
      }
    } catch {
      // A partially written or foreign line carries no pin.
    }
  }
  return into;
}
