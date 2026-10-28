import type { OrchestrationV2PlanStep } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { countCompletedSteps, windowTodoSteps } from "./ThreadWorkPanels.logic";

const steps = (statuses: ReadonlyArray<OrchestrationV2PlanStep["status"]>) =>
  statuses.map((status, index) => ({ id: `s${index}`, text: `Step ${index}`, status }));

describe("windowTodoSteps", () => {
  it("shows every step of a short list without offering more", () => {
    const result = windowTodoSteps(steps(["completed", "running", "pending"]), false);
    expect(result.visible).toHaveLength(3);
    expect(result.hasMore).toBe(false);
  });

  it("starts one row before the first unfinished step", () => {
    const list = steps([
      "completed",
      "completed",
      "completed",
      "running",
      "pending",
      "pending",
      "pending",
      "pending",
      "pending",
    ]);
    const result = windowTodoSteps(list, false);
    expect(result.visible.map((step) => step.id)).toEqual(["s2", "s3", "s4", "s5", "s6"]);
    expect(result.hasMore).toBe(true);
  });

  it("starts at the top when the first step is unfinished", () => {
    const result = windowTodoSteps(steps(Array(7).fill("pending")), false);
    expect(result.visible.map((step) => step.id)).toEqual(["s0", "s1", "s2", "s3", "s4"]);
  });

  it("shows the tail of a list that is entirely completed", () => {
    const result = windowTodoSteps(steps(Array(7).fill("completed")), false);
    expect(result.visible.map((step) => step.id)).toEqual(["s2", "s3", "s4", "s5", "s6"]);
  });

  it("returns every step once expanded", () => {
    const result = windowTodoSteps(steps(Array(9).fill("pending")), true);
    expect(result.visible).toHaveLength(9);
    expect(result.hasMore).toBe(false);
  });
});

describe("countCompletedSteps", () => {
  it("counts only completed steps", () => {
    expect(countCompletedSteps(steps(["completed", "running", "pending", "completed"]))).toBe(2);
  });
});
