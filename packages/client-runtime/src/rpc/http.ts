import {
  EnvironmentHttpApi,
  EnvironmentHttpCommonError,
  type EnvironmentAuthInvalidError,
  type EnvironmentInternalError,
  type EnvironmentOperationForbiddenError,
  type EnvironmentRequestInvalidError,
  type EnvironmentResourceNotFoundError,
  type EnvironmentScopeRequiredError,
} from "@t3tools/contracts";
import * as HttpObservability from "@t3tools/shared/httpObservability";
import * as Data from "effect/Data";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import { FetchHttpClient, HttpClient, HttpClientError } from "effect/http";
import * as HttpApiClient from "effect/http-api/HttpApiClient";

const isEnvironmentHttpCommonError = Schema.is(EnvironmentHttpCommonError);

export class RemoteEnvironmentAuthFetchError extends Data.TaggedError(
  "RemoteEnvironmentAuthFetchError",
)<{
  readonly message: string;
  readonly cause: unknown;
}> {}

class RemoteEnvironmentAuthInvalidJsonError extends Data.TaggedError(
  "RemoteEnvironmentAuthInvalidJsonError",
)<{
  readonly message: string;
  readonly cause: unknown;
}> {}

export class RemoteEnvironmentAuthUndeclaredStatusError extends Data.TaggedError(
  "RemoteEnvironmentAuthUndeclaredStatusError",
)<{
  readonly message: string;
  readonly status: number;
  readonly requestUrl: string;
}> {
  constructor(requestUrl: string, status: number) {
    super({
      message: `Remote environment endpoint ${requestUrl} returned undeclared status ${status}.`,
      requestUrl,
      status,
    });
  }
}

export class RemoteEnvironmentAuthTimeoutError extends Data.TaggedError(
  "RemoteEnvironmentAuthTimeoutError",
)<{
  readonly message: string;
  readonly requestUrl: string;
  readonly timeoutMs: number;
}> {
  constructor(requestUrl: string, timeoutMs: number) {
    super({
      message: `Remote environment endpoint ${requestUrl} timed out after ${timeoutMs}ms.`,
      requestUrl,
      timeoutMs,
    });
  }
}

/** The remote's edge (Cloudflare Access) wants a sign-in the user declined to finish. */
class RemoteEnvironmentAccessSignInRequiredError extends Data.TaggedError(
  "RemoteEnvironmentAccessSignInRequiredError",
)<{
  readonly message: string;
  readonly origin: string;
}> {
  constructor(origin: string) {
    super({ message: `Sign in to Cloudflare Access to reach ${origin}.`, origin });
  }
}

export type RemoteAccessRecovery = "authorized" | "not-gated" | "cancelled";

/**
 * A platform hook for an identity wall in front of a remote origin. Browser fetches see only
 * a network failure there, so the platform probes the origin and signs in out of band.
 */
export interface RemoteAccessGate {
  readonly recover: (origin: string) => Promise<RemoteAccessRecovery>;
}

// A person signing in to Access takes longer than any request timeout, so deadlines wait the
// sign-in out and then grant the retried request a fresh full allowance.
let accessSignIns = 0;

const withDeadline = <A, E, R>(request: Effect.Effect<A, E, R>, timeoutMs: number) => {
  const deadline = Effect.gen(function* () {
    yield* Effect.sleep(Duration.millis(timeoutMs));
    while (accessSignIns > 0) {
      while (accessSignIns > 0) yield* Effect.sleep(Duration.millis(250));
      yield* Effect.sleep(Duration.millis(timeoutMs));
    }
    return Option.none<A>();
  });
  return Effect.raceFirst(request.pipe(Effect.asSome), deadline);
};

const gateFetch =
  (fetchFn: typeof globalThis.fetch, gate: RemoteAccessGate): typeof globalThis.fetch =>
  async (input, init) => {
    try {
      return await fetchFn(input, init);
    } catch (error) {
      if (init?.signal?.aborted) throw error;
      const url = input instanceof Request ? input.url : String(input);
      const origin = URL.canParse(url) ? new URL(url).origin : null;
      if (origin === null) throw error;
      accessSignIns += 1;
      const outcome = await gate
        .recover(origin)
        .catch(() => "not-gated" as const)
        .finally(() => {
          accessSignIns -= 1;
        });
      if (outcome === "cancelled") throw new RemoteEnvironmentAccessSignInRequiredError(origin);
      // A streamed body is spent; the caller's own retry resends it with the new credential.
      if (outcome === "not-gated" || init?.body instanceof ReadableStream) throw error;
      return fetchFn(input, init);
    }
  };

