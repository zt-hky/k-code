// @effect-diagnostics-next-line nodeBuiltinImport:off -- Tests sign RS256 tokens like Cloudflare does.
import * as NodeCrypto from "node:crypto";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { EnvironmentHttpApi } from "@t3tools/contracts";
import { describe, expect, it } from "@effect/vitest";
import * as Context from "effect/Context";
import * as Crypto from "effect/Crypto";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Etag from "effect/http/Etag";
import * as HttpClient from "effect/http/HttpClient";
import * as HttpClientResponse from "effect/http/HttpClientResponse";
import * as HttpPlatform from "effect/http/HttpPlatform";
import * as HttpRouter from "effect/http/HttpRouter";
import * as HttpApi from "effect/http-api/HttpApi";
import * as HttpApiBuilder from "effect/http-api/HttpApiBuilder";

import * as ServerConfig from "../config.ts";
import * as ServerEnvironment from "../environment/ServerEnvironment.ts";
import * as SqlitePersistence from "../persistence/Sqlite.ts";
import * as EnvironmentAuth from "./EnvironmentAuth.ts";
import * as ServerSecretStore from "./ServerSecretStore.ts";
import * as AuthHttp from "./http.ts";
import {
  CLOUDFLARE_ACCESS_JWT_HEADER,
  CloudflareAccess,
  make as makeCloudflareAccess,
  parseCloudflareAccessSettings,
  verifyCloudflareAccessToken,
  type CloudflareAccessSettings,
} from "./CloudflareAccess.ts";

const { publicKey, privateKey } = NodeCrypto.generateKeyPairSync("rsa", { modulusLength: 2048 });
const otherKey = NodeCrypto.generateKeyPairSync("rsa", { modulusLength: 2048 }).privateKey;
const settings: CloudflareAccessSettings = {
  teamDomain: "team.cloudflareaccess.com",
  audience: "aud-tag",
  allowedEmails: new Set(["owner@example.com"]),
};
const keys = new Map([["kid-1", publicKey]]);
const now = 1_800_000_000;

function signCloudflareAccessToken(
  claims: Record<string, unknown>,
  input: { readonly key?: NodeCrypto.KeyObject; readonly kid?: string } = {},
): string {
  const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");
  const signingInput = `${encode({ alg: "RS256", kid: input.kid ?? "kid-1" })}.${encode({
    aud: ["aud-tag"],
    iss: "https://team.cloudflareaccess.com",
    email: "Owner@Example.com",
    exp: now + 600,
    nbf: now - 10,
    ...claims,
  })}`;
  const signature = NodeCrypto.sign(
    "RSA-SHA256",
    Buffer.from(signingInput),
    input.key ?? privateKey,
  ).toString("base64url");
  return `${signingInput}.${signature}`;
}

describe("verifyCloudflareAccessToken", () => {
  it("accepts a correctly signed token for an allowed email", () => {
    expect(verifyCloudflareAccessToken(signCloudflareAccessToken({}), settings, keys, now)).toEqual(
      { email: "owner@example.com" },
    );
  });

  it.each([
    ["another application", { aud: ["other-aud"] }],
    ["another team", { iss: "https://evil.cloudflareaccess.com" }],
    ["an expired token", { exp: now - 120 }],
    ["a token not yet valid", { nbf: now + 120 }],
    ["an email outside the allowlist", { email: "intruder@example.com" }],
  ])("rejects %s", (_name, claims) => {
    expect(
      verifyCloudflareAccessToken(signCloudflareAccessToken(claims), settings, keys, now),
    ).toBeUndefined();
  });

  it("rejects forged signatures and asks for unknown signing keys", () => {
    expect(
      verifyCloudflareAccessToken(
        signCloudflareAccessToken({}, { key: otherKey }),
        settings,
        keys,
        now,
      ),
    ).toBeUndefined();
    expect(
      verifyCloudflareAccessToken(
        signCloudflareAccessToken({}, { kid: "kid-2" }),
        settings,
        keys,
        now,
      ),
    ).toEqual({ missingKeyId: "kid-2" });
    expect(verifyCloudflareAccessToken("not.a-token", settings, keys, now)).toBeUndefined();
  });
});

describe("parseCloudflareAccessSettings", () => {
  it("requires a team domain, audience, and at least one email", () => {
    expect(
      parseCloudflareAccessSettings({
        teamDomain: "https://team.cloudflareaccess.com/",
        audience: " aud-tag ",
        allowedEmails: "Owner@Example.com, ",
      }),
    ).toEqual(settings);
    expect(
      parseCloudflareAccessSettings({
        teamDomain: "team.cloudflareaccess.com",
        audience: "aud-tag",
        allowedEmails: " , ",
      }),
    ).toBeUndefined();
  });
});

