import type { OmpLoginProvider } from "@t3tools/contracts";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

import { stripAnsi } from "./ompAnsi.ts";

/**
 * What `omp login <provider>` writes when stdin is a pipe. omp has no machine-readable login
 * mode: `--mode rpc` refuses secret prompts and prompts that precede the browser URL, which
 * covers every API-key provider and GitHub Copilot's enterprise-domain question.
 */
export type OmpLoginOutputEvent =
  | { readonly _tag: "authorization"; readonly url: string; readonly instructions: string | null }
  | { readonly _tag: "progress"; readonly message: string }
  | { readonly _tag: "prompt"; readonly message: string; readonly secret: boolean }
  | { readonly _tag: "loggedIn" };

const URL_HEADER = "Open this URL in your browser:";
// Resolves against the omp host's loopback, which a remote browser cannot reach.
const LOCAL_SHORTCUT = /^Local shortcut \(this machine only\):/;
const LOGGED_IN = /^Logged in to /;
const SECRET_PROMPT = /\b(?:api[ -]?key|token|secret|password)\b/i;
const HTTP_URL = /^https?:\/\/\S+$/;
const MAX_PROGRESS = 512;

export interface OmpLoginScanner {
  /** Feed decoded stdout; returns the events completed by whole lines. */
  readonly push: (text: string) => ReadonlyArray<OmpLoginOutputEvent>;
  /**
   * Call once stdout has been quiet: an unterminated line is omp waiting on stdin (readline
   * writes the question without a newline), and an unfinished URL block is complete.
   */
  readonly flush: () => ReadonlyArray<OmpLoginOutputEvent>;
  readonly hasPendingTail: () => boolean;
}

export function makeOmpLoginScanner(): OmpLoginScanner {
  let tail = "";
  let block: Array<string> | undefined;

  const closeBlock = (events: Array<OmpLoginOutputEvent>) => {
    if (block === undefined) return;
    const [url, ...instructions] = block;
    block = undefined;
    if (url === undefined || !HTTP_URL.test(url)) return;
    events.push({
      _tag: "authorization",
      url,
      instructions: instructions.length === 0 ? null : instructions.join("\n"),
    });
  };

  const readLine = (rawLine: string, events: Array<OmpLoginOutputEvent>) => {
    const line = rawLine.trim();
    if (block !== undefined) {
      if (line === "") closeBlock(events);
      else if (!LOCAL_SHORTCUT.test(line)) block.push(line);
      return;
    }
    if (line === "") return;
    if (line === URL_HEADER) {
      block = [];
      return;
    }
    if (LOGGED_IN.test(line)) {
      events.push({ _tag: "loggedIn" });
      return;
    }
    events.push({ _tag: "progress", message: line.slice(0, MAX_PROGRESS) });
  };

  return {
    push: (text) => {
      const events: Array<OmpLoginOutputEvent> = [];
      const lines = (tail + stripAnsi(text)).split("\n");
      tail = lines.pop() ?? "";
      for (const line of lines) readLine(line, events);
      return events;
    },
    flush: () => {
      const events: Array<OmpLoginOutputEvent> = [];
      closeBlock(events);
      const question = tail.trim();
      tail = "";
      if (question !== "") {
        events.push({
          _tag: "prompt",
          message: question.replace(/\s*:$/, "").slice(0, 1_024),
          secret: SECRET_PROMPT.test(question),
        });
      }
      return events;
    },
    hasPendingTail: () => tail.trim() !== "" || block !== undefined,
  };
}

/** The reason `omp login` gives on stderr, without its `Login failed:` prefix. */
export function parseOmpLoginFailure(stderr: string): string | null {
  const line = stripAnsi(stderr)
    .split("\n")
    .map((candidate) => candidate.trim())
    .find((candidate) => candidate.startsWith("Login failed:"));
  const reason = line?.replace(/^Login failed:\s*/, "").slice(0, 512);
  return reason === undefined || reason === "" ? null : reason;
}

const RpcLoginProvider = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  available: Schema.Boolean,
  authenticated: Schema.Boolean,
});
const decodeRpcLoginProvider = Schema.decodeUnknownOption(RpcLoginProvider);
const decodeRpcLoginProviders = Schema.decodeUnknownOption(
  Schema.Struct({ providers: Schema.Array(Schema.Unknown) }),
);
const PROVIDER_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const MAX_PROVIDERS = 128;

/** `get_login_providers` response data → providers `omp login` offers; entries it cannot offer are dropped. */
export function parseOmpLoginProviders(data: unknown): ReadonlyArray<OmpLoginProvider> {
  const entries = Option.match(decodeRpcLoginProviders(data), {
    onNone: () => [],
    onSome: (decoded) => decoded.providers,
  });
  const seen = new Set<string>();
  const providers: Array<OmpLoginProvider> = [];
  for (const entry of entries) {
    const decoded = Option.getOrUndefined(decodeRpcLoginProvider(entry));
    const name = decoded?.name.trim();
    if (
      decoded === undefined ||
      !decoded.available ||
      !name ||
      name.length > 256 ||
      !PROVIDER_ID.test(decoded.id) ||
      seen.has(decoded.id)
    ) {
      continue;
    }
    seen.add(decoded.id);
    providers.push({
      providerId: decoded.id as OmpLoginProvider["providerId"],
      name: name as OmpLoginProvider["name"],
      authenticated: decoded.authenticated,
    });
    if (providers.length === MAX_PROVIDERS) break;
  }
  return providers;
}

const RpcLogoutAccount = Schema.Struct({ credentialId: Schema.Int });
const decodeRpcLogoutAccounts = Schema.decodeUnknownOption(
  Schema.Struct({ accounts: Schema.Array(Schema.Unknown) }),
);
const decodeRpcLogoutAccount = Schema.decodeUnknownOption(RpcLogoutAccount);

/** `get_logout_accounts` response data → ids of the stored credentials `logout` can remove. */
export function parseOmpLogoutCredentialIds(data: unknown): ReadonlyArray<number> {
  const accounts = Option.match(decodeRpcLogoutAccounts(data), {
    onNone: () => [],
    onSome: (decoded) => decoded.accounts,
  });
  return accounts.flatMap((entry) => {
    const account = Option.getOrUndefined(decodeRpcLogoutAccount(entry));
    return account === undefined ? [] : [account.credentialId];
  });
}
