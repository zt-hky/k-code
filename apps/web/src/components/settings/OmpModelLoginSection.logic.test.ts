import { describe, expect, it } from "vite-plus/test";
import { ProviderInstanceId, type OmpLoginProvider, type OmpLoginState } from "@t3tools/contracts";

import {
  authorizationHost,
  authorizationUrlToOpen,
  canSubmitPrompt,
  groupLoginProviders,
  isSignedIn,
  loginFlowStep,
  loginPanel,
  needsRefreshAfterSignIn,
} from "./OmpModelLoginSection.logic";

const provider = (providerId: string, name: string, authenticated = false): OmpLoginProvider =>
  ({ providerId, name, authenticated }) as OmpLoginProvider;

const state = (patch: Partial<OmpLoginState>): OmpLoginState => ({
  instanceId: ProviderInstanceId.make("ohmypi"),
  phase: "idle",
  flowId: null,
  providerId: null,
  kind: null,
  authorizationUrl: null,
  userCode: null,
  instructions: null,
  progress: null,
  prompt: null,
  message: null,
  ...patch,
});

const prompt = (message: string, secret = false) =>
  ({ id: "p1", message, secret }) as NonNullable<OmpLoginState["prompt"]>;

describe("Oh My Pi model provider sign-in view", () => {
  it("offers popular providers in their fixed order and keeps the rest behind search", () => {
    const providers = [
      provider("zai", "Z.ai"),
      provider("deepseek", "DeepSeek"),
      provider("anthropic", "Anthropic (Claude Pro/Max)", true),
      provider("kagi", "Kagi"),
      provider("openrouter", "OpenRouter"),
      provider("openai-codex", "ChatGPT Plus/Pro"),
    ];
    const ids = (list: ReadonlyArray<OmpLoginProvider>) => list.map((entry) => entry.providerId);

    const collapsed = groupLoginProviders(providers, "", false);
    expect(ids(collapsed.popular)).toEqual(["anthropic", "openai-codex", "openrouter", "deepseek"]);
    expect(collapsed.others).toEqual([]);
    expect(collapsed.hiddenCount).toBe(2);

    expect(ids(groupLoginProviders(providers, "", true).others)).toEqual(["kagi", "zai"]);
    const searched = groupLoginProviders(providers, " KAGI ", false);
    expect(ids(searched.others)).toEqual(["kagi"]);
    expect(searched.popular).toEqual([]);
    expect(ids(groupLoginProviders(providers, "chatgpt", false).popular)).toEqual(["openai-codex"]);
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

  it("classifies the step from the flow kind, or from a prompt that arrives before one", () => {
    expect(loginFlowStep(state({ phase: "starting" }))).toBe("starting");
    expect(
      loginFlowStep(state({ phase: "waiting", prompt: prompt("GitHub Enterprise URL") })),
    ).toBe("prompt");
    expect(loginFlowStep(state({ phase: "waiting", kind: "device_code" }))).toBe("device_code");
    expect(loginFlowStep(state({ phase: "waiting", kind: "oauth", prompt: prompt("Paste") }))).toBe(
      "oauth",
    );
  });

  it("opens the sign-in page once per flow, only for the client that started it and never for API keys", () => {
    const oauth = state({
      phase: "waiting",
      flowId: "a",
      kind: "oauth",
      authorizationUrl: "https://example.com/auth",
    });
    expect(authorizationUrlToOpen(oauth, "a", null)).toBe("https://example.com/auth");
    expect(authorizationUrlToOpen(oauth, "a", "a")).toBeNull();
    expect(authorizationUrlToOpen(oauth, "b", null)).toBeNull();
    expect(authorizationUrlToOpen({ ...oauth, kind: "device_code" }, "a", null)).not.toBeNull();
    expect(authorizationUrlToOpen({ ...oauth, kind: "api_key" }, "a", null)).toBeNull();
    expect(authorizationUrlToOpen({ ...oauth, kind: null }, "a", null)).toBeNull();
    expect(authorizationUrlToOpen({ ...oauth, phase: "succeeded" }, "a", null)).toBeNull();
    expect(authorizationUrlToOpen(null, "a", null)).toBeNull();
  });

  it("lets an optional prompt be submitted empty but requires a value otherwise", () => {
    const enterprise = prompt("GitHub Enterprise URL/domain (blank for github.com)");
    expect(canSubmitPrompt(enterprise, "")).toBe(true);
    expect(canSubmitPrompt(prompt("Name (optional)"), "  ")).toBe(true);
    expect(canSubmitPrompt(prompt("Paste your DeepSeek API key (sk-...)", true), "  ")).toBe(false);
    expect(canSubmitPrompt(prompt("Paste your DeepSeek API key (sk-...)", true), "sk-1")).toBe(
      true,
    );
  });

  it("refreshes provider status once for a sign-in this client finished", () => {
    const done = state({ phase: "succeeded", flowId: "a" });
    expect(needsRefreshAfterSignIn(done, "a", null)).toBe(true);
    expect(needsRefreshAfterSignIn(done, "a", "a")).toBe(false);
    expect(needsRefreshAfterSignIn(done, "b", null)).toBe(false);
    expect(needsRefreshAfterSignIn(state({ phase: "failed", flowId: "a" }), "a", null)).toBe(false);
  });

  it("names the host of an authorization page", () => {
    expect(authorizationHost("https://github.com/login/device")).toBe("github.com");
    expect(authorizationHost("not a url")).toBeNull();
  });
});