class AuthTestApi extends HttpApi.make("environment").add(EnvironmentHttpApi.groups.auth) {}

describe("Cloudflare Access sign-in", () => {
  const layerConfig = ServerConfig.layerTest(process.cwd(), { prefix: "t3-cf-access-test-" });
  const layerCertificates = Layer.succeed(
    HttpClient.HttpClient,
    HttpClient.make((request) =>
      Effect.succeed(
        HttpClientResponse.fromWeb(
          request,
          Response.json({ keys: [{ ...publicKey.export({ format: "jwk" }), kid: "kid-1" }] }),
        ),
      ),
    ),
  );
  const layerRoutes = HttpApiBuilder.layer(AuthTestApi).pipe(
    Layer.provide(
      AuthHttp.layer.pipe(
        Layer.provide(
          Layer.effect(CloudflareAccess, makeCloudflareAccess(settings)).pipe(
            Layer.provide(layerCertificates),
          ),
        ),
      ),
    ),
    Layer.provide(AuthHttp.layerAuthenticatedAuth),
    Layer.provideMerge(
      EnvironmentAuth.layer.pipe(
        Layer.provide(SqlitePersistence.layerMemory),
        Layer.provide(ServerSecretStore.layer),
        Layer.provide(ServerEnvironment.layerIdentity),
        Layer.provide(layerConfig),
      ),
    ),
    Layer.provide(layerConfig),
    Layer.provideMerge(
      HttpPlatform.layer.pipe(
        Layer.provideMerge(NodeServices.layer),
        Layer.provideMerge(Etag.layerWeak),
      ),
    ),
    Layer.provide(NodeServices.layer),
  );
  // Far-future expiry keeps the token valid under both the test and the wall clock.
  const validClaims = { exp: 4_000_000_000, nbf: 0 };

  it.effect("exchanges a verified Access identity for a browser session cookie", () =>
    Effect.gen(function* () {
      const crypto = yield* Crypto.Crypto;
      const requestContext = Context.make(Crypto.Crypto, crypto).pipe(
        Context.add(
          ServerSecretStore.ServerSecretStore,
          ServerSecretStore.ServerSecretStore.of({
            get: () => Effect.succeedNone,
            set: () => Effect.void,
            create: () => Effect.void,
            getOrCreateRandom: () => Effect.die("Not used by these routes."),
            remove: () => Effect.void,
          }),
        ),
      );
      return yield* Effect.acquireUseRelease(
        Effect.sync(() => HttpRouter.toWebHandler(layerRoutes, { disableLogger: true })),
        (environment) =>
          Effect.tryPromise(async () => {
            const session = (headers: Record<string, string>) =>
              environment.handler(
                new Request("http://127.0.0.1/api/auth/session", { headers }),
                requestContext,
              );

            for (const token of [
              signCloudflareAccessToken(validClaims, { key: otherKey }),
              signCloudflareAccessToken({ ...validClaims, email: "intruder@example.com" }),
            ]) {
              const rejected = await session({
                [CLOUDFLARE_ACCESS_JWT_HEADER]: token,
              });
              expect(await rejected.json()).toMatchObject({ authenticated: false });
              expect(rejected.headers.getSetCookie()).toEqual([]);
            }

            const accepted = await session({
              [CLOUDFLARE_ACCESS_JWT_HEADER]: signCloudflareAccessToken(validClaims),
            });
            expect(await accepted.json()).toMatchObject({
              authenticated: true,
              sessionMethod: "browser-session-cookie",
            });
            const cookie = accepted.headers.getSetCookie()[0]?.split(";", 1)[0] ?? "";
            expect(cookie).toMatch(/^t3_session_/);

            // The cookie alone carries the session afterwards, like a paired browser.
            const pairing = await environment.handler(
              new Request("http://127.0.0.1/api/auth/pairing-token", {
                method: "POST",
                headers: { cookie, "content-type": "application/json" },
                body: JSON.stringify({ scopes: ["orchestration:read"] }),
              }),
              requestContext,
            );
            expect(pairing.status).toBe(200);
          }),
        (environment) => Effect.promise(() => environment.dispose()),
      );
    }).pipe(Effect.provide(NodeServices.layer)),
  );
});
