import {
  formatSubagentDisplayTitle,
  resolveSubagentMetadata,
} from "@t3tools/client-runtime/state/subagent-display";
import {
  isActiveSubagentStatus,
  projectedSubagentsToRuntime,
} from "@t3tools/client-runtime/state/subagentRuntime";
import { getReasoningEffortOptionValue } from "@t3tools/client-runtime/state/thread-execution";
import type { ThreadAgentHub } from "@t3tools/client-runtime/state/thread-subagents";
import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/models";
import {
  isLiveSubagentShell,
  type EnvironmentId,
  type OrchestrationV2Subagent,
  type ProjectId,
  type ServerProvider,
  type ThreadId,
} from "@t3tools/contracts";

import { workEntrySignalsSevereFailure, type WorkLogEntry } from "../../session-logic";

export const AGENT_HUB_GRID_LOG_LIMIT = 40;
export const AGENT_HUB_PANEL_LOG_LIMIT = 200;
export const AGENT_HUB_ACTIVITY_AGENT_LIMIT = 12;
export const AGENT_HUB_ACTIVITY_ITEM_LIMIT = 50;

export type AgentActivityFilter = "all" | "tools" | "thinking" | "errors" | "replies";

export const AGENT_ACTIVITY_FILTERS: ReadonlyArray<{
  readonly id: AgentActivityFilter;
  readonly label: string;
}> = [
  { id: "all", label: "All" },
  { id: "tools", label: "Tools" },
  { id: "thinking", label: "Thinking" },
  { id: "errors", label: "Errors" },
  { id: "replies", label: "Replies" },
];

export interface AgentActivityEntry {
  readonly agentId: string;
  readonly entry: WorkLogEntry;
}

export function orderedHubAgents(hub: ThreadAgentHub): ReadonlyArray<OrchestrationV2Subagent> {
  return [...hub.live, ...hub.settled];
}

export function resolveFocusedAgent(
  hub: ThreadAgentHub,
  focusedSubagentId: string | undefined,
): OrchestrationV2Subagent | null {
  const agents = orderedHubAgents(hub);
  return agents.find((agent) => agent.id === focusedSubagentId) ?? agents[0] ?? null;
}

export function agentDisplayTitle(agent: OrchestrationV2Subagent): string {
  return formatSubagentDisplayTitle(agent.title?.trim() || "Subagent");
}

export function agentModelParts(
  agent: OrchestrationV2Subagent,
  providers: ReadonlyArray<ServerProvider> | undefined,
): { readonly model: string | null; readonly effort: string | null } {
  const provider = providers?.find(
    (candidate) => candidate.instanceId === agent.providerInstanceId,
  );
  return {
    model: agent.model?.trim()
      ? resolveSubagentMetadata({ model: agent.model, provider }).modelLabel
      : null,
    effort: getReasoningEffortOptionValue(agent.modelSelection) ?? null,
  };
}

export function agentModelMeta(
  agent: OrchestrationV2Subagent,
  providers: ReadonlyArray<ServerProvider> | undefined,
): string {
  const { model, effort } = agentModelParts(agent, providers);
  return [model, effort].filter(Boolean).join(" · ");
}

export function agentRuntime(agent: OrchestrationV2Subagent) {
  return projectedSubagentsToRuntime([agent])[0] ?? null;
}

function activityEntryMatchesFilter(entry: WorkLogEntry, filter: AgentActivityFilter): boolean {
  switch (filter) {
    case "all":
      return true;
    case "tools":
      return entry.tone === "tool";
    case "thinking":
      return entry.tone === "thinking";
    case "errors":
      return workEntrySignalsSevereFailure(entry) || entry.toolLifecycleStatus === "failed";
    case "replies":
      return entry.itemType === "assistant_message";
  }
}

export function mergeAgentActivity(
  entriesByAgentId: ReadonlyMap<string, ReadonlyArray<WorkLogEntry>>,
  filter: AgentActivityFilter,
): ReadonlyArray<AgentActivityEntry> {
  const merged: Array<AgentActivityEntry> = [];
  for (const [agentId, entries] of entriesByAgentId) {
    for (const entry of entries) {
      if (activityEntryMatchesFilter(entry, filter)) merged.push({ agentId, entry });
    }
  }
  return merged.sort((a, b) => a.entry.createdAt.localeCompare(b.entry.createdAt));
}

