import { describe, expect, it } from "vite-plus/test";

import { pinnedAccount, sessionPinSelectors } from "./sessionPin";

const user = (text: string) => ({ role: "user", text });
const accounts = [
  { nativeProvider: "anthropic", email: "a@x.com", nativeAccountId: "acc-a" },
  { nativeProvider: "anthropic", email: "b@x.com", nativeAccountId: "acc-b" },
  { nativeProvider: "openai-codex", email: "b@x.com", nativeAccountId: "acc-c" },
];

describe("thread session pin", () => {
  it("collects only user pin commands, newest first, case-insensitively", () => {
    expect(
      sessionPinSelectors([
        user("/session pin A@x.com"),
        { role: "assistant", text: "/session pin ignored@x.com" },
        user("fix the bug"),
        user("  /SESSION  pin  acc-b "),
        user("/session pin"),
      ]),
    ).toEqual(["acc-b", "a@x.com"]);
  });

  it("resolves the newest pin within the model's upstream, by email or account id", () => {
    expect(pinnedAccount(["b@x.com", "a@x.com"], accounts, "anthropic")).toBe(accounts[1]);
    expect(pinnedAccount(["acc-a"], accounts, "anthropic")).toBe(accounts[0]);
    expect(pinnedAccount(["b@x.com"], accounts, "openai-codex")).toBe(accounts[2]);
  });

  it("skips pins that name no account of the upstream, such as positional ones", () => {
    expect(pinnedAccount(["2", "acc-c", "a@x.com"], accounts, "anthropic")).toBe(accounts[0]);
    expect(pinnedAccount(["2"], accounts, "anthropic")).toBeUndefined();
    expect(pinnedAccount(["a@x.com"], accounts, null)).toBeUndefined();
  });
});
