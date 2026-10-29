import { describe, expect, it } from "vite-plus/test";
import { ProviderInstanceId, type OmpLoginProvider, type OmpLoginState } from "@t3tools/contracts";

import {
  authorizationHost,
  authorizationUrlToOpen,
  bridgeDeliveryTarget,
  canSubmitPrompt,
  chooseLoginWay,
  groupLoginProviders,
  importedProviderNames,
  isServiceSignedIn,
  isSignedIn,
  localhostBridgeUrl,
  loginFlowStep,
  loginLocality,
  loginPanel,
  needsRefreshAfterSignIn,
  signOutWays,
} from "./OmpModelLoginSection.logic";

const provider = (
  providerId: string,
  name: string,
  authenticated = false,
  extra: Partial<OmpLoginProvider> = {},
): OmpLoginProvider => ({ providerId, name, authenticated, ...extra }) as OmpLoginProvider;

const CODEX = provider("openai-codex", "ChatGPT Plus/Pro (Codex Subscription)", false, {
  flow: "localhost_redirect",
});
const CODEX_DEVICE = provider(
  "openai-codex-device",
  "ChatGPT Plus/Pro (Codex, headless/device)",
  false,
  {
    flow: "device_code",
    variantOf: "openai-codex" as never,
  },
);
const ANTHROPIC = provider("anthropic", "Anthropic (Claude Pro/Max)", false, {
  flow: "localhost_redirect",
});

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

describe("choosing how to sign in", () => {
  const providers = [CODEX, CODEX_DEVICE, ANTHROPIC];

  it("leads with the device code when the browser is not on the server's machine", () => {
    const remote = chooseLoginWay(CODEX, providers, "remote");
    expect(remote.primary.providerId).toBe("openai-codex-device");
    expect(remote.others.map((way) => way.providerId)).toEqual(["openai-codex"]);
  });

  it("keeps the localhost sign-in primary on the same machine, with the device code as the alternative", () => {
    const local = chooseLoginWay(CODEX, providers, "same_machine");
    expect(local.primary.providerId).toBe("openai-codex");
    expect(local.others.map((way) => way.providerId)).toEqual(["openai-codex-device"]);
  });

  it("has nothing else to offer a service with a single way, remote or not", () => {
    expect(chooseLoginWay(ANTHROPIC, providers, "remote")).toEqual({
      primary: ANTHROPIC,
      others: [],
    });
    const copilot = provider("github-copilot", "GitHub Copilot", false, { flow: "device_code" });
    expect(chooseLoginWay(copilot, [copilot], "remote").primary).toBe(copilot);
    expect(chooseLoginWay(copilot, [copilot], "same_machine").primary).toBe(copilot);
  });

  it("lists a service once, with its variants folded in, and searches them by name", () => {
    const ids = (list: ReadonlyArray<OmpLoginProvider>) => list.map((entry) => entry.providerId);
    expect(ids(groupLoginProviders(providers, "", false).popular)).toEqual([
      "anthropic",
      "openai-codex",
    ]);
    expect(ids(groupLoginProviders(providers, "headless", false).popular)).toEqual([
      "openai-codex",
    ]);
    // A variant whose service is not offered stands alone.
    expect(ids(groupLoginProviders([CODEX_DEVICE], "", true).others)).toEqual([
      "openai-codex-device",
    ]);
  });

  it("counts a service signed in through any way and signs out of the ones that are", () => {
    const signedInDevice = { ...CODEX_DEVICE, authenticated: true };
    const all = [CODEX, signedInDevice];
    expect(isServiceSignedIn(CODEX, all, null, null)).toBe(true);
    expect(signOutWays(CODEX, all, null, null).map((way) => way.providerId)).toEqual([
      "openai-codex-device",
    ]);
    expect(signOutWays(CODEX, [CODEX, CODEX_DEVICE], null, null)).toEqual([CODEX]);
  });
});

describe("where the browser is", () => {
  const base = { targetTag: "PrimaryConnectionTarget", hasDesktopBridge: false };

  it("is the server's machine only over loopback from a loopback browser or the desktop app", () => {
    const local = { ...base, httpBaseUrl: "http://127.0.0.1:13773", browserHostname: "localhost" };
    expect(loginLocality(local)).toBe("same_machine");
    expect(
      loginLocality({ ...local, browserHostname: "agentbox.example.com", hasDesktopBridge: true }),
    ).toBe("same_machine");
    expect(loginLocality({ ...local, browserHostname: "agentbox.example.com" })).toBe("remote");
  });

  it("is remote for any other server address, SSH route or relay", () => {
    const loopbackBrowser = { ...base, browserHostname: "localhost" };
    expect(loginLocality({ ...loopbackBrowser, httpBaseUrl: "https://box.example.com" })).toBe(
      "remote",
    );
    expect(loginLocality({ ...loopbackBrowser, httpBaseUrl: null })).toBe("remote");
    expect(
      loginLocality({
        ...loopbackBrowser,
        targetTag: "SshConnectionTarget",
        httpBaseUrl: "http://127.0.0.1:50000",
      }),
    ).toBe("remote");
    expect(
      loginLocality({
        ...loopbackBrowser,
        targetTag: "RelayConnectionTarget",
        httpBaseUrl: "http://localhost:1",
      }),
    ).toBe("remote");
  });
});

describe("the desktop localhost bridge", () => {
  const authorizationUrl = `https://claude.ai/oauth/authorize?redirect_uri=${encodeURIComponent(
    "http://localhost:54545/callback",
  )}&state=0123456789abcdef`;
  const waiting = state({
    phase: "waiting",
    flowId: "a",
    kind: "oauth",
    authorizationUrl,
    prompt: prompt("Paste the authorization code"),
  });

  it("listens only for this client's own running sign-in with a localhost redirect, from a remote server", () => {
    expect(localhostBridgeUrl(waiting, "a", "remote", true)).toBe(authorizationUrl);
    expect(localhostBridgeUrl(waiting, "a", "same_machine", true)).toBeNull();
    expect(localhostBridgeUrl(waiting, "a", "remote", false)).toBeNull();
    expect(localhostBridgeUrl(waiting, "b", "remote", true)).toBeNull();
    expect(localhostBridgeUrl({ ...waiting, phase: "succeeded" }, "a", "remote", true)).toBeNull();
    expect(localhostBridgeUrl({ ...waiting, kind: "device_code" }, "a", "remote", true)).toBeNull();
    expect(
      localhostBridgeUrl(
        { ...waiting, authorizationUrl: "https://example.com/auth?x=1" },
        "a",
        "remote",
        true,
      ),
    ).toBeNull();
  });

  it("answers the prompt omp is asking once the redirect was caught", () => {
    expect(bridgeDeliveryTarget(waiting, { flowId: "a" })).toEqual({ flowId: "a", promptId: "p1" });
    expect(bridgeDeliveryTarget({ ...waiting, prompt: null }, { flowId: "a" })).toBeNull();
    expect(bridgeDeliveryTarget(waiting, { flowId: "other" })).toBeNull();
    expect(bridgeDeliveryTarget(waiting, null)).toBeNull();
  });
});

describe("importing local sign-ins", () => {
  it("names the providers a copy would carry, falling back to their ids", () => {
    expect(
      importedProviderNames(
        ["anthropic", "mystery"],
        [provider("anthropic", "Anthropic (Claude)")],
      ),
    ).toEqual(["Anthropic (Claude)", "mystery"]);
  });
});