export type AgentGridFilter = "live" | "all";

export function defaultAgentGridFilter(liveCount: number): AgentGridFilter {
  return liveCount > 0 ? "live" : "all";
}

export function filterGridAgents(
  agents: ReadonlyArray<OrchestrationV2Subagent>,
  filter: AgentGridFilter,
): ReadonlyArray<OrchestrationV2Subagent> {
  return filter === "live"
    ? agents.filter((agent) => isActiveSubagentStatus(agent.status))
    : agents;
}

/** A maximized agent that left the filtered set stops being maximized. */
export function resolveGridPanes(
  agents: ReadonlyArray<OrchestrationV2Subagent>,
  maximizedId: string | null,
): ReadonlyArray<OrchestrationV2Subagent> {
  if (maximizedId === null) return agents;
  const maximized = agents.find((agent) => agent.id === maximizedId);
  return maximized ? [maximized] : agents;
}

/** What a running agent is doing right now, or null once it settled or reported nothing. */
export function agentActivityStrip(agent: OrchestrationV2Subagent): string | null {
  if (!isActiveSubagentStatus(agent.status)) return null;
  const compact = agent.progress?.replace(/\s+/gu, " ").trim();
  return compact ? compact : null;
}

export interface LiveAgentParentScope {
  readonly environmentId?: EnvironmentId | undefined;
  readonly projectId?: ProjectId | undefined;
}

export interface LiveAgentParent {
  readonly environmentId: EnvironmentId;
  readonly projectId: ProjectId;
  readonly threadId: ThreadId;
  readonly rootThreadId: ThreadId;
  readonly title: string;
}

type ShellForLiveAgents = Pick<
  EnvironmentThreadShell,
  "environmentId" | "id" | "projectId" | "title" | "lineage" | "source"
>;

/** The parent's own shell says it may be hosting subagents right now. */
function hostsLiveAgents(shell: ShellForLiveAgents): boolean {
  const { source } = shell;
  return (
    source.activeRunId !== null ||
    (source.activityRunStatus ?? null) !== null ||
    (source.pendingBackgroundTasks ?? []).some((task) => task.kind === "subagent")
  );
}

/**
 * Threads worth subscribing to for running subagents. Provider-native children have no shell of
 * their own, so candidates come from the parent's active run or pending subagent task, plus parents
 * named by live app-owned children. Callers derive actual liveness from each parent's projection.
 */
export function collectLiveAgentParents(
  shells: ReadonlyArray<ShellForLiveAgents>,
  scope: LiveAgentParentScope,
): ReadonlyArray<LiveAgentParent> {
  const byKey = new Map<string, ShellForLiveAgents>();
  for (const shell of shells) byKey.set(`${shell.environmentId}:${shell.id}`, shell);
  const parents = new Map<string, LiveAgentParent>();
  const add = (shell: ShellForLiveAgents, threadId: ThreadId, rootThreadId: ThreadId) => {
    if (scope.environmentId !== undefined && shell.environmentId !== scope.environmentId) return;
    if (scope.projectId !== undefined && shell.projectId !== scope.projectId) return;
    const key = `${shell.environmentId}:${threadId}`;
    if (parents.has(key)) return;
    parents.set(key, {
      environmentId: shell.environmentId,
      projectId: shell.projectId,
      threadId,
      rootThreadId,
      title: byKey.get(key)?.title ?? "Thread",
    });
  };
  for (const shell of shells) {
    if (hostsLiveAgents(shell)) add(shell, shell.id, shell.lineage.rootThreadId);
    const { parentThreadId, rootThreadId, relationshipToParent } = shell.lineage;
    if (relationshipToParent === "subagent" && parentThreadId !== null) {
      if (isLiveSubagentShell(shell.source)) add(shell, parentThreadId, rootThreadId);
    }
  }
  return [...parents.values()].toSorted(
    (left, right) =>
      left.title.localeCompare(right.title) || left.threadId.localeCompare(right.threadId),
  );
}
