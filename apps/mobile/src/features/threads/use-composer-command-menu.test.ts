import { describe, expect, it, vi } from "vite-plus/test";
import { ProviderDriverKind } from "@t3tools/contracts";

vi.mock("react-native", () => ({ Alert: { alert: vi.fn() } }));

vi.mock("../../state/queries", () => ({
  useComposerPathSearch: () => ({ entries: [], isPending: false }),
  useComposerPullRequestSearch: () => ({ entries: [], isPending: false, error: null }),
}));
vi.mock("../../state/use-composer-drafts", () => ({
  getComposerDraftSnapshot: vi.fn(),
  setComposerDraftContext: vi.fn(),
  useComposerDraftSelection: vi.fn(),
}));
vi.mock("../../lib/uuid", () => ({ uuidv4: () => "context-id" }));
vi.mock("../../state/server", () => ({
  serverEnvironment: {
    providersValueAtom: vi.fn(),
    refreshProviders: Symbol("refreshProviders"),
  },
}));

import {
  buildComposerSlashCommandItems,
  buildComposerSlashSubcommandItems,
  detectComposerSlashSubcommandTrigger,
  resolveComposerCommandSelection,
  resolveComposerMenuSelection,
} from "./use-composer-command-menu";

describe("resolveComposerMenuSelection", () => {
  it("prefers the caret an insertion placed in the current draft text", () => {
    expect(
      resolveComposerMenuSelection({
        draftMessage: "hello @chip ",
        ownerKey: "draft-a",
        inserted: { start: 12, end: 12 },
        local: { ownerKey: "draft-a", start: 2, end: 2 },
      }),
    ).toEqual({ start: 12, end: 12 });
  });

  it("clamps the composer's own caret when the draft shrinks", () => {
    expect(
      resolveComposerMenuSelection({
        draftMessage: "hi",
        ownerKey: "draft-a",
        inserted: null,
        local: { ownerKey: "draft-a", start: 5, end: 9 },
      }),
    ).toEqual({ start: 2, end: 2 });
  });

  it("starts at the end of the draft after switching owners", () => {
    expect(
      resolveComposerMenuSelection({
        draftMessage: "other draft",
        ownerKey: "draft-b",
        inserted: null,
        local: { ownerKey: "draft-a", start: 1, end: 1 },
      }),
    ).toEqual({ start: 11, end: 11 });
  });
});

describe("mobile slash commands", () => {
  const antigravity = {
    driver: ProviderDriverKind.make("antigravity"),
    showInteractionModeToggle: false,
    slashCommands: [{ name: "plan", description: "Plan with Antigravity" }],
  };

  it.each([false, true])(
    "keeps native /plan with legacy mode enabled=%s",
    (allowInteractionMode) => {
      const items = buildComposerSlashCommandItems({
        query: "pl",
        atMessageStart: true,
        hasThread: true,
        allowInteractionMode,
        selectedProviderStatus: antigravity,
      });

      expect(items).toHaveLength(1);
      expect(items[0]?.type).toBe("provider-slash-command");
      const item = items[0];
      if (!item) throw new Error("Expected the native plan command");
      expect(
        resolveComposerCommandSelection({
          draftMessage: "/pl",
          trigger: { rangeStart: 0, rangeEnd: 3 },
          item,
          allowInteractionMode,
        }),
      ).toEqual({ text: "/plan ", cursor: 6, interactionMode: null });
    },
  );

  it("still applies the T3 plan command for supported providers", () => {
    const items = buildComposerSlashCommandItems({
      query: "plan",
      atMessageStart: true,
      hasThread: true,
      allowInteractionMode: true,
      selectedProviderStatus: {
        driver: ProviderDriverKind.make("codex"),
        slashCommands: [],
      },
    });
    const item = items[0];
    if (!item) throw new Error("Expected the T3 plan command");
    expect(
      resolveComposerCommandSelection({
        draftMessage: "/plan",
        trigger: { rangeStart: 0, rangeEnd: 5 },
        item,
        allowInteractionMode: true,
      }),
    ).toEqual({ text: "", cursor: 0, interactionMode: "plan" });

    expect(
      resolveComposerCommandSelection({
        draftMessage: "/plan",
        trigger: { rangeStart: 0, rangeEnd: 5 },
        item,
        allowInteractionMode: false,
      }),
    ).toEqual({ text: "/plan ", cursor: 6, interactionMode: null });
  });
});

describe("mobile slash subcommands", () => {
  const slashCommands = [
    {
      name: "mcp",
      subcommands: [
        { name: "add", description: "Add a server", usage: "/mcp add <name>" },
        { name: "list", description: "List servers" },
        { name: "enable" },
      ],
    },
    { name: "compact" },
  ];

  it("offers matching subcommands for `/mcp a` and replaces only the partial", () => {
    const draftMessage = "/mcp a";
    const trigger = detectComposerSlashSubcommandTrigger(
      draftMessage,
      draftMessage.length,
      slashCommands,
    );
    if (trigger?.kind !== "slash-subcommand") throw new Error("Expected a subcommand trigger");
    expect(trigger).toMatchObject({ command: "mcp", query: "a", rangeStart: 5, rangeEnd: 6 });

    const items = buildComposerSlashSubcommandItems({
      command: trigger.command,
      query: trigger.query,
      slashCommands,
    });
    expect(items.map((item) => item.label)).toEqual(["add"]);
    expect(items[0]?.description).toBe("/mcp add <name> · Add a server");

    const item = items[0];
    if (!item) throw new Error("Expected the add subcommand");
    expect(
      resolveComposerCommandSelection({
        draftMessage,
        trigger,
        item,
        allowInteractionMode: false,
      }),
    ).toEqual({ text: "/mcp add ", cursor: 9, interactionMode: null });
  });

  it("lists every subcommand for an empty partial and ignores commands without any", () => {
    expect(
      buildComposerSlashSubcommandItems({ command: "mcp", query: "", slashCommands }),
    ).toHaveLength(3);
    expect(detectComposerSlashSubcommandTrigger("/compact ", 9, slashCommands)).toBeNull();
    expect(detectComposerSlashSubcommandTrigger("hi /mcp a", 9, slashCommands)).toBeNull();
  });
});
