import type { OmpLoginPrompt, OmpLoginProvider, OmpLoginState } from "@t3tools/contracts";
import { parseLocalhostAuthRedirect } from "@t3tools/shared/localhostAuthRedirect";
import { isLoopbackHost } from "@t3tools/shared/preview";

/** The providers most people sign in to, in the order they are offered. */
const POPULAR_LOGIN_PROVIDER_IDS: ReadonlyArray<string> = [
  "anthropic",
  "openai-codex",
  "github-copilot",
  "google-antigravity",
  "google-gemini-cli",
  "openrouter",
  "xai",
  "xai-oauth",
  "deepseek",
];

export interface LoginProviderGroups {
  readonly popular: ReadonlyArray<OmpLoginProvider>;
  readonly others: ReadonlyArray<OmpLoginProvider>;
  /** Providers kept out of `others` until the user searches or asks for all of them. */
  readonly hiddenCount: number;
}

/** Popular providers in their fixed order, then the rest alphabetically once searched or expanded. */
export function groupLoginProviders(
  allProviders: ReadonlyArray<OmpLoginProvider>,
  query: string,
  showAll: boolean,
): LoginProviderGroups {
  // A variant (ChatGPT's device code) is another way into its service, not a service of its own.
  const providers = allProviders.filter(
    (provider) =>
      provider.variantOf === undefined ||
      !allProviders.some((other) => other.providerId === provider.variantOf),
  );
  const needle = query.trim().toLowerCase();
  const matches = (provider: OmpLoginProvider) =>
    needle === "" ||
    provider.name.toLowerCase().includes(needle) ||
    provider.providerId.toLowerCase().includes(needle) ||
    loginWays(provider, allProviders).some(
      (way) =>
        way.name.toLowerCase().includes(needle) || way.providerId.toLowerCase().includes(needle),
    );
  const popular = POPULAR_LOGIN_PROVIDER_IDS.flatMap((providerId) => {
    const provider = providers.find((candidate) => candidate.providerId === providerId);
    return provider !== undefined && matches(provider) ? [provider] : [];
  });
  const rest = providers
    .filter((provider) => !POPULAR_LOGIN_PROVIDER_IDS.includes(provider.providerId))
    .toSorted((left, right) => left.name.localeCompare(right.name));
  const revealed = needle !== "" || showAll;
  return {
    popular,
    others: revealed ? rest.filter(matches) : [],
    hiddenCount: revealed ? 0 : rest.length,
  };
}

export type LoginPanel = "active" | "finished" | "none";

/**
 * A running sign-in is shown to every client; a finished one only to the client that started it,
 * so reopening Settings later does not replay an old result.
 */
export function loginPanel(
  state: OmpLoginState | null,
  startedFlowId: string | null,
  dismissedFlowId: string | null,
): LoginPanel {
  if (state === null) return "none";
  if (state.phase === "starting" || state.phase === "waiting") return "active";
  const finished =
    state.phase === "succeeded" || state.phase === "failed" || state.phase === "cancelled";
  return finished && state.flowId !== null && state.flowId === startedFlowId
    ? state.flowId === dismissedFlowId
      ? "none"
      : "finished"
    : "none";
}

/**
 * Whether a provider counts as signed in: the server's listing, plus the sign-in this client just
 * finished, which the listing does not know about until it is read again.
 */
export function isSignedIn(
  provider: OmpLoginProvider,
  state: OmpLoginState | null,
  startedFlowId: string | null,
): boolean {
  return (
    provider.authenticated ||
    (state?.phase === "succeeded" &&
      state.flowId === startedFlowId &&
      state.providerId === provider.providerId)
  );
}

export type LoginFlowStep = "starting" | "oauth" | "device_code" | "api_key" | "prompt";

/** What to ask of the user. The server classifies a flow once its URL and prompt have settled. */
export function loginFlowStep(state: OmpLoginState): LoginFlowStep {
  if (state.kind !== null) return state.kind;
  return state.prompt !== null ? "prompt" : "starting";
}

/** omp words an optional question as "(blank for ...)" or "optional". */
export function promptIsOptional(prompt: Pick<OmpLoginPrompt, "message">): boolean {
  return /\b(blank|optional)\b/i.test(prompt.message);
}

export function canSubmitPrompt(prompt: OmpLoginPrompt, value: string): boolean {
  return value.trim() !== "" || promptIsOptional(prompt);
}

/**
 * The page to open for the client that started this flow, once per flow. `api_key` flows only
 * carry the provider's dashboard, which the user opens on purpose.
 */
export function authorizationUrlToOpen(
  state: OmpLoginState | null,
  startedFlowId: string | null,
  openedFlowId: string | null,
): string | null {
  if (state === null || state.authorizationUrl === null || state.flowId === null) return null;
  if (state.phase !== "starting" && state.phase !== "waiting") return null;
  if (state.kind !== "oauth" && state.kind !== "device_code") return null;
  return state.flowId === startedFlowId && state.flowId !== openedFlowId
    ? state.authorizationUrl
    : null;
}

/** Whether the provider list and models need re-reading because this client's sign-in finished. */
export function needsRefreshAfterSignIn(
  state: OmpLoginState | null,
  startedFlowId: string | null,
  refreshedFlowId: string | null,
): boolean {
  return (
    state?.phase === "succeeded" &&
    state.flowId !== null &&
    state.flowId === startedFlowId &&
    state.flowId !== refreshedFlowId
  );
}

export function authorizationHost(url: string): string | null {
  try {
    return new URL(url).host || null;
  } catch {
    return null;
  }
}

