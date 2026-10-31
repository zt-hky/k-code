import { describe, expect, it } from "@effect/vitest";
import {
  AcpRegistryOperationError,
  AcpRegistryProbeResult,
  ProviderInstanceId,
} from "@t3tools/contracts";
import * as Schema from "effect/Schema";

import { OhMyPiSettings } from "../settings.ts";
import { OHMYPI_DEFAULT_INSTANCE_ID } from "./kind.ts";
import {
  buildOhMyPiSnapshot,
  ompModelsFromDiscovery,
  parseOmpVersion,
  signedInModelProviders,
  type OhMyPiSnapshotInput,
} from "./status.ts";

const settings = Schema.decodeSync(OhMyPiSettings)({});
const base = {
  instanceId: OHMYPI_DEFAULT_INSTANCE_ID,
  displayName: undefined,
  accentColor: undefined,
  continuationKey: "ohmypi:instance:ohmypi",
  settings,
  checkedAt: "2026-10-29T12:00:00.000Z",
} satisfies Omit<OhMyPiSnapshotInput, "install">;
const installed = { installed: true, version: "18.13.2" } as const;
const claude = { providerId: "anthropic", name: "Anthropic (Claude Pro/Max)" };
const openrouter = { providerId: "openrouter", name: "OpenRouter" };

const probe = (modelIds: ReadonlyArray<string>) => ({
  probe: AcpRegistryProbeResult.make({
    instanceId: ProviderInstanceId.make("ohmypi"),
    ready: true,
    icon: null,
    authMethods: [],
    models: modelIds.map((id) => ({ id, name: id.split("/").pop() ?? id, description: null })),
    currentModelId: modelIds[0] ?? null,
    configOptions: [
      {
        id: "mode",
        label: "Mode",
        type: "select",
        options: [{ id: "default", label: "Default" }],
      },
      {
        id: "thinking",
        label: "Thinking",
        type: "select",
        options: [{ id: "off", label: "Off" }],
      },
    ],
    sessionManagement: {
      canList: true,
      canLoad: true,
      canResume: true,
      canLogout: false,
      canDelete: false,
      canConfigureProviders: false,
    },
  }),
  slashCommands: [{ name: "model" }],
  skills: [],
});

