import type {
  DesktopCloudflareAccessRecovery,
  DesktopCloudflareAccessSession,
} from "@t3tools/contracts";
import type { Cookie, Session } from "electron";
import { BrowserWindow, session } from "electron";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import * as HttpClient from "effect/http/HttpClient";
import * as HttpClientRequest from "effect/http/HttpClientRequest";

import * as DesktopEnvironment from "../app/DesktopEnvironment.ts";
import {
  CLOUDFLARE_ACCESS_COOKIE,
  CLOUDFLARE_ACCESS_TOKEN_HEADER,
  cloudflareAccessOrigin,
  cloudflareAccessTokenExpiresAtMs,
  cloudflareAccessUrlPatterns,
  isCloudflareAccessChallenge,
} from "./cloudflareAccessPolicy.ts";

// Access cookies live in their own encrypted Chromium cookie jar, not the renderer's. The team
// login cookie there lets an expired app token renew without asking again.
const LOGIN_PARTITION = "persist:t3code-cloudflare-access";
const PROBE_PATH = "/.well-known/t3/environment";
const PROBE_TIMEOUT = "10 seconds";

interface AccessToken {
  readonly token: string;
  readonly expiresAtMs: number | null;
}

export class DesktopCloudflareAccess extends Context.Service<
  DesktopCloudflareAccess,
  {
    /** Loads saved sign-ins and starts adding their tokens to renderer traffic. Needs app ready. */
    readonly install: Effect.Effect<void>;
    readonly recover: (origin: string) => Effect.Effect<DesktopCloudflareAccessRecovery>;
    readonly sessions: Effect.Effect<ReadonlyArray<DesktopCloudflareAccessSession>>;
    readonly clear: (origin: string) => Effect.Effect<void>;
  }
>()("@t3tools/desktop/cloudflareAccess/DesktopCloudflareAccess") {}

async function readAccessCookie(loginSession: Session, origin: string): Promise<Cookie | null> {
  const cookies = await loginSession.cookies.get({ url: origin, name: CLOUDFLARE_ACCESS_COOKIE });
  return cookies.find((cookie) => cookie.value.length > 0) ?? null;
}