/** Where the browser that opens the sign-in page runs, relative to the server that runs omp. */
export type LoginLocality = "same_machine" | "remote";

/**
 * The provider redirects to `localhost` on the browser's machine, which only the server's own
 * listener can catch when both are one machine. That holds for a loopback connection (the desktop's
 * own server, `npx t3` on this computer) from a browser that is itself on loopback; an SSH or
 * relay route, or any other address, is a server somewhere else.
 */
export function loginLocality(input: {
  readonly targetTag: string | null;
  readonly httpBaseUrl: string | null;
  readonly browserHostname: string | null;
  readonly hasDesktopBridge: boolean;
}): LoginLocality {
  if (input.targetTag === "SshConnectionTarget" || input.targetTag === "RelayConnectionTarget") {
    return "remote";
  }
  let serverHostname: string | null = null;
  try {
    serverHostname = input.httpBaseUrl === null ? null : new URL(input.httpBaseUrl).hostname;
  } catch {
    serverHostname = null;
  }
  const browserOnLoopback =
    input.hasDesktopBridge ||
    (input.browserHostname !== null && isLoopbackHost(input.browserHostname));
  return serverHostname !== null && isLoopbackHost(serverHostname) && browserOnLoopback
    ? "same_machine"
    : "remote";
}

/** Every way to sign in to the service a provider row stands for: the provider and its variants. */
function loginWays(
  provider: OmpLoginProvider,
  providers: ReadonlyArray<OmpLoginProvider>,
): ReadonlyArray<OmpLoginProvider> {
  return [provider, ...providers.filter((other) => other.variantOf === provider.providerId)];
}

export interface LoginWayChoice {
  /** What the row's own button starts. */
  readonly primary: OmpLoginProvider;
  /** Offered under "Other ways to sign in". */
  readonly others: ReadonlyArray<OmpLoginProvider>;
}

/**
 * A device code finishes on its own wherever the browser is, so it leads unless the browser and
 * server share a machine, where the localhost redirect finishes just as hands-free and is the
 * service's regular sign-in.
 */
export function chooseLoginWay(
  provider: OmpLoginProvider,
  providers: ReadonlyArray<OmpLoginProvider>,
  locality: LoginLocality,
): LoginWayChoice {
  const ways = loginWays(provider, providers);
  const wanted = locality === "remote" ? "device_code" : "localhost_redirect";
  const primary =
    ways.find((way) => way.flow === wanted) ??
    (locality === "remote" ? undefined : ways.find((way) => way.flow !== "device_code")) ??
    provider;
  return { primary, others: ways.filter((way) => way !== primary) };
}

/** What a non-primary way is called in the "Other ways to sign in" list. */
export function loginWayLabel(way: OmpLoginProvider): string {
  switch (way.flow) {
    case "device_code":
      return "Approve with a device code";
    case "localhost_redirect":
      return "Browser sign-in (via localhost)";
    default:
      return "Sign in another way";
  }
}

/** Signed in through any of the service's ways. */
export function isServiceSignedIn(
  provider: OmpLoginProvider,
  providers: ReadonlyArray<OmpLoginProvider>,
  state: OmpLoginState | null,
  startedFlowId: string | null,
): boolean {
  return loginWays(provider, providers).some((way) => isSignedIn(way, state, startedFlowId));
}

/** The ways signing out has to remove: the ones signed in, or the service itself when none show. */
export function signOutWays(
  provider: OmpLoginProvider,
  providers: ReadonlyArray<OmpLoginProvider>,
  state: OmpLoginState | null,
  startedFlowId: string | null,
): ReadonlyArray<OmpLoginProvider> {
  const signedIn = loginWays(provider, providers).filter((way) =>
    isSignedIn(way, state, startedFlowId),
  );
  return signedIn.length === 0 ? [provider] : signedIn;
}

/**
 * The authorization URL whose `localhost` redirect the desktop shell should catch for this
 * client's running sign-in, or null. A same-machine server catches it itself, and a flow this
 * client did not start is another client's to finish.
 */
export function localhostBridgeUrl(
  state: OmpLoginState | null,
  startedFlowId: string | null,
  locality: LoginLocality,
  hasDesktopBridge: boolean,
): string | null {
  if (!hasDesktopBridge || locality !== "remote" || state === null) return null;
  if (state.phase !== "starting" && state.phase !== "waiting") return null;
  if (state.kind !== "oauth" || state.authorizationUrl === null) return null;
  if (state.flowId === null || state.flowId !== startedFlowId) return null;
  return parseLocalhostAuthRedirect(state.authorizationUrl) === null
    ? null
    : state.authorizationUrl;
}

/** The sign-in prompt a caught callback answers, once omp has asked for it. */
export function bridgeDeliveryTarget(
  state: OmpLoginState | null,
  caught: { readonly flowId: string } | null,
): { readonly flowId: string; readonly promptId: string } | null {
  if (state === null || caught === null || state.flowId !== caught.flowId) return null;
  if (state.phase !== "waiting" || state.prompt === null) return null;
  return { flowId: caught.flowId, promptId: state.prompt.id };
}

/** Provider names for the providers a copy would carry, in the order the local omp lists them. */
export function importedProviderNames(
  providerIds: ReadonlyArray<string>,
  providers: ReadonlyArray<OmpLoginProvider>,
): ReadonlyArray<string> {
  return providerIds.map(
    (providerId) =>
      providers.find((provider) => provider.providerId === providerId)?.name ?? providerId,
  );
}
