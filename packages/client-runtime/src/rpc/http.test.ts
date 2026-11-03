import { EnvironmentId } from "@t3tools/contracts";
import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import { TestClock } from "effect/testing";

import { mapRemoteEnvironmentError } from "../connection/errors.ts";
import { fetchRemoteEnvironmentDescriptor } from "../environment/descriptor.ts";
import { layerRemoteHttpClient, type RemoteAccessGate, type RemoteAccessRecovery } from "./http.ts";

const DESCRIPTOR = {
  environmentId: EnvironmentId.make("environment-behind-access"),
  label: "Behind Access",
  platform: { os: "linux", arch: "x64" },
  serverVersion: "0.0.0-test",
  capabilities: { repositoryIdentity: true },
};

// Behind Access, a browser fetch sees only a CORS failure on the redirect to the login page.
const makeHarness = (outcome: RemoteAccessRecovery) => {
  const recovered: string[] = [];
  let signedIn = false;
  let fetches = 0;
  const fetchFn: typeof globalThis.fetch = async () => {
    fetches += 1;
    if (!signedIn) throw new TypeError("Failed to fetch");
    return Response.json(DESCRIPTOR);
  };
  const gate: RemoteAccessGate = {
    recover: async (origin) => {
      recovered.push(origin);
      signedIn = outcome === "authorized";
      return outcome;
    },
  };
  return {
    layer: layerRemoteHttpClient(fetchFn, gate),
    recovered,
    fetches: () => fetches,
  };
};

const fetchDescriptor = fetchRemoteEnvironmentDescriptor({
  httpBaseUrl: "https://kcode.example.test/",
});

describe("layerRemoteHttpClient access gate", () => {
  it.effect("retries the request once the platform signs in to the origin", () => {
    const harness = makeHarness("authorized");
    return Effect.gen(function* () {
      const descriptor = yield* fetchDescriptor;
      expect(descriptor.environmentId).toBe(DESCRIPTOR.environmentId);
      expect(harness.recovered).toEqual(["https://kcode.example.test"]);
      expect(harness.fetches()).toBe(2);
    }).pipe(Effect.provide(harness.layer));
  });

  it.effect("blocks the connection instead of retrying when sign-in is cancelled", () => {
    const harness = makeHarness("cancelled");
    return Effect.gen(function* () {
      const error = yield* Effect.flip(fetchDescriptor);
      expect(error._tag).toBe("RemoteEnvironmentAccessSignInRequiredError");
      expect(mapRemoteEnvironmentError(error)).toMatchObject({
        _tag: "ConnectionBlockedError",
        reason: "authentication",
        detail: "Sign in to Cloudflare Access to reach https://kcode.example.test.",
      });
      expect(harness.fetches()).toBe(1);
    }).pipe(Effect.provide(harness.layer));
  });

  it.effect("keeps an ordinary network failure transient when no wall is in front", () => {
    const harness = makeHarness("not-gated");
    return Effect.gen(function* () {
      const error = yield* Effect.flip(fetchDescriptor);
      expect(error._tag).toBe("RemoteEnvironmentAuthFetchError");
      expect(mapRemoteEnvironmentError(error)).toMatchObject({
        _tag: "ConnectionTransientError",
        reason: "network",
      });
      expect(harness.fetches()).toBe(1);
    }).pipe(Effect.provide(harness.layer));
  });

  it.effect("does not time the request out while the user is signing in", () => {
    const started = Promise.withResolvers<void>();
    const finish = Promise.withResolvers<RemoteAccessRecovery>();
    let signedIn = false;
    const fetchFn: typeof globalThis.fetch = async () => {
      if (!signedIn) throw new TypeError("Failed to fetch");
      return Response.json(DESCRIPTOR);
    };
    const gate: RemoteAccessGate = {
      recover: () => {
        started.resolve();
        return finish.promise.then((outcome) => {
          signedIn = true;
          return outcome;
        });
      },
    };
    return Effect.gen(function* () {
      const fiber = yield* Effect.forkChild(fetchDescriptor);
      yield* Effect.promise(() => started.promise);
      yield* TestClock.adjust("5 minutes");
      finish.resolve("authorized");
      const descriptor = yield* Fiber.join(fiber);
      expect(descriptor.environmentId).toBe(DESCRIPTOR.environmentId);
    }).pipe(Effect.provide(layerRemoteHttpClient(fetchFn, gate)));
  });
});