export type RemoteEnvironmentRequestError =
  | EnvironmentRequestInvalidError
  | EnvironmentAuthInvalidError
  | EnvironmentScopeRequiredError
  | EnvironmentOperationForbiddenError
  | EnvironmentResourceNotFoundError
  | EnvironmentInternalError
  | RemoteEnvironmentAuthFetchError
  | RemoteEnvironmentAuthInvalidJsonError
  | RemoteEnvironmentAuthUndeclaredStatusError
  | RemoteEnvironmentAuthTimeoutError
  | RemoteEnvironmentAccessSignInRequiredError;

export const layerRemoteHttpClient = (
  fetchFn: typeof globalThis.fetch,
  gate?: RemoteAccessGate,
): Layer.Layer<HttpClient.HttpClient> =>
  Layer.merge(
    FetchHttpClient.layer.pipe(
      Layer.provide(
        Layer.succeed(
          FetchHttpClient.Fetch,
          gate === undefined ? fetchFn : gateFetch(fetchFn, gate),
        ),
      ),
    ),
    HttpObservability.layer,
  );

const remoteApiBaseUrl = (httpBaseUrl: string): string => {
  const url = new URL(httpBaseUrl);
  url.pathname = "/";
  url.search = "";
  url.hash = "";
  return url.toString();
};

export const makeEnvironmentHttpApiClient = (httpBaseUrl: string) =>
  HttpApiClient.make(EnvironmentHttpApi, {
    baseUrl: remoteApiBaseUrl(httpBaseUrl),
  });

export const makeEnvironmentHttpApiGroupClient = <
  Group extends keyof typeof EnvironmentHttpApi.groups,
>(
  httpBaseUrl: string,
  group: Group,
) =>
  Effect.flatMap(HttpClient.HttpClient, (httpClient) =>
    HttpApiClient.group(EnvironmentHttpApi, {
      httpClient,
      group,
      baseUrl: remoteApiBaseUrl(httpBaseUrl),
    }),
  );

export const makeEnvironmentHttpApiUrlBuilder = (httpBaseUrl: string) =>
  HttpApiClient.urlBuilder(EnvironmentHttpApi, {
    baseUrl: remoteApiBaseUrl(httpBaseUrl),
  });

const findAccessSignInRequired = (
  cause: unknown,
): RemoteEnvironmentAccessSignInRequiredError | undefined => {
  for (let current = cause, depth = 0; depth < 4; depth += 1) {
    if (current instanceof RemoteEnvironmentAccessSignInRequiredError) return current;
    if (typeof current !== "object" || current === null || !("cause" in current)) return undefined;
    current = current.cause;
  }
  return undefined;
};

const failRemoteRequest = (
  requestUrl: string,
  cause: unknown,
): Effect.Effect<never, RemoteEnvironmentRequestError> => {
  if (cause instanceof RemoteEnvironmentAuthTimeoutError) {
    return Effect.fail(cause);
  }
  const signInRequired = findAccessSignInRequired(cause);
  if (signInRequired !== undefined) {
    return Effect.fail(signInRequired);
  }
  if (isEnvironmentHttpCommonError(cause)) {
    return Effect.fail(cause);
  }
  if (Schema.isSchemaError(cause)) {
    return Effect.fail(
      new RemoteEnvironmentAuthInvalidJsonError({
        message: `Remote environment endpoint returned an invalid response from ${requestUrl}.`,
        cause,
      }),
    );
  }
  if (HttpClientError.isHttpClientError(cause) && cause.response !== undefined) {
    const response = cause.response;
    if (response.status < 200 || response.status >= 300) {
      return Effect.fail(
        new RemoteEnvironmentAuthUndeclaredStatusError(requestUrl, response.status),
      );
    }
    return Effect.fail(
      new RemoteEnvironmentAuthInvalidJsonError({
        message: `Remote environment endpoint returned an invalid response from ${requestUrl}.`,
        cause,
      }),
    );
  }
  return Effect.fail(
    new RemoteEnvironmentAuthFetchError({
      message: `Failed to fetch remote environment endpoint ${requestUrl} (${String(cause)}).`,
      cause,
    }),
  );
};

export const executeEnvironmentHttpRequest = <A, E, R>(
  requestUrl: string,
  timeoutMs: number,
  request: Effect.Effect<A, E, R>,
): Effect.Effect<A, RemoteEnvironmentRequestError, R> =>
  request.pipe(
    (effect) => withDeadline(effect, timeoutMs),
    Effect.flatMap(
      Option.match({
        onNone: () => Effect.fail(new RemoteEnvironmentAuthTimeoutError(requestUrl, timeoutMs)),
        onSome: Effect.succeed,
      }),
    ),
    Effect.catch((cause) => failRemoteRequest(requestUrl, cause)),
  );