describe("Oh My Pi snapshot", () => {
  it("is on by default and enabled without any stored settings", () => {
    expect(settings.enabled).toBe(true);
    expect(settings.binaryPath).toBe("omp");
  });

  it("reads the version omp prints", () => {
    expect(parseOmpVersion("omp/18.13.2\n")).toBe("18.13.2");
    expect(parseOmpVersion("nothing")).toBeNull();
  });

  it("reports a missing binary with where to get it, and offers no sign-in", () => {
    const snapshot = buildOhMyPiSnapshot({
      ...base,
      install: { installed: false, detail: "Oh My Pi (`omp`) was not found on PATH." },
    });
    expect(snapshot).toMatchObject({
      driver: "ohmypi",
      installed: false,
      status: "error",
      auth: { status: "unknown" },
      setup: { canAuthenticate: false, documentationUrl: "https://omp.sh" },
    });
    expect(snapshot.message).toContain("https://omp.sh");
  });

  it("asks to sign in when no model provider has a credential", () => {
    const snapshot = buildOhMyPiSnapshot({
      ...base,
      install: installed,
      signedIn: signedInModelProviders([{ ...claude, authenticated: false }]),
    });
    expect(snapshot).toMatchObject({
      installed: true,
      version: "18.13.2",
      status: "error",
      auth: { status: "unauthenticated" },
      modelProviderLogin: true,
      setup: { canAuthenticate: true },
    });
    expect(snapshot.message).toContain("Sign in to a model provider");
  });

  it("does not count a web-search key as a signed-in model provider", () => {
    const signedIn = signedInModelProviders([
      { providerId: "tavily", name: "Tavily", authenticated: true },
      { ...openrouter, authenticated: true },
    ]);
    expect(signedIn.providers.map((provider) => provider.providerId)).toEqual(["openrouter"]);
    expect(
      buildOhMyPiSnapshot({
        ...base,
        install: installed,
        signedIn: signedInModelProviders([
          { providerId: "tavily", name: "Tavily", authenticated: true },
        ]),
      }).auth.status,
    ).toBe("unauthenticated");
  });

  it("is ready, labelled with who is signed in, before discovery finishes", () => {
    const snapshot = buildOhMyPiSnapshot({
      ...base,
      install: installed,
      signedIn: signedInModelProviders([
        { ...claude, authenticated: true },
        { ...openrouter, authenticated: true },
      ]),
    });
    expect(snapshot).toMatchObject({
      status: "ready",
      auth: { status: "authenticated", label: "Anthropic (Claude Pro/Max), OpenRouter" },
      showInteractionModeToggle: true,
    });
  });

  it("keeps auth unknown rather than guessing when sign-ins could not be read", () => {
    expect(buildOhMyPiSnapshot({ ...base, install: installed }).auth.status).toBe("unknown");
  });

  it("offers text generation only for an enabled, installed omp that is not signed out", () => {
    const signedIn = signedInModelProviders([{ ...claude, authenticated: true }]);
    const supports = (input: Parameters<typeof buildOhMyPiSnapshot>[0]) =>
      buildOhMyPiSnapshot(input).supportsTextGeneration;
    expect(supports({ ...base, install: installed, signedIn })).toBe(true);
    expect(supports({ ...base, install: installed })).toBe(true);
    expect(
      supports({
        ...base,
        install: installed,
        signedIn: signedInModelProviders([{ ...claude, authenticated: false }]),
      }),
    ).toBe(false);
    expect(supports({ ...base, install: { installed: false, detail: "missing" } })).toBe(false);
    expect(supports({ ...base, settings: { ...settings, enabled: false } })).toBe(false);
  });

  it("lists discovered models by model provider and leaves plan mode to T3's toggle", () => {
    const snapshot = buildOhMyPiSnapshot({
      ...base,
      install: installed,
      signedIn: signedInModelProviders([{ ...claude, authenticated: true }]),
      probe: probe(["anthropic/claude-opus-5-5", "openrouter/x-ai/grok"]),
    });
    expect(snapshot.status).toBe("ready");
    expect(
      snapshot.models.map((model) => [model.slug, model.subProvider, model.isDefault]),
    ).toEqual([
      ["anthropic/claude-opus-5-5", "anthropic", true],
      ["openrouter/x-ai/grok", "openrouter", undefined],
    ]);
    const options = snapshot.models[0]?.capabilities?.optionDescriptors?.map((option) => option.id);
    expect(options).toEqual(["thinking"]);
    expect(snapshot.nativeSessions).toEqual({
      canList: true,
      canLoad: true,
      canResume: true,
      canDelete: false,
      canListProjects: true,
      canListAllSessions: true,
    });
    expect(snapshot.manageableExtensions).toBe(true);
    expect(snapshot.slashCommands).toEqual([{ name: "model" }]);
  });

  it("treats a discovery with no models as signed out when sign-ins are unknown", () => {
    const snapshot = buildOhMyPiSnapshot({ ...base, install: installed, probe: probe([]) });
    expect(snapshot).toMatchObject({ status: "error", auth: { status: "unauthenticated" } });
    // The UI prints auth.type next to "Not authenticated"; an internal id would leak into it.
    expect(snapshot.auth.type).toBeUndefined();
    expect(snapshot.nativeSessions?.canList).toBe(true);
  });

  it("warns, keeping the signed-in account, when a signed-in omp lists no models", () => {
    const snapshot = buildOhMyPiSnapshot({
      ...base,
      install: installed,
      signedIn: signedInModelProviders([{ ...claude, authenticated: true }]),
      probe: probe([]),
    });
    expect(snapshot).toMatchObject({ status: "warning", auth: { status: "authenticated" } });
  });

  it("warns instead of failing when discovery fails on an installed omp", () => {
    const snapshot = buildOhMyPiSnapshot({
      ...base,
      install: installed,
      signedIn: signedInModelProviders([{ ...claude, authenticated: true }]),
      probeError: new AcpRegistryOperationError({
        reason: "probe_failed",
        message: "The ACP agent could not create a test session.",
      }),
    });
    expect(snapshot).toMatchObject({
      installed: true,
      status: "warning",
      auth: { status: "authenticated" },
      message: "The ACP agent could not create a test session.",
    });
  });

  it("falls back to a Default model when nothing was discovered", () => {
    expect(ompModelsFromDiscovery(undefined, []).map((model) => model.slug)).toEqual(["default"]);
    expect(
      ompModelsFromDiscovery(undefined, ["my-model"]).map((model) => [model.slug, model.isCustom]),
    ).toEqual([
      ["default", false],
      ["my-model", true],
    ]);
  });

  it("shows a disabled provider as disabled", () => {
    const snapshot = buildOhMyPiSnapshot({
      ...base,
      settings: { ...settings, enabled: false },
    });
    expect(snapshot).toMatchObject({ enabled: false, status: "disabled" });
  });
});
