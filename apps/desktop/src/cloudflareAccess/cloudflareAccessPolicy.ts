/** Cloudflare Access accepts the application token in this header from non-browser clients. */
export const CLOUDFLARE_ACCESS_TOKEN_HEADER = "cf-access-token";
/** The cookie Access sets on the protected hostname after sign-in; its value is the token. */
export const CLOUDFLARE_ACCESS_COOKIE = "CF_Authorization";

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

/**
 * Whether a response to an unauthenticated request is Access asking for sign-in: a redirect to
 * the team's `*.cloudflareaccess.com` login, or the `Cloudflare-Access` challenge Access adds to
 * its 302 and to the 401/403 it returns for non-browser requests.
 */
export function isCloudflareAccessChallenge(response: {
  readonly status: number;
  readonly location: string | null;
  readonly wwwAuthenticate: string | null;
}): boolean {
  if (response.wwwAuthenticate?.trim().toLowerCase().startsWith("cloudflare-access")) {
    return true;
  }
  if (!REDIRECT_STATUSES.has(response.status) || response.location === null) return false;
  try {
    return new URL(response.location).hostname.endsWith(".cloudflareaccess.com");
  } catch {
    return false;
  }
}

/** The token's `exp` in epoch milliseconds, or null when it is not a JWT carrying one. */
export function cloudflareAccessTokenExpiresAtMs(token: string): number | null {
  const payload = token.split(".")[1];
  if (payload === undefined) return null;
  try {
    const claims: unknown = JSON.parse(atob(payload.replace(/-/g, "+").replace(/_/g, "/")));
    if (typeof claims !== "object" || claims === null || !("exp" in claims)) return null;
    return typeof claims.exp === "number" ? claims.exp * 1_000 : null;
  } catch {
    return null;
  }
}

/** Normalizes an http(s) or ws(s) URL to the http(s) origin Access protects, or null. */
export function cloudflareAccessOrigin(url: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  const protocol =
    parsed.protocol === "ws:" ? "http:" : parsed.protocol === "wss:" ? "https:" : parsed.protocol;
  if (protocol !== "http:" && protocol !== "https:") return null;
  return `${protocol}//${parsed.host}`;
}

/** Electron `webRequest` URL patterns covering HTTP and WebSocket traffic to these origins. */
export function cloudflareAccessUrlPatterns(origins: Iterable<string>): string[] {
  const patterns: string[] = [];
  for (const origin of origins) {
    const url = new URL(origin);
    const socketProtocol = url.protocol === "https:" ? "wss:" : "ws:";
    // Match patterns carry no port; the request listener compares the full origin.
    patterns.push(`${url.protocol}//${url.hostname}/*`, `${socketProtocol}//${url.hostname}/*`);
  }
  return patterns;
}
