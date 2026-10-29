import type { OmpLoginPrompt, OmpLoginProvider, OmpLoginState } from "@t3tools/contracts";

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
  providers: ReadonlyArray<OmpLoginProvider>,
  query: string,
  showAll: boolean,
): LoginProviderGroups {
  const needle = query.trim().toLowerCase();
  const matches = (provider: OmpLoginProvider) =>
    needle === "" ||
    provider.name.toLowerCase().includes(needle) ||
    provider.providerId.toLowerCase().includes(needle);
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
