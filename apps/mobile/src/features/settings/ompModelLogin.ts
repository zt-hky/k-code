import type { OmpLoginPrompt, OmpLoginProvider, OmpLoginState } from "@t3tools/contracts";

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

/** A variant (ChatGPT's device code) is another way into its service, not a row of its own. */
function offeredServices(
  providers: ReadonlyArray<OmpLoginProvider>,
): ReadonlyArray<OmpLoginProvider> {
  return providers.filter(
    (provider) =>
      provider.variantOf === undefined ||
      !providers.some((other) => other.providerId === provider.variantOf),
  );
}

/** Every way into the service a row stands for: the provider and its variants. */
export function loginWays(
  provider: OmpLoginProvider,
  providers: ReadonlyArray<OmpLoginProvider>,
): ReadonlyArray<OmpLoginProvider> {
  return [provider, ...providers.filter((other) => other.variantOf === provider.providerId)];
}

/**
 * A phone can never catch a `localhost` redirect, so a device code, which finishes on its own once
 * approved, leads whenever the service has one.
 */
export function preferredLoginProvider(
  provider: OmpLoginProvider,
  providers: ReadonlyArray<OmpLoginProvider>,
): OmpLoginProvider {
  return loginWays(provider, providers).find((way) => way.flow === "device_code") ?? provider;
}

/** Signed in through any way into the service. */
export function isServiceSignedIn(
  provider: OmpLoginProvider,
  providers: ReadonlyArray<OmpLoginProvider>,
): boolean {
  return loginWays(provider, providers).some((way) => way.authenticated);
}

/** Popular providers in a fixed order, then the rest alphabetically once searched or expanded. */
export function visibleLoginProviders(
  allProviders: ReadonlyArray<OmpLoginProvider>,
  query: string,
  showAll: boolean,
): { readonly visible: ReadonlyArray<OmpLoginProvider>; readonly hiddenCount: number } {
  const providers = offeredServices(allProviders);
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
    .sort((left, right) => left.name.localeCompare(right.name));
  const revealed = needle !== "" || showAll;
  return {
    visible: [...popular, ...(revealed ? rest.filter(matches) : [])],
    hiddenCount: revealed ? 0 : rest.length,
  };
}

/** The server classifies a flow once its URL and prompt settle; a prompt can arrive first. */
export function loginFlowStep(
  state: OmpLoginState,
): "starting" | "oauth" | "device_code" | "api_key" | "prompt" {
  if (state.kind !== null) return state.kind;
  return state.prompt !== null ? "prompt" : "starting";
}

/** omp words an optional question as "(blank for ...)" or "optional". */
export function canSubmitPrompt(prompt: OmpLoginPrompt, value: string): boolean {
  return value.trim() !== "" || /\b(blank|optional)\b/i.test(prompt.message);
}

/** One entry per signed-in service, for signing out. */
export function signedInServices(
  providers: ReadonlyArray<OmpLoginProvider>,
): ReadonlyArray<OmpLoginProvider> {
  return offeredServices(providers).filter((provider) => isServiceSignedIn(provider, providers));
}
