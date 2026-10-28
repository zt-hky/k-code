import { describe, expect, it } from "@effect/vitest";

import {
  extractOmpPlanApprovalElicitation,
  extractOmpProposedPlanMarkdown,
  extractOmpSubagentUpdate,
} from "./ompAcp.ts";

const approvalSchema = {
  type: "object",
  properties: { value: { type: "string", enum: ["Approve and execute", "Refine plan"] } },
  required: ["value"],
};

describe("omp plan extraction", () => {
  it("reads the plan from local plan writes and later plan edits", () => {
    expect(
      extractOmpProposedPlanMarkdown({
        toolCallId: "1",
        data: { rawInput: { path: "local://x-plan.md", content: "# Plan" } },
      }),
    ).toBe("# Plan");
    expect(
      extractOmpProposedPlanMarkdown({
        toolCallId: "2",
        data: { rawOutput: { details: { resolvedPath: "/tmp/x-plan.md", newText: "# Plan 2" } } },
      }),
    ).toBe("# Plan 2");
    expect(
      extractOmpProposedPlanMarkdown({
        toolCallId: "3",
        data: { rawInput: { path: "src/index.ts", content: "code" } },
      }),
    ).toBeUndefined();
    expect(
      extractOmpProposedPlanMarkdown({
        toolCallId: "4",
        data: { rawOutput: { details: { path: "src/index.ts", newText: "code" } } },
      }),
    ).toBeUndefined();
  });
});

describe("omp plan approval elicitation", () => {
  const request = (message: string, requestedSchema: unknown = approvalSchema) =>
    ({ mode: "form", sessionId: "s", message, requestedSchema }) as never;

  it("matches the approval form and returns the excerpt without the truncation marker", () => {
    expect(
      extractOmpPlanApprovalElicitation(
        request('Approve plan "Demo" and start implementation?\n# Demo\n- one\n…'),
      ),
    ).toEqual({ excerptMarkdown: "# Demo\n- one" });
  });

  it("ignores other forms", () => {
    expect(extractOmpPlanApprovalElicitation(request("Approve this request?"))).toBeUndefined();
    expect(
      extractOmpPlanApprovalElicitation(
        request('Approve plan "Demo" and start implementation?\nx', {
          type: "object",
          properties: { value: { type: "string", enum: ["Yes", "No"] } },
        }),
      ),
    ).toBeUndefined();
  });
});

describe("omp subagent extraction", () => {
  const tool = (rawInput: unknown, rest: Record<string, unknown> = {}, status = "in_progress") =>
    ({ toolCallId: "t1", status, data: { rawInput, ...rest } }) as never;

  it("treats a running single task as a running subagent", () => {
    expect(
      extractOmpSubagentUpdate(
        tool({ task: "do it", solutionSpace: "one fix", name: "Fixer", agent: "task" }),
      ),
    ).toEqual({
      nativeTaskId: "t1",
      childSessionId: null,
      prompt: "do it",
      title: "Fixer",
      model: null,
      status: "running",
      result: null,
      progress: null,
      reasoningEffort: null,
    });
  });

  it("completes a batch with agent-prefixed results", () => {
    const update = extractOmpSubagentUpdate(
      tool(
        { tasks: [{ task: "x" }, { task: "y" }] },
        {
          rawOutput: {
            details: {
              results: [
                { agent: "a", output: "one", exitCode: 0 },
                { agent: "b", output: "two", exitCode: 0 },
              ],
            },
          },
        },
        "completed",
      ),
    );
    expect(update).toMatchObject({
      status: "completed",
      prompt: "1. x\n2. y",
      title: "2 agents",
      result: "a: one\n\nb: two",
    });
  });

  it("reports the running agent's current tool, model and thinking level", () => {
    const update = extractOmpSubagentUpdate(
      tool(
        { tasks: [{ task: "x" }, { task: "y" }] },
        {
          rawOutput: {
            details: {
              progress: [
                { status: "completed", resolvedModel: "anthropic/done" },
                {
                  status: "running",
                  currentTool: "bash",
                  currentToolArgs: "vp test run",
                  lastIntent: "Running tests",
                  resolvedModel: "anthropic/claude-sonnet-4-5:high",
                  resolvedThinkingLevel: "high",
                },
              ],
            },
          },
        },
      ),
    );
    expect(update).toMatchObject({
      status: "running",
      model: "anthropic/claude-sonnet-4-5",
      reasoningEffort: "high",
      progress: "bash: vp test run",
    });
  });

  it("falls back from current tool to intent to latest output and omits unreported effort", () => {
    const running = (agent: object) =>
      extractOmpSubagentUpdate(
        tool(
          { task: "x", solutionSpace: "s" },
          { rawOutput: { details: { progress: [{ status: "running", ...agent }] } } },
        ),
      );
    expect(running({ lastIntent: "Reading files", recentOutput: ["a"] })?.progress).toBe(
      "Reading files",
    );
    expect(running({ recentOutput: ["newest", "older"] })).toMatchObject({
      progress: "newest",
      reasoningEffort: null,
    });
  });

  it("drops progress once the task finishes", () => {
    const update = extractOmpSubagentUpdate(
      tool(
        { task: "x", solutionSpace: "s" },
        {
          rawOutput: {
            details: {
              progress: [{ status: "running", currentTool: "bash" }],
              results: [{ output: "done", exitCode: 0, resolvedThinkingLevel: "low" }],
            },
          },
        },
        "completed",
      ),
    );
    expect(update).toMatchObject({ progress: null, result: "done", reasoningEffort: "low" });
  });

  it("maps aborted results to cancelled and nonzero exits to failed", () => {
    const output = (result: object) => ({ rawOutput: { details: { results: [result] } } });
    const input = { task: "x", solutionSpace: "s" };
    expect(
      extractOmpSubagentUpdate(tool(input, output({ aborted: true, exitCode: 1 }), "completed"))
        ?.status,
    ).toBe("cancelled");
    expect(
      extractOmpSubagentUpdate(tool(input, output({ exitCode: 1, output: "bad" }), "completed"))
        ?.status,
    ).toBe("failed");
  });

  it("ignores non-task tool input", () => {
    expect(extractOmpSubagentUpdate(tool({ path: "a.ts" }))).toBeUndefined();
    expect(extractOmpSubagentUpdate(tool({ tasks: [{ nope: 1 }] }))).toBeUndefined();
  });
});
