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

/** Popular providers in a fixed order, then the rest alphabetically once searched or expanded. */
export function visibleLoginProviders(
  providers: ReadonlyArray<OmpLoginProvider>,
  query: string,
  showAll: boolean,
): { readonly visible: ReadonlyArray<OmpLoginProvider>; readonly hiddenCount: number } {
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
