import * as NodeServices from "@effect/platform-node/NodeServices";
import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";

import {
  extractOmpPlanApprovalElicitation,
  extractOmpProposedPlanMarkdown,
  extractOmpSubagentUpdate,
  makeOmpSubagentStopper,
  makeOmpSubagentTranscriptReader,
} from "./acp.ts";
import { ompSubagentStopMarkerName } from "./stopExtension.ts";

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

  it("splits a batch into one child per task with per-child results", () => {
    const update = extractOmpSubagentUpdate(
      tool(
        { tasks: [{ task: "x", name: "Alpha" }, { task: "y" }] },
        {
          rawOutput: {
            details: {
              results: [
                { index: 0, id: "a0", agent: "a", output: "one", exitCode: 0 },
                { index: 1, id: "a1", agent: "b", error: "boom", exitCode: 1 },
              ],
            },
          },
        },
        "completed",
      ),
    );
    expect(update).toMatchObject({
      nativeTaskId: "t1",
      status: "failed",
      prompt: "1. x\n2. y",
      title: "2 agents",
    });
    expect(update?.children).toMatchObject([
      {
        nativeTaskId: "t1:batch:0",
        prompt: "x",
        title: "Alpha",
        status: "completed",
        result: "one",
        transcriptAgentIds: ["a0"],
      },
      {
        nativeTaskId: "t1:batch:1",
        prompt: "y",
        title: "b",
        status: "failed",
        result: "boom",
        transcriptAgentIds: ["a1"],
      },
    ]);
  });

  it("keeps child keys stable before and after progress arrives", () => {
    const input = { tasks: [{ task: "x" }, { task: "y" }] };
    const before = extractOmpSubagentUpdate(tool(input));
    const after = extractOmpSubagentUpdate(
      tool(input, {
        rawOutput: {
          details: {
            progress: [
              { index: 1, id: "a1", status: "running", description: "Second" },
              { index: 0, id: "a0", status: "pending", description: "First" },
            ],
          },
        },
      }),
    );
    expect(before?.children?.map((child) => child.nativeTaskId)).toEqual([
      "t1:batch:0",
      "t1:batch:1",
    ]);
    expect(before?.children?.map((child) => child.status)).toEqual(["running", "running"]);
    expect(after?.children?.map((child) => child.nativeTaskId)).toEqual([
      "t1:batch:0",
      "t1:batch:1",
    ]);
    expect(after?.children).toMatchObject([
      { title: "First", status: "pending", transcriptAgentIds: ["a0"] },
      { title: "Second", status: "running", transcriptAgentIds: ["a1"] },
    ]);
  });

  it("reports each running agent's current tool, model, thinking level and usage", () => {
    const update = extractOmpSubagentUpdate(
      tool(
        { tasks: [{ task: "x" }, { task: "y" }] },
        {
          rawOutput: {
            details: {
              progress: [
                {
                  index: 0,
                  status: "completed",
                  resolvedModel: "anthropic/done",
                  tokens: 1_000,
                  cost: 0.25,
                  contextTokens: 90_000,
                  contextWindow: 200_000,
                },
                {
                  index: 1,
                  status: "running",
                  currentTool: "bash",
                  currentToolArgs: "vp test run",
                  lastIntent: "Running tests",
                  resolvedModel: "anthropic/claude-sonnet-4-5:high",
                  resolvedThinkingLevel: "high",
                  tokens: 500,
                  toolCount: 2,
                },
              ],
            },
          },
        },
      ),
    );
    expect(update?.status).toBe("running");
    expect(update?.children).toMatchObject([
      {
        status: "completed",
        model: "anthropic/done",
        progress: null,
        usage: { tokens: 1_000, costUsd: 0.25, contextTokens: 90_000, contextWindow: 200_000 },
      },
      {
        status: "running",
        model: "anthropic/claude-sonnet-4-5",
        reasoningEffort: "high",
        progress: "bash: vp test run",
        usage: { tokens: 500, toolCount: 2 },
      },
    ]);
  });

  it("applies a failed tool call to unfinished children only", () => {
    const update = extractOmpSubagentUpdate(
      tool(
        { tasks: [{ task: "x" }, { task: "y" }] },
        { rawOutput: { details: { results: [{ index: 0, output: "ok", exitCode: 0 }] } } },
        "failed",
      ),
    );
    expect(update?.children?.map((child) => child.status)).toEqual(["completed", "failed"]);
  });

  it("keeps async batch children live until their own progress settles (captured omp frames)", () => {
    const input = {
      tasks: [
        { task: "a", name: "SleepA" },
        { task: "b", name: "SleepB" },
      ],
    };
    const extract = (status: string, asyncState: string, progress: ReadonlyArray<string>) => {
      const update = extractOmpSubagentUpdate(
        tool(
          input,
          {
            rawOutput: {
              details: {
                results: [],
                progress: progress.map((entry, index) => ({
                  index,
                  id: `Sleep${index}`,
                  status: entry,
                })),
                async: { state: asyncState, jobId: "SleepA", type: "task" },
              },
            },
          },
          status,
        ),
      );
      return { status: update?.status, children: update?.children?.map((child) => child.status) };
    };
    // The task call returns at once: tool `completed`, async `running`, nothing started yet.
    expect(extract("completed", "running", ["pending", "pending"])).toEqual({
      status: "running",
      children: ["pending", "pending"],
    });
    // One agent stopped, its sibling still running: only the stopped child is terminal.
    expect(extract("in_progress", "running", ["aborted", "running"])).toEqual({
      status: "running",
      children: ["cancelled", "running"],
    });
    // The sibling settles; omp reports the whole async job failed because one agent was aborted.
    expect(extract("failed", "failed", ["aborted", "completed"])).toEqual({
      status: "cancelled",
      children: ["cancelled", "completed"],
    });
  });

  it("reports single-task usage only when the agent reports it", () => {
    expect(
      extractOmpSubagentUpdate(
        tool(
          { task: "x", solutionSpace: "s" },
          { rawOutput: { details: { progress: [{ status: "running" }] } } },
        ),
      )?.usage,
    ).toBeUndefined();
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

  it("settles async batch children from the progress of the post-return frames", () => {
    const input = {
      tasks: ["a", "b", "c"].map((id) => ({ id, task: `do ${id}`, description: id })),
    };
    const frame = (statuses: ReadonlyArray<string>, asyncState: string, status: string) =>
      tool(
        input,
        {
          rawOutput: {
            details: {
              results: [],
              progress: statuses.map((entry, index) => ({
                id: ["StopMe", "KeepB", "KeepC"][index],
                index,
                status: entry,
              })),
              async: { state: asyncState, jobId: "StopMe" },
            },
          },
        },
        status,
      );
    const statusesOf = (
      update: { readonly children?: ReadonlyArray<{ readonly status: string }> } | undefined,
    ) => update?.children?.map((child) => child.status);
    const returned = extractOmpSubagentUpdate(
      frame(["pending", "pending", "pending"], "running", "completed"),
    );
    expect(statusesOf(returned)).toEqual(["pending", "pending", "pending"]);
    expect(returned?.status).toBe("running");
    const partial = extractOmpSubagentUpdate(
      frame(["aborted", "running", "running"], "running", "in_progress"),
    );
    expect(statusesOf(partial)).toEqual(["cancelled", "running", "running"]);
    const settled = extractOmpSubagentUpdate(
      frame(["aborted", "completed", "completed"], "failed", "failed"),
    );
    expect(statusesOf(settled)).toEqual(["cancelled", "completed", "completed"]);
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

describe("omp subagent stop markers", () => {
  const stopScenario = (agentIds: ReadonlyArray<string>) =>
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const root = yield* fileSystem.makeTempDirectoryScoped({ prefix: "t3-omp-stop-" });
      const agentDir = path.join(root, "agent");
      const stopDir = path.join(root, "stop");
      const sessionDir = path.join(agentDir, "sessions", "-repo", "2026-01-01T00-00-00-000Z_s1");
      yield* fileSystem.makeDirectory(sessionDir, { recursive: true });
      yield* fileSystem.makeDirectory(stopDir, { recursive: true });
      yield* makeOmpSubagentStopper({ fileSystem, path, agentDir, stopDir })({
        sessionId: "s1",
        agentIds,
      });
      const markers = yield* fileSystem.readDirectory(stopDir);
      return {
        markers: [...markers].toSorted(),
        expected: agentIds
          .map((agentId) => ompSubagentStopMarkerName(path.join(sessionDir, `${agentId}.jsonl`)))
          .toSorted(),
      };
    }).pipe(Effect.provide(NodeServices.layer), Effect.scoped);

  it.effect("writes the marker named after a single task's session file", () =>
    Effect.gen(function* () {
      const { markers, expected } = yield* stopScenario(["0-Scout"]);
      expect(markers).toEqual(expected);
      expect(markers).toHaveLength(1);
    }),
  );

  it.effect("writes one distinct marker per child agent of a batch child", () =>
    Effect.gen(function* () {
      const { markers, expected } = yield* stopScenario(["0-A", "1-B"]);
      expect(markers).toEqual(expected);
      expect(new Set(markers).size).toBe(2);
    }),
  );

  it.effect("fails when the parent's session directory cannot be found", () =>
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const root = yield* fileSystem.makeTempDirectoryScoped({ prefix: "t3-omp-stop-" });
      yield* fileSystem.makeDirectory(path.join(root, "agent", "sessions"), { recursive: true });
      const exit = yield* makeOmpSubagentStopper({
        fileSystem,
        path,
        agentDir: path.join(root, "agent"),
        stopDir: path.join(root, "stop"),
      })({ sessionId: "missing", agentIds: ["x"] }).pipe(Effect.exit);
      expect(exit._tag).toBe("Failure");
    }).pipe(Effect.provide(NodeServices.layer), Effect.scoped),
  );
});
