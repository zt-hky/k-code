import {
  NodeId,
  PlanId,
  ProviderDriverKind,
  ProviderInstanceId,
  RunId,
  ThreadId,
  type OrchestrationV2PlanStep,
  type OrchestrationV2Subagent,
} from "@t3tools/contracts";
import { deriveThreadTurnSubagents } from "@t3tools/client-runtime/state/thread-subagents";
import * as DateTime from "effect/DateTime";
import { expect, it, vi } from "vite-plus/test";
import { page } from "vite-plus/test/browser";

import "~/index.css";

import { render } from "../../../test/render";
import { ThreadWorkPanels } from "./ThreadWorkPanels";

const todoList = (statuses: ReadonlyArray<OrchestrationV2PlanStep["status"]>) => ({
  planId: PlanId.make("plan-1"),
  runId: RunId.make("run-1"),
  explanation: undefined,
  steps: statuses.map((status, index) => ({ id: `s${index}`, text: `Step ${index + 1}`, status })),
});

function subagent(
  overrides: Pick<OrchestrationV2Subagent, "title" | "status"> & Partial<OrchestrationV2Subagent>,
): OrchestrationV2Subagent {
  return {
    id: NodeId.make(`agent-${overrides.title}`),
    threadId: ThreadId.make("thread-1"),
    runId: RunId.make("run-1"),
    parentNodeId: NodeId.make("node-1"),
    origin: "app_owned",
    createdBy: "agent",
    driver: ProviderDriverKind.make("codex"),
    providerInstanceId: ProviderInstanceId.make("codex"),
    providerThreadId: null,
    childThreadId: ThreadId.make(`child-${overrides.title}`),
    nativeTaskRef: null,
    prompt: "Do the thing",
    model: null,
    result: null,
    startedAt: DateTime.makeUnsafe("2026-06-20T00:00:00.000Z"),
    completedAt: null,
    updatedAt: DateTime.makeUnsafe("2026-06-20T00:00:01.000Z"),
    ...overrides,
  };
}

const turn = deriveThreadTurnSubagents({
  runs: [{ id: RunId.make("run-1"), status: "running" }] as never,
  subagents: [
    subagent({
      title: "Explorer",
      status: "running",
      progress: "bash: vp test run apps/web",
      model: "gpt-5.5",
      modelSelection: {
        instanceId: ProviderInstanceId.make("codex"),
        model: "gpt-5.5",
        options: [{ id: "reasoningEffort", value: "high" }],
      },
    }),
    subagent({ title: "Reviewer", status: "completed", result: "Looks fine", model: "gpt-5.4" }),
    subagent({ title: "Builder", status: "failed", result: "Build broke" }),
  ],
});

it("shows task progress and every task of a short list", async () => {
  await using screen = await render(
    <ThreadWorkPanels
      todoList={todoList(["completed", "running", "pending"])}
      subagents={null}
      onOpenSubagent={() => {}}
    />,
  );

  await expect.element(screen.getByText("1/3 complete")).toBeVisible();
  await expect.element(screen.getByText("Step 1")).toBeVisible();
  await expect.element(screen.getByText("Step 3")).toBeVisible();
  expect(screen.container.textContent).not.toContain("Show all tasks");
});

it("windows a long task list and expands it on request", async () => {
  await using screen = await render(
    <ThreadWorkPanels
      todoList={todoList([
        "completed",
        "completed",
        "running",
        "pending",
        "pending",
        "pending",
        "pending",
      ])}
      subagents={null}
      onOpenSubagent={() => {}}
    />,
  );

  await expect.element(screen.getByText("2/7 complete")).toBeVisible();
  expect(screen.container.textContent).not.toContain("Step 1");
  await expect.element(screen.getByText("Step 2")).toBeVisible();
  await expect.element(screen.getByText("Step 6")).toBeVisible();
  expect(screen.container.textContent).not.toContain("Step 7");

  await screen.getByRole("button", { name: "Show all tasks" }).click();
  await expect.element(screen.getByText("Step 1")).toBeVisible();
  await expect.element(screen.getByText("Step 7")).toBeVisible();
});

it("lists working subagents, keeps settled ones collapsed, and opens a child thread", async () => {
  const onOpenSubagent = vi.fn();
  await using screen = await render(
    <ThreadWorkPanels todoList={null} subagents={turn} onOpenSubagent={onOpenSubagent} />,
  );

  await expect.element(screen.getByText("1/3")).toBeVisible();
  await expect.element(screen.getByText("Explorer")).toBeVisible();
  await expect.element(screen.getByText(/GPT-5\.5/)).toBeVisible();
  await expect.element(screen.getByText(/high/)).toBeVisible();
  await expect.element(screen.getByText("bash: vp test run apps/web")).toBeVisible();
  expect(screen.container.textContent).not.toContain("Reviewer");

  await page.getByRole("button", { name: "Completed (2)" }).click();
  await expect.element(screen.getByText("Reviewer")).toBeVisible();
  await expect.element(screen.getByText(/GPT-5\.4/)).toBeVisible();
  await expect.element(screen.getByText("Looks fine")).toBeVisible();
  await expect.element(screen.getByText("Builder")).toBeVisible();

  await screen.getByRole("button", { name: "Open Explorer" }).click();
  expect(onOpenSubagent).toHaveBeenCalledExactlyOnceWith("child-Explorer");
});

it("renders nothing when there is neither a task list nor visible subagents", async () => {
  await using screen = await render(
    <ThreadWorkPanels todoList={null} subagents={null} onOpenSubagent={() => {}} />,
  );

  expect(screen.container.textContent).toBe("");
});
