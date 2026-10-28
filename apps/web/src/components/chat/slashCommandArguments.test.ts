import { describe, expect, it } from "vite-plus/test";

import {
  parseSlashCommandArgumentOptions,
  searchSlashCommandArgumentOptions,
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
