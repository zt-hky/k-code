// @effect-diagnostics-next-line nodeBuiltinImport:off -- Effect's Crypto cannot verify RS256 with a JWK.
import * as NodeCrypto from "node:crypto";
import * as Clock from "effect/Clock";
import * as Config from "effect/Config";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Ref from "effect/Ref";
import * as Schema from "effect/Schema";
import * as HttpClient from "effect/http/HttpClient";
import * as HttpClientRequest from "effect/http/HttpClientRequest";
import * as HttpClientResponse from "effect/http/HttpClientResponse";
import type * as HttpServerRequest from "effect/http/HttpServerRequest";

/** Cloudflare adds this header to every request it lets through an Access application. */
export const CLOUDFLARE_ACCESS_JWT_HEADER = "cf-access-jwt-assertion";
const CLOCK_SKEW_SECONDS = 60;
const KEYS_MAX_AGE_MS = 60 * 60 * 1_000;
const KEYS_MIN_REFRESH_MS = 60 * 1_000;

export interface CloudflareAccessSettings {
  /** Zero Trust team domain, for example `example.cloudflareaccess.com`. */
  readonly teamDomain: string;
  /** Application Audience (AUD) tag of the Access application. */
  readonly audience: string;
  /** Lowercase emails allowed to receive a session, checked after Access's own policy. */
  readonly allowedEmails: ReadonlySet<string>;
}

export interface CloudflareAccessIdentity {
  readonly email: string;
}

const JsonWebKey = Schema.Struct({
  kid: Schema.String,
  kty: Schema.Literal("RSA"),
  n: Schema.String,
  e: Schema.String,
});
const decodeKeySet = Schema.decodeUnknownEffect(
  Schema.Struct({ keys: Schema.Array(Schema.Unknown) }),
);
const decodeKey = Schema.decodeUnknownOption(JsonWebKey);
const decodeHeader = Schema.decodeUnknownOption(
  Schema.fromJsonString(Schema.Struct({ alg: Schema.Literal("RS256"), kid: Schema.String })),
);
const decodeClaims = Schema.decodeUnknownOption(
  Schema.fromJsonString(
    Schema.Struct({
      aud: Schema.Union([Schema.String, Schema.Array(Schema.String)]),
      iss: Schema.String,
      email: Schema.String,
      exp: Schema.Number,
      nbf: Schema.optionalKey(Schema.Number),
    }),
  ),
);

