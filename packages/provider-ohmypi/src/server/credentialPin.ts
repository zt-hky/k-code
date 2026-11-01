// @effect-diagnostics nodeBuiltinImport:off -- the digest must equal the synchronous one omp writes into session files.
import * as NodeBuffer from "node:buffer";
import * as NodeCrypto from "node:crypto";

import * as DateTime from "effect/DateTime";
import * as Option from "effect/Option";

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

export interface OmpAccountPin {
  readonly hash: string;
  readonly recordedAt: string;
}

const CREDENTIAL_PIN_MARKER = NodeBuffer.Buffer.from('"credential_pin"');
const NEWLINE = 0x0a;
const textDecoder = new TextDecoder();

/**
 * The newest `credential_pin` per provider in a chunk of complete session-file lines, in file
 * order. Only lines carrying the marker are decoded: session files run to tens of megabytes.
 */
export function readOmpAccountPins(
  bytes: Uint8Array,
  into: Record<string, OmpAccountPin> = {},
): Record<string, OmpAccountPin> {
  const buffer = NodeBuffer.Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let at = buffer.indexOf(CREDENTIAL_PIN_MARKER);
  while (at >= 0) {
    const start = buffer.lastIndexOf(NEWLINE, at) + 1;
    const newline = buffer.indexOf(NEWLINE, at);
    const end = newline < 0 ? buffer.length : newline;
    try {
      const entry: unknown = JSON.parse(textDecoder.decode(buffer.subarray(start, end)));
      const { type, provider, hash, timestamp } = (entry ?? {}) as Record<string, unknown>;
      const recordedAt =
        typeof timestamp === "string"
          ? Option.getOrUndefined(Option.map(DateTime.make(timestamp), DateTime.formatIso))
          : undefined;
      if (
        type === "credential_pin" &&
        typeof provider === "string" &&
        provider.length > 0 &&
        typeof hash === "string" &&
        hash.length > 0 &&
        recordedAt !== undefined
      ) {
        into[provider] = { hash, recordedAt };
      }
    } catch {
      // The marker inside a foreign line (a message quoting it) carries no pin.
    }
    at = buffer.indexOf(CREDENTIAL_PIN_MARKER, end);
  }
  return into;
}
