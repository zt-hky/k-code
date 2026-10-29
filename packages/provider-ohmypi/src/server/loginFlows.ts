import type { OmpLoginProvider, OmpLoginProviderFlow } from "@t3tools/contracts";

/**
 * How each subscription sign-in reaches the user, recorded from `omp login <id>` (omp 18.13.2).
 * API-key services are absent: the flow itself tells clients. `localhost_redirect` needs the
 * redirect to reach the machine running omp, a desktop app to catch it, or a pasted address.
 */
const FLOWS: Readonly<
  Record<string, { readonly flow: OmpLoginProviderFlow; readonly variantOf?: string }>
> = {
  "openai-codex": { flow: "localhost_redirect" },
  // Same ChatGPT account as `openai-codex`, through a device code.
  "openai-codex-device": { flow: "device_code", variantOf: "openai-codex" },
  anthropic: { flow: "localhost_redirect" },
  "google-antigravity": { flow: "localhost_redirect" },
  "google-gemini-cli": { flow: "localhost_redirect" },
  devin: { flow: "localhost_redirect" },
  "gitlab-duo": { flow: "localhost_redirect" },
  stencil: { flow: "localhost_redirect" },
  openrouter: { flow: "localhost_redirect" },
  "zai-coding-plan": { flow: "app_redirect" },
  "gitlab-duo-agent": { flow: "app_redirect" },
  cursor: { flow: "browser_poll" },
  "github-copilot": { flow: "device_code" },
  "kimi-code": { flow: "device_code" },
  "xai-oauth": { flow: "device_code" },
  "factory-droid": { flow: "device_code" },
  "muse-code": { flow: "device_code" },
  kilo: { flow: "device_code" },
};

/** The provider with what is known about how its sign-in works. */
export function withLoginFlow(provider: OmpLoginProvider): OmpLoginProvider {
  const known = FLOWS[provider.providerId];
  return known === undefined
    ? provider
    : {
        ...provider,
        flow: known.flow,
        ...(known.variantOf === undefined
          ? {}
          : { variantOf: known.variantOf as OmpLoginProvider["providerId"] }),
      };
}
