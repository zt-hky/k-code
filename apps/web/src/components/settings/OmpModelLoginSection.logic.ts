import type { OmpLoginProvider, OmpLoginState } from "@t3tools/contracts";

/** Signed-in providers first, then omp's own order, narrowed by what the user typed. */
export function visibleLoginProviders(
  providers: ReadonlyArray<OmpLoginProvider>,
  query: string,
): ReadonlyArray<OmpLoginProvider> {
  const needle = query.trim().toLowerCase();
  const matching =
    needle === ""
      ? providers
      : providers.filter(
          (provider) =>
            provider.name.toLowerCase().includes(needle) ||
            provider.providerId.toLowerCase().includes(needle),
        );
  return [
    ...matching.filter((provider) => provider.authenticated),
    ...matching.filter((provider) => !provider.authenticated),
  ];
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

/** Loopback providers ask for the page the browser lands on, which a remote browser cannot load. */
export function promptNeedsRedirectHint(message: string): boolean {
  return /redirect url/i.test(message);
}
