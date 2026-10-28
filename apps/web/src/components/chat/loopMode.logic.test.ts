import { describe, expect, it } from "vite-plus/test";
import {
  decideLoopAction,
  loopControlLabel,
  loopTitle,
  parseLoopSlashCommand,
  type LoopState,
} from "./loopMode.logic";

const loop = (overrides: Partial<LoopState> = {}): LoopState => ({
  prompt: { text: "check the build", context: undefined },
  remaining: 2,
  iteration: 1,
  lastHandledRunId: "run-0",
  ...overrides,
});

const completed = { id: "run-1", status: "completed" } as const;

describe("decideLoopAction", () => {
  it("resends after a completed run", () => {
    expect(
      decideLoopAction({ loop: loop(), latestRun: completed, hasPendingRequest: false }),
    ).toEqual({ type: "resend" });
  });

  it("finishes once the last run completes", () => {
    expect(
      decideLoopAction({
        loop: loop({ remaining: 0, iteration: 3 }),
        latestRun: completed,
        hasPendingRequest: false,
      }),
    ).toEqual({ type: "finish" });
  });

  it("never finishes when it repeats until stopped", () => {
    expect(
      decideLoopAction({
        loop: loop({ remaining: null, iteration: 40 }),
        latestRun: completed,
        hasPendingRequest: false,
      }),
    ).toEqual({ type: "resend" });
  });

  it.each(["failed", "interrupted", "cancelled"] as const)("disarms when a run is %s", (status) => {
    expect(
      decideLoopAction({
        loop: loop(),
        latestRun: { id: "run-1", status },
        hasPendingRequest: false,
      }),
    ).toEqual({ type: "disarm" });
  });

  it("waits while a run is still in flight", () => {
    for (const status of ["queued", "starting", "running", "waiting"] as const) {
      expect(
        decideLoopAction({
          loop: loop(),
          latestRun: { id: "run-1", status },
          hasPendingRequest: false,
        }),
      ).toEqual({ type: "wait" });
    }
  });

  it("waits while an approval or question is open", () => {
    expect(
      decideLoopAction({ loop: loop(), latestRun: completed, hasPendingRequest: true }),
    ).toEqual({ type: "wait" });
  });

  it("does not act twice for the same run", () => {
    expect(
      decideLoopAction({
        loop: loop({ lastHandledRunId: "run-1" }),
        latestRun: completed,
        hasPendingRequest: false,
      }),
    ).toEqual({ type: "wait" });
  });

  it("waits for the first message before it has a prompt", () => {
    expect(
      decideLoopAction({
        loop: loop({ prompt: null, iteration: 0 }),
        latestRun: completed,
        hasPendingRequest: false,
      }),
    ).toEqual({ type: "wait" });
  });

  it("waits when no loop is armed or no run exists", () => {
    expect(
      decideLoopAction({ loop: null, latestRun: completed, hasPendingRequest: false }),
    ).toEqual({ type: "wait" });
    expect(decideLoopAction({ loop: loop(), latestRun: null, hasPendingRequest: false })).toEqual({
      type: "wait",
    });
  });
});

describe("parseLoopSlashCommand", () => {
  it("reads the bare command as a toggle and a number as the run count", () => {
    expect(parseLoopSlashCommand("/loop")).toEqual({ kind: "toggle" });
    expect(parseLoopSlashCommand(" /LOOP 5 ")).toEqual({ kind: "runs", runs: 5 });
    expect(parseLoopSlashCommand("/loop 0")).toEqual({ kind: "runs", runs: 0 });
  });

  it("leaves a provider's own /loop arguments alone", () => {
    expect(parseLoopSlashCommand("/loop every 5m check the build")).toBeNull();
    expect(parseLoopSlashCommand("/looping")).toBeNull();
  });
});

describe("loop labels", () => {
  it("counts runs for a bounded loop and omits the total otherwise", () => {
    expect(loopTitle({ iteration: 2, remaining: 3 })).toBe("Loop · run 2 of 5");
    expect(loopTitle({ iteration: 2, remaining: null })).toBe("Loop · run 2");
    expect(loopControlLabel({ iteration: 0, remaining: 3 })).toBe("Loop ×3");
    expect(loopControlLabel({ iteration: 4, remaining: null })).toBe("Loop ∞");
  });
});
