import type { EnvironmentId, ProjectId } from "@t3tools/contracts";
import { createFileRoute } from "@tanstack/react-router";

import { RunningAgentsPage } from "../components/agentHub/RunningAgentsPage";

export interface AgentsSearch {
  readonly projectId?: ProjectId;
  readonly environmentId?: EnvironmentId;
}

function AgentsRouteComponent() {
  const { projectId, environmentId } = Route.useSearch();
  return <RunningAgentsPage projectId={projectId} environmentId={environmentId} />;
}

export const Route = createFileRoute("/_chat/agents")({
  validateSearch: (raw: Record<string, unknown>): AgentsSearch => ({
    ...(typeof raw.projectId === "string" && raw.projectId
      ? { projectId: raw.projectId as ProjectId }
      : {}),
    ...(typeof raw.environmentId === "string" && raw.environmentId
      ? { environmentId: raw.environmentId as EnvironmentId }
      : {}),
  }),
  component: AgentsRouteComponent,
});