export function parseCloudflareAccessSettings(input: {
  readonly teamDomain: string;
  readonly audience: string;
  readonly allowedEmails: string;
}): CloudflareAccessSettings | undefined {
  const teamDomain = input.teamDomain
    .trim()
    .replace(/^https:\/\//u, "")
    .replace(/\/+$/u, "");
  const audience = input.audience.trim();
  const allowedEmails = new Set(
    input.allowedEmails
      .split(",")
      .map((email) => email.trim().toLowerCase())
      .filter((email) => email.length > 0),
  );
  if (!/^[a-z0-9.-]+$/iu.test(teamDomain) || audience.length === 0 || allowedEmails.size === 0) {
    return undefined;
  }
  return { teamDomain, audience, allowedEmails };
}

/**
 * Verifies a Cloudflare Access application token: RS256 signature from the team's
 * published keys, issuer, audience, validity window, and the local email allowlist.
 */
export function verifyCloudflareAccessToken(
  token: string,
  settings: CloudflareAccessSettings,
  keys: ReadonlyMap<string, NodeCrypto.KeyObject>,
  nowSeconds: number,
): CloudflareAccessIdentity | { readonly missingKeyId: string } | undefined {
  const [encodedHeader, encodedClaims, encodedSignature, ...rest] = token.split(".");
  if (!encodedHeader || !encodedClaims || !encodedSignature || rest.length > 0) return undefined;
  const header = decodeHeader(Buffer.from(encodedHeader, "base64url").toString("utf8"));
  if (Option.isNone(header)) return undefined;
  const key = keys.get(header.value.kid);
  if (key === undefined) return { missingKeyId: header.value.kid };
  const signed = NodeCrypto.verify(
    "RSA-SHA256",
    Buffer.from(`${encodedHeader}.${encodedClaims}`),
    key,
    Buffer.from(encodedSignature, "base64url"),
  );
  if (!signed) return undefined;
  const claims = decodeClaims(Buffer.from(encodedClaims, "base64url").toString("utf8"));
  if (Option.isNone(claims)) return undefined;
  const audiences = typeof claims.value.aud === "string" ? [claims.value.aud] : claims.value.aud;
  const email = claims.value.email.trim().toLowerCase();
  const valid =
    claims.value.iss === `https://${settings.teamDomain}` &&
    audiences.includes(settings.audience) &&
    claims.value.exp + CLOCK_SKEW_SECONDS > nowSeconds &&
    (claims.value.nbf ?? 0) - CLOCK_SKEW_SECONDS <= nowSeconds &&
    settings.allowedEmails.has(email);
  return valid ? { email } : undefined;
}

export class CloudflareAccess extends Context.Service<
  CloudflareAccess,
  {
    /** The verified Access identity on this request, if any. Never fails. */
    readonly identify: (
      request: HttpServerRequest.HttpServerRequest,
    ) => Effect.Effect<Option.Option<CloudflareAccessIdentity>>;
  }
>()("t3/auth/CloudflareAccess") {}

export const make = Effect.fn("CloudflareAccess.make")(function* (
  settings: CloudflareAccessSettings,
) {
  const httpClient = yield* HttpClient.HttpClient;
  const keysRef = yield* Ref.make<{
    readonly keys: ReadonlyMap<string, NodeCrypto.KeyObject>;
    readonly fetchedAt: number;
  }>({ keys: new Map(), fetchedAt: Number.NEGATIVE_INFINITY });

  const refreshKeys = Effect.fn("CloudflareAccess.refreshKeys")(function* () {
    const response = yield* httpClient
      .execute(HttpClientRequest.get(`https://${settings.teamDomain}/cdn-cgi/access/certs`))
      .pipe(Effect.flatMap(HttpClientResponse.filterStatusOk), Effect.timeout("10 seconds"));
    const keySet = yield* response.json.pipe(Effect.flatMap(decodeKeySet));
    const keys = new Map<string, NodeCrypto.KeyObject>();
    for (const candidate of keySet.keys) {
      const key = decodeKey(candidate);
      if (Option.isSome(key)) {
        keys.set(
          key.value.kid,
          NodeCrypto.createPublicKey({
            key: { kty: "RSA", n: key.value.n, e: key.value.e },
            format: "jwk",
          }),
        );
      }
    }
    const fetchedAt = yield* Clock.currentTimeMillis;
    yield* Ref.set(keysRef, { keys, fetchedAt });
    return keys;
  });

  const keysFor = Effect.fn("CloudflareAccess.keysFor")(function* (missingKeyId?: string) {
    const current = yield* Ref.get(keysRef);
    const now = yield* Clock.currentTimeMillis;
    const stale = now - current.fetchedAt > KEYS_MAX_AGE_MS;
    const rotated =
      missingKeyId !== undefined &&
      !current.keys.has(missingKeyId) &&
      now - current.fetchedAt > KEYS_MIN_REFRESH_MS;
    return stale || rotated ? yield* refreshKeys() : current.keys;
  });

  const identify: CloudflareAccess["Service"]["identify"] = Effect.fn("CloudflareAccess.identify")(
    function* (request) {
      const token = request.headers[CLOUDFLARE_ACCESS_JWT_HEADER];
      if (token === undefined || token.length === 0) return Option.none();
      const nowSeconds = Math.floor((yield* Clock.currentTimeMillis) / 1_000);
      let result = verifyCloudflareAccessToken(token, settings, yield* keysFor(), nowSeconds);
      if (result !== undefined && "missingKeyId" in result) {
        result = verifyCloudflareAccessToken(
          token,
          settings,
          yield* keysFor(result.missingKeyId),
          nowSeconds,
        );
      }
      if (result === undefined || "missingKeyId" in result) {
        yield* Effect.logWarning("rejected Cloudflare Access token");
        return Option.none();
      }
      return Option.some(result);
    },
    Effect.catchCause((cause) =>
      Effect.logWarning("Cloudflare Access verification failed", { cause }).pipe(
        Effect.as(Option.none<CloudflareAccessIdentity>()),
      ),
    ),
  );

  return CloudflareAccess.of({ identify });
});

const SettingsConfig = Config.all({
  teamDomain: Config.String("T3CODE_CLOUDFLARE_ACCESS_TEAM_DOMAIN").pipe(Config.withDefault("")),
  audience: Config.String("T3CODE_CLOUDFLARE_ACCESS_AUD").pipe(Config.withDefault("")),
  allowedEmails: Config.String("T3CODE_CLOUDFLARE_ACCESS_EMAILS").pipe(Config.withDefault("")),
});

/** Provides the service only when all three environment variables are set and valid. */
export const layer = Layer.unwrap(
  Effect.gen(function* () {
    const raw = yield* SettingsConfig;
    const configured = [raw.teamDomain, raw.audience, raw.allowedEmails].some(
      (value) => value.trim().length > 0,
    );
    const settings = parseCloudflareAccessSettings(raw);
    if (settings === undefined) {
      if (configured) {
        yield* Effect.logWarning(
          "Cloudflare Access sign-in disabled: set T3CODE_CLOUDFLARE_ACCESS_TEAM_DOMAIN, T3CODE_CLOUDFLARE_ACCESS_AUD and T3CODE_CLOUDFLARE_ACCESS_EMAILS",
        );
      }
      return Layer.empty;
    }
    yield* Effect.logInfo("Cloudflare Access sign-in enabled", {
      teamDomain: settings.teamDomain,
      allowedEmails: [...settings.allowedEmails],
    });
    return Layer.effect(CloudflareAccess, make(settings));
  }).pipe(Effect.orDie),
);
