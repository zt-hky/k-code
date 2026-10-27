import { describe, expect, it } from "@effect/vitest";
import { ProviderDriverKind } from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";

import { ompUsageToAccounts } from "./ompUsage.ts";

const fallback = ProviderDriverKind.make("acpRegistry");
const now = DateTime.makeUnsafe("2026-10-27T12:00:00.000Z");

const percent = (usedFraction: number) => ({
  unit: "percent",
  used: usedFraction * 100,
  limit: 100,
  remaining: 100 - usedFraction * 100,
  usedFraction,
  remainingFraction: 1 - usedFraction,
});

const fixture = {
  reports: [
    {
      provider: "google-antigravity",
      fetchedAt: 1793115934939,
      limits: [
        {
          id: "google-antigravity:google:default:gemini-weekly",
          label: "Gemini",
          scope: { provider: "google-antigravity", windowId: "weekly" },
          window: { id: "weekly", label: "Weekly", durationMs: 604800000, resetsAt: 1793415105000 },
          amount: percent(0.0030188),
          status: "ok",
        },
      ],
      metadata: { email: "gem@example.test", projectId: "project" },
    },
    {
      provider: "openai-codex",
      fetchedAt: 1793115934939,
      limits: [
        {
          id: "openai-codex:primary",
          label: "5 hours",
          window: { id: "5h", label: "5 hours", durationMs: 18000000, resetsAt: 1793133936000 },
          amount: percent(0),
        },
        {
          id: "openai-codex:secondary",
          label: "7 days",
          window: { id: "7d", label: "7 days", durationMs: 604800000, resetsAt: 1793613356000 },
          amount: percent(0.04),
        },
      ],
      resetCredits: { availableCount: 1, credits: [] },
      metadata: { planType: "plus", email: "codex@example.test", accountId: "codex-account" },
    },
    {
      provider: "anthropic",
      fetchedAt: 1793115909389,
      limits: [
        {
          id: "anthropic:5h",
          label: "Claude 5 Hour",
          window: { id: "5h", label: "5 Hour", durationMs: 18000000, resetsAt: 1793127600240 },
          amount: percent(0.31),
        },
        {
          id: "anthropic:7d:fable",
          label: "Claude 7 Day (Fable)",
          window: { id: "7d", label: "7 Day", durationMs: 604800000 },
          amount: percent(1.4),
        },
        { id: "anthropic:broken", label: "Broken", amount: {} },
        "not a limit",
      ],
      metadata: { accountId: "claude-account", email: "claude@example.test", orgName: "Org" },
      resetCredits: { availableCount: 0 },
    },
    { provider: "anthropic", limits: [], metadata: { accountId: "claude-account" } },
    { limits: [] },
    "not a report",
  ],
};

describe("ompUsageToAccounts", () => {
  const accounts = ompUsageToAccounts(fixture, fallback, now);

  it("maps each upstream account and skips malformed entries", () => {
    expect(accounts.map(({ id, driver, nativeProvider }) => [id, driver, nativeProvider])).toEqual([
      ["google-antigravity:gem@example.test", "antigravity", "google-antigravity"],
      ["openai-codex:codex-account", "codex", "openai-codex"],
      ["anthropic:claude-account", "claudeAgent", "anthropic"],
      ["anthropic:claude-account#1", "claudeAgent", "anthropic"],
    ]);
  });

  it("maps window kinds, labels, percentages and reset times", () => {
    expect(accounts[0]?.usageLimits.windows).toEqual([
      {
        id: "google-antigravity:google:default:gemini-weekly",
        kind: "weekly",
        label: "Gemini · Weekly",
        usedPercent: expect.closeTo(0.30188, 5),
        resetsAt: "2026-10-31T02:51:45.000Z",
        windowDurationMins: 10080,
      },
    ]);
    expect(
      accounts[1]?.usageLimits.windows.map((w) => [w.kind, w.label, w.windowDurationMins]),
    ).toEqual([
      ["session", "5 hours", 300],
      ["weekly", "7 days", 10080],
    ]);
    expect(accounts[2]?.usageLimits.windows).toMatchObject([
      { id: "anthropic:5h", kind: "session", label: "Claude 5 Hour" },
      { id: "anthropic:7d:fable", kind: "weekly", label: "Claude 7 Day (Fable)", usedPercent: 100 },
    ]);
    expect(accounts[2]?.usageLimits.windows[1]).not.toHaveProperty("resetsAt");
  });

  it("carries identity, plan, credits and fetch time", () => {
    expect(accounts[1]).toMatchObject({
      email: "codex@example.test",
      nativeAccountId: "codex-account",
      nativeProviderLabel: "Codex",
      plan: "plus",
      usageLimits: {
        checkedAt: "2026-10-27T15:45:34.939Z",
        resetCredits: { availableCount: 1 },
      },
    });
    expect(accounts[2]).toMatchObject({ plan: "Org" });
    expect(accounts[2]?.usageLimits.resetCredits).toBeUndefined();
    expect(accounts[3]?.usageLimits.checkedAt).toBe("2026-10-27T12:00:00.000Z");
  });

  it("uses the hub's own driver for unknown upstreams and ignores a malformed response", () => {
    const [unknown] = ompUsageToAccounts(
      { reports: [{ provider: "other-llm", limits: [] }] },
      fallback,
      now,
    );
    expect(unknown).toMatchObject({ id: "other-llm:default", driver: "acpRegistry" });
    expect(ompUsageToAccounts({ reports: "nope" }, fallback, now)).toEqual([]);
    expect(ompUsageToAccounts(null, fallback, now)).toEqual([]);
  });
});
