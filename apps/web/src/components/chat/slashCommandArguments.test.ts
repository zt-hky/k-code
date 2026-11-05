import { describe, expect, it } from "vite-plus/test";

import {
  parseSlashCommandArgumentOptions,
  searchSlashCommandArgumentOptions,
  slashCommandArgumentChoices,
} from "./slashCommandArguments";

describe("parseSlashCommandArgumentOptions", () => {
  it("reads enumerated choices", () => {
    expect(parseSlashCommandArgumentOptions("[on|off|status]")).toEqual(["on", "off", "status"]);
    expect(parseSlashCommandArgumentOptions("<plan|scan>")).toEqual(["plan", "scan"]);
  });
  it("ignores placeholders", () => {
    expect(parseSlashCommandArgumentOptions("[title]")).toEqual([]);
    expect(parseSlashCommandArgumentOptions(undefined)).toEqual([]);
  });
});

describe("searchSlashCommandArgumentOptions", () => {
  it("prefix filters", () => {
    expect(searchSlashCommandArgumentOptions(["on", "off", "status"], "o")).toEqual(["on", "off"]);
    expect(searchSlashCommandArgumentOptions(["on", "off"], "")).toEqual(["on", "off"]);
  });
});

describe("slashCommandArgumentChoices", () => {
  const mcp = {
    description: "Manage MCP",
    input: { hint: "[list|add]" },
    subcommands: [
      { name: "list", description: "List servers" },
      { name: "add", description: "Add a server", usage: "/mcp add <name>" },
    ],
  };
  it("lists subcommands with usage then description", () => {
    expect(slashCommandArgumentChoices(mcp, "")).toEqual([
      { value: "list", description: "List servers" },
      { value: "add", description: "/mcp add <name> · Add a server" },
    ]);
  });
  it("filters subcommands by the typed query", () => {
    expect(slashCommandArgumentChoices(mcp, "a").map((choice) => choice.value)).toEqual(["add"]);
  });
  it("falls back to the hint enumeration", () => {
    expect(slashCommandArgumentChoices({ input: { hint: "[on|off]" } }, "o")).toEqual([
      { value: "on", description: "[on|off]" },
      { value: "off", description: "[on|off]" },
    ]);
  });
});
