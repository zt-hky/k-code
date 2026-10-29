import { describe, expect, it } from "vite-plus/test";
import { ProviderInstanceId, type OmpLoginProvider, type OmpLoginState } from "@t3tools/contracts";

import { isSignedIn, loginPanel, visibleLoginProviders } from "./OmpModelLoginSection.logic";

const provider = (providerId: string, name: string, authenticated = false): OmpLoginProvider =>
  ({ providerId, name, authenticated }) as OmpLoginProvider;

const state = (patch: Partial<OmpLoginState>): OmpLoginState => ({
  instanceId: ProviderInstanceId.make("omp"),
  phase: "idle",
  flowId: null,
  providerId: null,
  authorizationUrl: null,
  instructions: null,
  progress: null,
  prompt: null,
  message: null,
  ...patch,
});

describe("Oh My Pi model provider sign-in view", () => {
  it("lists signed-in providers first and filters by name or id without reordering within a group", () => {
    const providers = [
      provider("openai-codex", "ChatGPT Plus/Pro"),
      provider("anthropic", "Anthropic (Claude Pro/Max)", true),
      provider("openrouter", "OpenRouter"),
      provider("github-copilot", "GitHub Copilot", true),
    ];
    expect(visibleLoginProviders(providers, "").map((entry) => entry.providerId)).toEqual([
      "anthropic",
      "github-copilot",
      "openai-codex",
      "openrouter",
    ]);
    expect(visibleLoginProviders(providers, " CHATGPT ").map((entry) => entry.providerId)).toEqual([
      "openai-codex",
    ]);
    expect(visibleLoginProviders(providers, "router")).toHaveLength(1);
  });

  it("shows a running sign-in to everyone but replays a finished one only to the client that started it", () => {
    const running = state({ phase: "waiting", flowId: "a" });
    const done = state({ phase: "succeeded", flowId: "a" });
    expect(loginPanel(running, null, null)).toBe("active");
    expect(loginPanel(done, "a", null)).toBe("finished");
    expect(loginPanel(done, "b", null)).toBe("none");
    expect(loginPanel(done, "a", "a")).toBe("none");
    expect(loginPanel(state({ phase: "idle" }), "a", null)).toBe("none");
    expect(loginPanel(null, null, null)).toBe("none");
  });

  it("counts a provider signed in once this client's sign-in succeeded, before the listing is read again", () => {
    const codex = provider("openai-codex", "ChatGPT Plus/Pro");
    const succeeded = state({
      phase: "succeeded",
      flowId: "a",
      providerId: "openai-codex" as never,
    });
    expect(isSignedIn(codex, succeeded, "a")).toBe(true);
    expect(isSignedIn(codex, succeeded, null)).toBe(false);
    expect(isSignedIn(provider("anthropic", "Anthropic"), succeeded, "a")).toBe(false);
  });
});
