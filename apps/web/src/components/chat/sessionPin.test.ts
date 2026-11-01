import { describe, expect, it } from "vite-plus/test";

import { pendingSessionPinSelectors, pinnedAccount, threadCredentialPin } from "./sessionPin";

const user = (text: string) => ({ role: "user", text });
const accounts = [
  { nativeProvider: "anthropic", email: "a@x.com", nativeAccountId: "acc-a", credentialPin: "h-a" },
  { nativeProvider: "anthropic", email: "b@x.com", nativeAccountId: "acc-b", credentialPin: "h-b" },
  {
    nativeProvider: "openai-codex",
    email: "b@x.com",
    nativeAccountId: "acc-c",
    credentialPin: "h-c",
  },
];

describe("pending session pins", () => {
  it("collects user pin commands newest first until a prompt that reaches a model", () => {
    expect(
      pendingSessionPinSelectors([
        user("/session pin old@x.com"),
        user("fix the bug"),
        user("/session pin A@x.com"),
        { role: "assistant", text: "/session pin ignored@x.com" },
        user("/usage"),
        user("  /SESSION  pin  acc-b "),
        user("/session pin"),
      ]),
    ).toEqual(["acc-b", "a@x.com"]);
  });

  it("is empty once a prompt follows the pin", () => {
    expect(pendingSessionPinSelectors([user("/session pin a@x.com"), user("go")])).toEqual([]);
  });
});

describe("pinnedAccount", () => {
  const none = { pendingSelectors: [], credentialPin: undefined };

  it("prefers a pending pin, matched within the upstream by email or account id", () => {
    expect(
      pinnedAccount(accounts, "anthropic", { pendingSelectors: ["b@x.com"], credentialPin: "h-a" }),
    ).toBe(accounts[1]);
    expect(pinnedAccount(accounts, "anthropic", { ...none, pendingSelectors: ["acc-a"] })).toBe(
      accounts[0],
    );
    expect(
      pinnedAccount(accounts, "openai-codex", { ...none, pendingSelectors: ["b@x.com"] }),
    ).toBe(accounts[2]);
  });

  it("falls back to the account omp recorded, only within the upstream", () => {
    expect(pinnedAccount(accounts, "anthropic", { ...none, credentialPin: "h-b" })).toBe(
      accounts[1],
    );
    expect(pinnedAccount(accounts, "anthropic", { ...none, credentialPin: "h-c" })).toBeUndefined();
  });

  it("skips pending pins that name no account, such as positional ones", () => {
    expect(
      pinnedAccount(accounts, "anthropic", {
        pendingSelectors: ["2", "acc-c"],
        credentialPin: "h-a",
      }),
    ).toBe(accounts[0]);
    expect(pinnedAccount(accounts, null, { ...none, credentialPin: "h-a" })).toBeUndefined();
  });
});

describe("threadCredentialPin", () => {
  it("reads the hash recorded for the upstream", () => {
    const thread = { nativeMetadata: { credentialPins: { anthropic: "h-a" } } };
    expect(threadCredentialPin(thread, "anthropic")).toBe("h-a");
    expect(threadCredentialPin(thread, "openai-codex")).toBeUndefined();
    expect(threadCredentialPin(thread, null)).toBeUndefined();
    expect(threadCredentialPin(undefined, "anthropic")).toBeUndefined();
  });
});
