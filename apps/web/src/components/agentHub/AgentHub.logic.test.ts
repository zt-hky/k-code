import {
  EnvironmentId,
  NodeId,
  ProjectId,
  ThreadId,
  type OrchestrationV2Subagent,
} from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  agentActivityStrip,
  collectLiveAgentParents,
  defaultAgentGridFilter,
  filterGridAgents,
  resolveGridPanes,
} from "./AgentHub.logic";

function agent(id: string, overrides: Partial<OrchestrationV2Subagent> = {}) {
  return {
    id: NodeId.make(id),
    status: "running",
    progress: undefined,
    ...overrides,
  } as never as OrchestrationV2Subagent;
}

const env = EnvironmentId.make("env-1");
const project = ProjectId.make("project-1");

function shell(id: string, overrides: Record<string, unknown> = {}) {
  return {
    environmentId: env,
    id: ThreadId.make(id),
    projectId: project,
    title: id,
    source: {
      status: "idle",
      activeRunId: null,
      activityRunStatus: null,
      pendingRuntimeRequest: null,
      pendingBackgroundTasks: [],
    },
    lineage: { relationshipToParent: null, parentThreadId: null, rootThreadId: ThreadId.make(id) },
    ...overrides,
  } as never as Parameters<typeof collectLiveAgentParents>[0][number];
}

function child(id: string, parent: string, overrides: Record<string, unknown> = {}) {
  return shell(id, {
    source: {
      status: "running",
      activeRunId: null,
      activityRunStatus: null,
      pendingRuntimeRequest: null,
      pendingBackgroundTasks: [],
      ...overrides,
    },
    lineage: {
      relationshipToParent: "subagent",
      parentThreadId: ThreadId.make(parent),
      rootThreadId: ThreadId.make("root"),
    },
  });
}

describe("agent grid filtering", () => {
  const agents = [agent("a"), agent("b", { status: "completed" }), agent("c")];

  it("defaults to live only when something is live", () => {
    expect(defaultAgentGridFilter(2)).toBe("live");
    expect(defaultAgentGridFilter(0)).toBe("all");
  });

  it("keeps order and drops settled agents under the live filter", () => {
    expect(filterGridAgents(agents, "live").map((a) => a.id)).toEqual(["a", "c"]);
    expect(filterGridAgents(agents, "all")).toBe(agents);
  });

  it("maximizes a present agent and ignores one that left the set", () => {
    expect(resolveGridPanes(agents, "c").map((a) => a.id)).toEqual(["c"]);
    expect(resolveGridPanes(agents, "gone")).toBe(agents);
    expect(resolveGridPanes(agents, null)).toBe(agents);
  });

  it("shows progress only while an agent runs", () => {
    expect(agentActivityStrip(agent("a", { progress: "  Reading\n files " }))).toBe(
      "Reading files",
    );
    expect(agentActivityStrip(agent("a", { status: "completed", progress: "done" }))).toBeNull();
    expect(agentActivityStrip(agent("a"))).toBeNull();
  });
});

describe("collectLiveAgentParents", () => {
  const running = { activeRunId: "run-1", activityRunStatus: "running" };
  const shells = [
    // Provider-native children have no shell of their own; parents signal through their own run
    // or pending subagent background tasks.
    shell("parent-b", { source: { ...shell("x").source, ...running } }),
    shell("parent-a", {
      source: {
        ...shell("x").source,
        activeRunId: null,
        pendingBackgroundTasks: [{ taskId: "t1", kind: "subagent" }],
      },
    }),
    shell("quiet", {
      source: {
        ...shell("x").source,
        activeRunId: null,
        pendingBackgroundTasks: [{ taskId: "t2", kind: "command" }],
      },
    }),
    // An idle native-style child shell never counts on its own.
    child("idle", "quiet", { status: "idle" }),
    // App-owned live child still names its parent.
    child("c3", "owned-parent"),
  ];

  it("finds parents of native subagents from their own shell signals, ordered by title", () => {
    const parents = collectLiveAgentParents(shells, {});
    expect(parents.map((p) => p.threadId)).toEqual(["parent-a", "parent-b", "owned-parent"]);
    expect(parents.find((p) => p.threadId === "owned-parent")?.rootThreadId).toBe("root");
  });

  it("scopes by project and environment", () => {
    expect(collectLiveAgentParents(shells, { projectId: ProjectId.make("other") })).toEqual([]);
    expect(collectLiveAgentParents(shells, { environmentId: EnvironmentId.make("other") })).toEqual(
      [],
    );
    expect(
      collectLiveAgentParents(shells, { projectId: project, environmentId: env }),
    ).toHaveLength(3);
  });
});
