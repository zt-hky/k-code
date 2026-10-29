/**
 * Subscription sign-ins (ChatGPT, Claude, Gemini, ...) end with a redirect to `localhost:<port>`
 * on the browser's computer. These helpers read that redirect from an authorization URL and
 * decide whether a request that arrived on the port is the one the sign-in is waiting for.
 */

const MAX_AUTHORIZATION_URL = 16_384;
const MIN_PORT = 1_024;
const MAX_PORT = 65_535;
const MIN_STATE = 8;
const MAX_STATE = 512;
const LOOPBACK_HOSTNAMES: ReadonlySet<string> = new Set(["localhost", "127.0.0.1", "[::1]"]);

export interface LocalhostAuthRedirect {
  /** The `redirect_uri` exactly as the provider will send the browser to it. */
  readonly redirectUri: string;
  readonly hostname: string;
  readonly port: number;
  readonly path: string;
  /**
   * The value the callback must echo, so only this sign-in's response is accepted. Null for the
   * few providers (OpenRouter) that send none; their PKCE challenge is what ties code to sign-in.
   */
  readonly state: string | null;
}

const single = (url: URL, key: string): string | null => {
  const values = url.searchParams.getAll(key);
  return values.length === 1 && values[0] !== "" ? values[0]! : null;
};

/** The localhost redirect an authorization URL asks for, or null when it asks for anything else. */
export function parseLocalhostAuthRedirect(authorizationUrl: string): LocalhostAuthRedirect | null {
  if (authorizationUrl.length > MAX_AUTHORIZATION_URL) return null;
  let authorization: URL;
  let redirect: URL;
  try {
    authorization = new URL(authorizationUrl);
    // OpenRouter names the redirect `callback_url`.
    const redirectUri =
      single(authorization, "redirect_uri") ?? single(authorization, "callback_url");
    if (redirectUri === null) return null;
    redirect = new URL(redirectUri);
  } catch {
    return null;
  }
  const state = single(authorization, "state");
  const stateless = authorization.searchParams.getAll("state").length === 0;
  const port = Number(redirect.port);
  if (
    (authorization.protocol !== "https:" && authorization.protocol !== "http:") ||
    redirect.protocol !== "http:" ||
    !LOOPBACK_HOSTNAMES.has(redirect.hostname) ||
    !Number.isInteger(port) ||
    port < MIN_PORT ||
    port > MAX_PORT ||
    redirect.username !== "" ||
    redirect.password !== "" ||
    redirect.hash !== "" ||
    redirect.search !== "" ||
    (state === null
      ? !stateless || single(authorization, "code_challenge") === null
      : state.length < MIN_STATE || state.length > MAX_STATE)
  ) {
    return null;
  }
  return {
    redirectUri: redirect.toString(),
    hostname: redirect.hostname,
    port,
    path: redirect.pathname,
    state,
  };
}

/**
 * The full callback URL when `requestTarget` (the path and query a request arrived with) is the
 * redirect the sign-in waits for: same path, echoing this sign-in's `state`, carrying a `code` or an
 * `error`. Anything else (another path, a stale or foreign state) is not this sign-in's.
 */
export function matchLocalhostAuthCallback(
  requestTarget: string,
  redirect: LocalhostAuthRedirect,
): string | null {
  let callback: URL;
  try {
    callback = new URL(requestTarget, redirect.redirectUri);
  } catch {
    return null;
  }
  const expected = new URL(redirect.redirectUri);
  if (
    callback.origin !== expected.origin ||
    callback.pathname !== redirect.path ||
    callback.hash !== "" ||
    (redirect.state !== null &&
      (callback.searchParams.getAll("state").length !== 1 ||
        callback.searchParams.get("state") !== redirect.state))
  ) {
    return null;
  }
  const code = callback.searchParams.getAll("code");
  const error = callback.searchParams.getAll("error");
  if (code.length + error.length !== 1 || (code[0] ?? error[0]) === "") return null;
  return callback.toString();
}

/** Whether a request's `Host` header names the redirect's own origin, which blocks DNS rebinding. */
export function isLocalhostAuthHost(hostHeader: string | undefined, port: number): boolean {
  if (hostHeader === undefined) return false;
  const host = hostHeader.toLowerCase();
  return ["localhost", "127.0.0.1", "[::1]"].some((name) => host === `${name}:${port}`);
}
