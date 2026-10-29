// @effect-diagnostics nodeBuiltinImport:off globalTimers:off - Bounded one-shot loopback listener with explicit cleanup.
import * as NodeHttp from "node:http";
import {
  isLocalhostAuthHost,
  type LocalhostAuthRedirect,
  matchLocalhostAuthCallback,
  parseLocalhostAuthRedirect,
} from "@t3tools/shared/localhostAuthRedirect";

/** How long a sign-in may take before its listener is given up. */
const LOCALHOST_AUTH_BRIDGE_TIMEOUT_MS = 10 * 60 * 1000;

export type LocalhostAuthBridgeOutcome =
  | { readonly status: "received"; readonly callbackUrl: string }
  | {
      readonly status: "unavailable";
      /** `invalid_request`: not a localhost redirect. `port_busy`: another program holds the port. */
      readonly reason: "invalid_request" | "port_busy" | "cancelled" | "expired";
    };

const PAGE = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light dark"><title>T3 Code</title><style>body{font-family:system-ui;display:grid;place-items:center;min-height:90vh;margin:0}main{max-width:360px;padding:32px}h1{font-size:24px}p{line-height:1.6;opacity:.7}</style></head><body><main><h1>You can close this tab</h1><p>T3 Code received your sign-in and is finishing it.</p></main></body></html>`;

interface ActiveBridge {
  readonly abort: AbortController;
  /** Settles once the listener is closed and its port is free. */
  readonly closed: Promise<void>;
}

const activeByState = new Map<string, ActiveBridge>();
// Sign-ins without a state are told apart by the port they wait on.
const stateKey = (redirect: LocalhostAuthRedirect) => redirect.state ?? `port:${redirect.port}`;

/** Stops the listener for the sign-in whose authorization URL this is, if one is open. */
export function cancelLocalhostAuthCallback(authorizationUrl: string): void {
  const redirect = parseLocalhostAuthRedirect(authorizationUrl);
  if (redirect !== null) activeByState.get(stateKey(redirect))?.abort.abort();
}

/**
 * Listens on 127.0.0.1 at the authorization URL's redirect port for the one request that
 * completes this sign-in, then closes. The listener lives only until that request, `signal`,
 * or `timeoutMs`. The caller forwards the returned callback URL to the server that runs the
 * sign-in; this never learns what the code is for.
 */
export async function receiveLocalhostAuthCallback(
  authorizationUrl: string,
  options?: {
    readonly timeoutMs?: number;
    readonly signal?: AbortSignal;
    /** Called once the port is bound, which is when a browser can reach it. */
    readonly onListening?: () => void;
  },
): Promise<LocalhostAuthBridgeOutcome> {
  const redirect = parseLocalhostAuthRedirect(authorizationUrl);
  if (redirect === null) return { status: "unavailable", reason: "invalid_request" };
  // A second request for the same sign-in replaces the first, so a re-render never leaves two.
  const previous = activeByState.get(stateKey(redirect));
  previous?.abort.abort();
  const abort = new AbortController();
  const closed = Promise.withResolvers<void>();
  const active: ActiveBridge = { abort, closed: closed.promise };
  activeByState.set(stateKey(redirect), active);

  const done = Promise.withResolvers<LocalhostAuthBridgeOutcome>();
  const server = NodeHttp.createServer((incoming, response) => {
    response.setHeader("cache-control", "no-store");
    response.setHeader("referrer-policy", "no-referrer");
    response.setHeader("x-content-type-options", "nosniff");
    if (!isLocalhostAuthHost(incoming.headers.host, redirect.port)) {
      response.writeHead(421).end();
      return;
    }
    if (incoming.method !== "GET") {
      response.writeHead(405).end();
      return;
    }
    const target = incoming.url ?? "/";
    if (new URL(target, redirect.redirectUri).pathname !== redirect.path) {
      response.writeHead(404).end();
      return;
    }
    const callbackUrl = matchLocalhostAuthCallback(target, redirect);
    if (callbackUrl === null) {
      // A stale or foreign response must not end the sign-in the user is still completing.
      response.writeHead(400).end("This response does not belong to the active sign-in.");
      return;
    }
    response
      .writeHead(200, {
        "content-type": "text/html; charset=utf-8",
        "content-security-policy":
          "default-src 'none'; style-src 'unsafe-inline'; frame-ancestors 'none'",
      })
      .end(PAGE);
    done.resolve({ status: "received", callbackUrl });
  });

  const stop = (reason: "cancelled" | "expired") => () =>
    done.resolve({ status: "unavailable", reason });
  const onCancel = stop("cancelled");
  abort.signal.addEventListener("abort", onCancel, { once: true });
  const onSignal = () => abort.abort();
  options?.signal?.addEventListener("abort", onSignal, { once: true });
  const timer = setTimeout(stop("expired"), options?.timeoutMs ?? LOCALHOST_AUTH_BRIDGE_TIMEOUT_MS);
  timer.unref();

  try {
    if (options?.signal?.aborted) return { status: "unavailable", reason: "cancelled" };
    await previous?.closed;
    const bound = await new Promise<boolean>((resolve) => {
      server.once("error", () => resolve(false));
      server.listen({ port: redirect.port, host: "127.0.0.1", exclusive: true }, () =>
        resolve(true),
      );
    });
    if (!bound) return { status: "unavailable", reason: "port_busy" };
    options?.onListening?.();
    return await done.promise;
  } finally {
    clearTimeout(timer);
    options?.signal?.removeEventListener("abort", onSignal);
    abort.signal.removeEventListener("abort", onCancel);
    if (activeByState.get(stateKey(redirect)) === active) activeByState.delete(stateKey(redirect));
    if (server.listening) {
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
    closed.resolve();
  }
}