/** Shows the Access login only once the page leaves the origin, so a live team session renews silently. */
function signIn(loginSession: Session, origin: string): Promise<Cookie | null> {
  const { promise, resolve } = Promise.withResolvers<Cookie | null>();
  const window = new BrowserWindow({
    show: false,
    width: 520,
    height: 720,
    title: "Sign in to Cloudflare Access",
    autoHideMenuBar: true,
    webPreferences: {
      partition: LOGIN_PARTITION,
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  let settled = false;
  const finish = (cookie: Cookie | null) => {
    if (settled) return;
    settled = true;
    resolve(cookie);
    if (!window.isDestroyed()) window.destroy();
  };
  const reveal = () => {
    if (settled || window.isDestroyed() || window.isVisible()) return;
    window.show();
    window.focus();
  };
  window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  window.on("closed", () => finish(null));
  window.webContents.on("did-navigate", (_event, url) => {
    if (cloudflareAccessOrigin(url) !== origin) {
      reveal();
      return;
    }
    if (new URL(url).pathname.startsWith("/cdn-cgi/")) return;
    void readAccessCookie(loginSession, origin).then(
      (cookie) => (cookie === null ? reveal() : finish(cookie)),
      reveal,
    );
  });
  window.loadURL(`${origin}${PROBE_PATH}`).catch(reveal);
  return promise;
}

const SavedOrigins = Schema.fromJsonString(Schema.Array(Schema.String));
const encodeSavedOrigins = Schema.encodeEffect(SavedOrigins);
const decodeSavedOrigins = Schema.decodeEffect(SavedOrigins);

const make = Effect.gen(function* () {
  const environment = yield* DesktopEnvironment.DesktopEnvironment;
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  // Undici leaves redirects alone, so the probe sees the Access login Location. Chromium's
  // `net.fetch` hands back an opaque redirect that hides it.
  const httpClient = yield* HttpClient.HttpClient;
  // Origins are not secret; the tokens stay in the login partition's cookie jar.
  const originsPath = path.join(environment.stateDir, "cloudflare-access-origins.json");
  const tokens = new Map<string, AccessToken>();
  const inFlight = new Map<string, Deferred.Deferred<DesktopCloudflareAccessRecovery>>();
  const loginSession = () => session.fromPartition(LOGIN_PARTITION);

  const applyHeaderInjection = () => {
    const webRequest = session.defaultSession.webRequest;
    if (tokens.size === 0) {
      webRequest.onBeforeSendHeaders(null);
      return;
    }
    // Main adds the header after the renderer's CORS checks, so preflights and WebSocket
    // upgrades pass the Access edge too, and the token never reaches the renderer.
    webRequest.onBeforeSendHeaders(
      { urls: cloudflareAccessUrlPatterns(tokens.keys()) },
      (details, callback) => {
        const token = tokens.get(cloudflareAccessOrigin(details.url) ?? "")?.token;
        callback({
          requestHeaders:
            token === undefined
              ? details.requestHeaders
              : { ...details.requestHeaders, [CLOUDFLARE_ACCESS_TOKEN_HEADER]: token },
        });
      },
    );
  };

  const persistOrigins = Effect.suspend(() => encodeSavedOrigins([...tokens.keys()])).pipe(
    Effect.flatMap((raw) => fileSystem.writeFileString(originsPath, raw)),
    Effect.catch((cause) =>
      Effect.logWarning("Could not save Cloudflare Access origins", { cause }),
    ),
  );

  const remember = Effect.fn("DesktopCloudflareAccess.remember")(function* (
    origin: string,
    cookie: Cookie,
  ) {
    const expiresAtMs = cloudflareAccessTokenExpiresAtMs(cookie.value);
    tokens.set(origin, { token: cookie.value, expiresAtMs });
    applyHeaderInjection();
    // Access may issue a browser-session cookie, which Chromium drops on quit.
    if (cookie.session === true && expiresAtMs !== null) {
      yield* Effect.tryPromise(() =>
        loginSession().cookies.set({
          url: origin,
          name: CLOUDFLARE_ACCESS_COOKIE,
          value: cookie.value,
          path: cookie.path ?? "/",
          secure: cookie.secure ?? origin.startsWith("https:"),
          httpOnly: true,
          expirationDate: expiresAtMs / 1_000,
        }),
      ).pipe(Effect.ignore);
    }
    // Chromium writes cookies to disk lazily; a quit soon after sign-in would lose it.
    yield* Effect.tryPromise(() => loginSession().cookies.flushStore()).pipe(Effect.ignore);
    yield* persistOrigins;
  });

  const install = Effect.gen(function* () {
    const origins = yield* fileSystem.readFileString(originsPath).pipe(
      Effect.flatMap(decodeSavedOrigins),
      Effect.orElseSucceed((): ReadonlyArray<string> => []),
    );
    for (const origin of origins) {
      const cookie = yield* Effect.tryPromise(() => readAccessCookie(loginSession(), origin)).pipe(
        Effect.orElseSucceed(() => null),
      );
      if (cookie === null) continue;
      tokens.set(origin, {
        token: cookie.value,
        expiresAtMs: cloudflareAccessTokenExpiresAtMs(cookie.value),
      });
    }
    applyHeaderInjection();
  }).pipe(Effect.withSpan("DesktopCloudflareAccess.install"));

  const probeIsGated = Effect.fn("DesktopCloudflareAccess.probe")(
    function* (origin: string) {
      const token = tokens.get(origin)?.token;
      const response = yield* httpClient
        .execute(
          HttpClientRequest.get(`${origin}${PROBE_PATH}`).pipe(
            HttpClientRequest.setHeaders(
              token === undefined ? {} : { [CLOUDFLARE_ACCESS_TOKEN_HEADER]: token },
            ),
          ),
        )
        .pipe(Effect.timeout(PROBE_TIMEOUT));
      return isCloudflareAccessChallenge({
        status: response.status,
        location: response.headers["location"] ?? null,
        wwwAuthenticate: response.headers["www-authenticate"] ?? null,
      });
    },
    Effect.orElseSucceed(() => false),
  );

  const recoverOrigin = Effect.fn("DesktopCloudflareAccess.recoverOrigin")(function* (
    origin: string,
  ) {
    if (!(yield* probeIsGated(origin))) return "not-gated" as const;
    const cookie = yield* Effect.promise(() => signIn(loginSession(), origin));
    if (cookie === null) return "cancelled" as const;
    yield* remember(origin, cookie);
    return "authorized" as const;
  });

  const recover = Effect.fn("DesktopCloudflareAccess.recover")(function* (rawOrigin: string) {
    const origin = cloudflareAccessOrigin(rawOrigin);
    if (origin === null) return "not-gated" as const;
    // Every request that failed while the token expired lands here; they share one sign-in.
    const pending = inFlight.get(origin);
    if (pending !== undefined) return yield* Deferred.await(pending);
    const deferred = yield* Deferred.make<DesktopCloudflareAccessRecovery>();
    inFlight.set(origin, deferred);
    return yield* recoverOrigin(origin).pipe(
      Effect.onExit((exit) =>
        Effect.sync(() => inFlight.delete(origin)).pipe(
          Effect.andThen(Deferred.done(deferred, exit)),
        ),
      ),
    );
  });

  const sessions = Effect.sync(() =>
    [...tokens].map(([origin, { expiresAtMs }]) => ({
      origin,
      expiresAt: expiresAtMs === null ? null : DateTime.formatIso(DateTime.makeUnsafe(expiresAtMs)),
    })),
  );

  const clear = Effect.fn("DesktopCloudflareAccess.clear")(function* (rawOrigin: string) {
    const origin = cloudflareAccessOrigin(rawOrigin);
    if (origin === null || !tokens.delete(origin)) return;
    applyHeaderInjection();
    yield* Effect.tryPromise(async () => {
      await loginSession().cookies.remove(origin, CLOUDFLARE_ACCESS_COOKIE);
      await loginSession().cookies.flushStore();
    }).pipe(Effect.ignore);
    yield* persistOrigins;
  });

  return DesktopCloudflareAccess.of({ install, recover, sessions, clear });
});

export const layer = Layer.effect(DesktopCloudflareAccess, make);
