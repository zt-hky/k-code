import { describe, expect, it } from "vite-plus/test";

import { activeSessionPinSelector, pinnedAccount, threadAccountPin } from "./sessionPin";

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

const at = (minute: number) => `2026-11-01T03:${String(minute).padStart(2, "0")}:00.000Z`;
const run = (id: string, model: string, status = "completed") => ({
  id,
  status,
  modelSelection: { model },
});
const user = (minute: number, text: string, runId: string | null) => ({
  role: "user",
  text,
  createdAt: at(minute),
  runId,
});
const reply = (minute: number, runId: string) => ({
  role: "assistant",
  text: "/session pin ignored@x.com",
  createdAt: at(minute),
  runId,
});

describe("activeSessionPinSelector", () => {
  const runs = [
    run("pin", "anthropic/claude"),
    run("prompt", "anthropic/claude", "running"),
    run("usage", "anthropic/claude"),
    run("codex", "openai-codex/gpt"),
  ];

  it("keeps a pin newer than omp's record through slash commands and a prompt still running", () => {
    const messages = [
      user(1, "  /SESSION  pin  B@x.com ", "pin"),
      reply(2, "pin"),
      user(3, "/usage", "usage"),
      user(4, "fix the bug", "prompt"),
      user(5, "check codex", "codex"),
    ];
    expect(activeSessionPinSelector(messages, runs, "anthropic", at(0))).toBe("b@x.com");
    expect(activeSessionPinSelector(messages, runs, "anthropic", undefined)).toBe("b@x.com");
  });

  it("yields to omp's record once it is newer than the pin", () => {
    const messages = [user(1, "/session pin b@x.com", "pin"), user(4, "go", "prompt")];
    expect(activeSessionPinSelector(messages, runs, "anthropic", at(4))).toBeUndefined();
  });

  it("yields once a prompt to the same upstream completes, even if omp recorded nothing", () => {
    const completed = [run("pin", "anthropic/claude"), run("prompt", "anthropic/claude")];
    const messages = [user(1, "/session pin b@x.com", "pin"), user(4, "go", "prompt")];
    expect(activeSessionPinSelector(messages, completed, "anthropic", at(0))).toBeUndefined();
  });

  it("only counts commands and prompts sent with a model of the upstream", () => {
    const messages = [user(1, "/session pin b@x.com", "pin"), user(5, "check codex", "codex")];
    expect(activeSessionPinSelector(messages, runs, "openai-codex", at(0))).toBeUndefined();
    expect(activeSessionPinSelector(messages, runs, null, at(0))).toBeUndefined();
  });
});

describe("pinnedAccount", () => {
  it("prefers the active pin, matched within the upstream by email or account id", () => {
    expect(
      pinnedAccount(accounts, "anthropic", { selector: "b@x.com", credentialPin: "h-a" }),
    ).toBe(accounts[1]);
    expect(
      pinnedAccount(accounts, "anthropic", { selector: "acc-a", credentialPin: undefined }),
    ).toBe(accounts[0]);
    expect(
      pinnedAccount(accounts, "openai-codex", { selector: "b@x.com", credentialPin: undefined }),
    ).toBe(accounts[2]);
  });

  it("falls back to the account omp recorded, only within the upstream", () => {
    expect(pinnedAccount(accounts, "anthropic", { selector: "2", credentialPin: "h-b" })).toBe(
      accounts[1],
    );
    expect(
      pinnedAccount(accounts, "anthropic", { selector: undefined, credentialPin: "h-c" }),
    ).toBeUndefined();
    expect(
      pinnedAccount(accounts, null, { selector: "a@x.com", credentialPin: "h-a" }),
    ).toBeUndefined();
  });
});

describe("threadAccountPin", () => {
  it("reads the record for the upstream", () => {
    const pin = { hash: "h-a", recordedAt: at(1) };
    const thread = { nativeMetadata: { accountPins: { anthropic: pin } } };
    expect(threadAccountPin(thread, "anthropic")).toBe(pin);
    expect(threadAccountPin(thread, "openai-codex")).toBeUndefined();
    expect(threadAccountPin(thread, null)).toBeUndefined();
    expect(threadAccountPin(undefined, "anthropic")).toBeUndefined();
  });
});
