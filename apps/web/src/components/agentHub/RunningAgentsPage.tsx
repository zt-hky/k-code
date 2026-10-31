import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import { deriveThreadAgentHub } from "@t3tools/client-runtime/state/thread-subagents";
import type { EnvironmentId, ProjectId, ServerProvider } from "@t3tools/contracts";
import { useNavigate } from "@tanstack/react-router";
import { BotIcon, ExternalLinkIcon } from "lucide-react";
import { useState } from "react";

import { isElectron } from "~/env";
import { workspaceAreaProps } from "../../lib/workspaceFocus";
import { useProjects, useThreadProjection, useThreadShells } from "../../state/entities";
import { useEnvironmentProviders } from "../../state/environments";
import { useThreadFamily } from "../../state/threads";
import { buildThreadRouteParams } from "../../threadRoutes";
import { Button } from "../ui/button";
import { SidebarInset } from "../ui/sidebar";
import { WorkspaceBreadcrumb, WorkspaceBreadcrumbItem } from "../WorkspaceBreadcrumb";
import { WorkspacePageHeader } from "../WorkspacePageHeader";
import {
  collectLiveAgentParents,
  filterGridAgents,
  orderedHubAgents,
  type AgentGridFilter,
  type LiveAgentParent,
} from "./AgentHub.logic";
import { AgentGridFilterToggle, AgentGridPanes } from "./AgentHubTechnical";

function ParentAgentGroup(props: {
  readonly parent: LiveAgentParent;
  readonly projectName: string | null;
  readonly filter: AgentGridFilter;
  readonly providers: ReadonlyArray<ServerProvider> | undefined;
}) {
  const { parent } = props;
  const navigate = useNavigate();
  useThreadFamily(parent.environmentId, parent.rootThreadId);
  const projection = useThreadProjection(scopeThreadRef(parent.environmentId, parent.threadId));
  const hub = projection ? deriveThreadAgentHub(projection.projection) : null;
  const agents = hub ? filterGridAgents(orderedHubAgents(hub), props.filter) : [];
  const openThread = (threadId: typeof parent.threadId) => {
    void navigate({
      to: "/$environmentId/$threadId",
      params: buildThreadRouteParams(scopeThreadRef(parent.environmentId, threadId)),
    });
  };
  if (hub !== null && agents.length === 0) return null;
  return (
    <section
      className="flex min-w-0 flex-col gap-2"
      data-agent-parent={parent.threadId}
      aria-label={parent.title}
    >
      <header className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
        <div className="flex min-w-0 flex-1 basis-48 items-baseline gap-2">
          <h2 className="min-w-0 truncate text-sm font-medium">{parent.title}</h2>
          {props.projectName ? (
            <span className="min-w-0 truncate text-xs text-muted-foreground">
              {props.projectName}
            </span>
          ) : null}
          <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
            {hub?.live.length ?? 0} live
          </span>
        </div>
        <Button
          className="ms-auto"
          size="xs"
          variant="outline"
          onClick={() => openThread(parent.threadId)}
        >
          <ExternalLinkIcon />
          Open thread
        </Button>
      </header>
      {hub === null ? (
        <p className="text-xs text-muted-foreground">Loading agents…</p>
      ) : (
        <AgentGridPanes
          environmentId={parent.environmentId}
          agents={agents}
          providers={props.providers}
          focusLabel="Open thread"
          fill={false}
          onFocus={(agentId) => {
            const childThreadId = agents.find((agent) => agent.id === agentId)?.childThreadId;
            openThread(childThreadId ?? parent.threadId);
          }}
        />
      )}
    </section>
  );
}

export function RunningAgentsPage(props: {
  readonly environmentId?: EnvironmentId | undefined;
  readonly projectId?: ProjectId | undefined;
}) {
  const { environmentId, projectId } = props;
  const navigate = useNavigate();
  const shells = useThreadShells();
  const projects = useProjects();
  const providersByEnvironment = useEnvironmentProviders();
  const [filter, setFilter] = useState<AgentGridFilter>("live");
  const parents = collectLiveAgentParents(shells, { environmentId, projectId });
  const projectNames = new Map(
    projects.map((project) => [`${project.environmentId}:${project.id}`, project.title]),
  );
  const scopedProjectName =
    projectId === undefined
      ? null
      : (projects.find(
          (project) =>
            project.id === projectId &&
            (environmentId === undefined || project.environmentId === environmentId),
        )?.title ?? null);
  const scoped = environmentId !== undefined || projectId !== undefined;

  return (
    <SidebarInset className="h-dvh min-h-0 overflow-hidden overscroll-y-none">
      <WorkspacePageHeader electron={isElectron} className="bg-background">
        <WorkspaceBreadcrumb ariaLabel="Running agents breadcrumb">
          <WorkspaceBreadcrumbItem current>
            <h1 className="truncate">Running agents</h1>
          </WorkspaceBreadcrumbItem>
        </WorkspaceBreadcrumb>
        {scopedProjectName ? (
          <span className="truncate text-xs text-muted-foreground max-sm:hidden">
            {scopedProjectName}
          </span>
        ) : null}
        <div className="min-w-0 flex-1" />
        {scoped ? (
          <Button
            size="xs"
            variant="ghost-muted"
            onClick={() => {
              void navigate({ to: "/agents", search: {} });
            }}
          >
            All projects
          </Button>
        ) : null}
        <div className="shrink-0">
          <AgentGridFilterToggle filter={filter} onChange={setFilter} />
        </div>
      </WorkspacePageHeader>
      <div
        {...workspaceAreaProps("running-agents", 1, "Running agents")}
        className="@container/agent-grid min-h-0 flex-1 overflow-y-auto p-3 sm:p-4"
      >
        {parents.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-2 text-center">
            <BotIcon aria-hidden className="size-6 text-muted-foreground" />
            <p className="text-sm">No agents are running.</p>
            <p className="text-xs text-muted-foreground">
              Subagents appear here while a thread has them working.
            </p>
          </div>
        ) : (
          <div className="flex flex-col gap-6">
            {parents.map((parent) => (
              <ParentAgentGroup
                key={`${parent.environmentId}:${parent.threadId}`}
                parent={parent}
                projectName={
                  scoped
                    ? null
                    : (projectNames.get(`${parent.environmentId}:${parent.projectId}`) ?? null)
                }
                filter={filter}
                providers={providersByEnvironment.get(parent.environmentId)}
              />
            ))}
          </div>
        )}
      </div>
    </SidebarInset>
  );
}
