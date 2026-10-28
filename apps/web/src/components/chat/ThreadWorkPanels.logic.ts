import { isTerminalSubagentStatus } from "@t3tools/client-runtime/state/subagentRuntime";
import type { OrchestrationV2PlanStep, OrchestrationV2Subagent } from "@t3tools/contracts";

const TODO_WINDOW_SIZE = 5;

export function countCompletedSteps(steps: ReadonlyArray<OrchestrationV2PlanStep>): number {
  return steps.filter((step) => step.status === "completed").length;
}

/** Starts one row before the first unfinished step, so the step just done stays in view. */
export function windowTodoSteps(
  steps: ReadonlyArray<OrchestrationV2PlanStep>,
  expanded: boolean,
): { readonly visible: ReadonlyArray<OrchestrationV2PlanStep>; readonly hasMore: boolean } {
  if (expanded) return { visible: steps, hasMore: false };
  const firstOpen = steps.findIndex((step) => step.status !== "completed");
  const start = firstOpen === -1 ? Math.max(0, steps.length - TODO_WINDOW_SIZE) : firstOpen - 1;
  const visible = steps.slice(Math.max(0, start), Math.max(0, start) + TODO_WINDOW_SIZE);
  return { visible, hasMore: visible.length < steps.length };
}

/** Working and idle agents lead; settled ones follow in their own group. */
export function splitSubagentsByState(subagents: ReadonlyArray<OrchestrationV2Subagent>): {
  readonly active: ReadonlyArray<OrchestrationV2Subagent>;
  readonly settled: ReadonlyArray<OrchestrationV2Subagent>;
} {
  return {
    active: subagents.filter((subagent) => !isTerminalSubagentStatus(subagent.status)),
    settled: subagents.filter((subagent) => isTerminalSubagentStatus(subagent.status)),
  };
}
