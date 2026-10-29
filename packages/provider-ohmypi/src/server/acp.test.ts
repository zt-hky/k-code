import * as NodeServices from "@effect/platform-node/NodeServices";
import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";

import {
  extractOmpPlanApprovalElicitation,
  extractOmpProposedPlanMarkdown,
  extractOmpSubagentUpdate,
  makeOmpSubagentTranscriptReader,
} from "./acp.ts";

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

describe("omp subagent transcripts", () => {
  it.effect("reads each child's session incrementally and holds back a partial line", () =>
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const agentDir = yield* fileSystem.makeTempDirectoryScoped({ prefix: "t3-omp-transcript-" });
      const sessionDir = path.join(agentDir, "sessions", "-repo", "2026-01-01T00-00-00-000Z_s1");
      yield* fileSystem.makeDirectory(sessionDir, { recursive: true });
      const file = path.join(sessionDir, "Scout.jsonl");
      const line = (message: object) =>
        `${JSON.stringify({ type: "message", id: "l1", message })}\n`;
      const assistant = line({
        role: "assistant",
        content: [
          { type: "thinking", thinking: "look first" },
          { type: "toolCall", id: "c1", name: "grep", intent: "Finding x", arguments: { p: "x" } },
        ],
      });
      const result = line({ role: "toolResult", toolCallId: "c1", content: [], isError: false });
      const partial = `{"type":"message","id":"l3","message":{"role":"assistant","content":[{"type":"te`;
      yield* fileSystem.writeFileString(
        file,
        `{"type":"session"}\n${assistant}${result}${partial}`,
      );

      const read = makeOmpSubagentTranscriptReader({ fileSystem, path, agentDir });
      const first = yield* read({ sessionId: "s1", agentId: "Scout", fromByte: 0 });
      expect(first.entries).toEqual([
        { type: "reasoning", nativeId: "Scout:l1:0", text: "look first" },
        {
          type: "tool",
          toolCall: {
            toolCallId: "c1",
            title: "Finding x",
            kind: "grep",
            status: "inProgress",
            data: { rawInput: { p: "x" } },
          },
        },
        {
          type: "tool",
          toolCall: {
            toolCallId: "c1",
            status: "completed",
            data: { rawOutput: { content: [], details: undefined } },
          },
        },
      ]);

      yield* fileSystem.writeFileString(file, `xt","text":"done"}]}}\n`, { flag: "a" });
      const second = yield* read({ sessionId: "s1", agentId: "Scout", fromByte: first.nextByte });
      expect(second.entries).toEqual([{ type: "assistant", nativeId: "Scout:l3:0", text: "done" }]);
      expect(yield* read({ sessionId: "s1", agentId: "Scout", fromByte: second.nextByte })).toEqual(
        { entries: [], nextByte: second.nextByte },
      );
      expect(
        (yield* read({ sessionId: "missing", agentId: "Scout", fromByte: 0 })).entries,
      ).toEqual([]);
    }).pipe(Effect.provide(NodeServices.layer), Effect.scoped),
  );
});
