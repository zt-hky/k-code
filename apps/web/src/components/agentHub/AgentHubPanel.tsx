import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import { subagentDetailPreview } from "@t3tools/client-runtime/state/subagent-display";
import {
  deriveThreadAgentHub,
  formatAgentHubTotals,
  formatSubagentUsage,
} from "@t3tools/client-runtime/state/thread-subagents";
import type {
  EnvironmentId,
  OrchestrationV2Subagent,
  ScopedThreadRef,
  ServerProvider,
} from "@t3tools/contracts";
import { useNavigate } from "@tanstack/react-router";
import { BotIcon, ExternalLinkIcon } from "lucide-react";
import type { ReactNode } from "react";

import { type RightPanelSurface, useRightPanelStore } from "../../rightPanelStore";
import { useThreadProjection } from "../../state/entities";
import { useEnvironmentProviders } from "../../state/environments";
import { useThreadFamily } from "../../state/threads";
import { buildThreadRouteParams } from "../../threadRoutes";
import { AgentElapsed } from "../chat/AgentElapsed";
import { Button } from "../ui/button";
import { Toggle, ToggleGroup } from "../ui/toggle-group";
import {
  AGENT_HUB_PANEL_LOG_LIMIT,
  agentDisplayTitle,
  agentModelParts,
  agentRuntime,
  orderedHubAgents,
  resolveFocusedAgent,
} from "./AgentHub.logic";
import { AgentActivity, AgentGrid } from "./AgentHubTechnical";
import { AgentHubRow, AgentStatusIcon, AgentStopButton } from "./AgentHubParts";
import { AgentLog } from "./AgentLog";

type AgentHubSurface = Extract<RightPanelSurface, { kind: "agent-hub" }>;

interface AgentHubPatch {
  readonly mode?: "panel" | "technical";
  readonly view?: "grid" | "activity";
  readonly focusedSubagentId?: string | null;
}

function MetadataRow(props: { readonly label: string; readonly children: ReactNode }) {
  return (
    <>
      <dt className="text-muted-foreground">{props.label}</dt>
      <dd className="min-w-0 truncate tabular-nums">{props.children}</dd>
    </>
  );
}

function AgentInspector(props: {
  readonly threadRef: ScopedThreadRef;
  readonly agent: OrchestrationV2Subagent;
  readonly providers: ReadonlyArray<ServerProvider> | undefined;
}) {
  const { agent, threadRef } = props;
  const navigate = useNavigate();
  const runtime = agentRuntime(agent);
  const { model, effort } = agentModelParts(agent, props.providers);
  const usage = formatSubagentUsage(agent.usage);
  const detail = subagentDetailPreview({
    status: agent.status,
    result: agent.result,
    progress: agent.progress,
  });
  const { childThreadId } = agent;
  return (
    <section className="flex min-h-0 flex-1 flex-col" aria-label="Agent inspector">
      <header className="flex flex-wrap items-center gap-x-2 gap-y-1 border-b px-3 py-2">
        <AgentStatusIcon status={agent.status} />
        <h3 className="min-w-[8rem] flex-1 truncate text-sm font-medium">
          {agentDisplayTitle(agent)}
        </h3>
        <AgentStopButton environmentId={threadRef.environmentId} agent={agent} />
        {childThreadId === null ? null : (
          <Button
            size="xs"
            variant="outline"
            onClick={() => {
              void navigate({
                to: "/$environmentId/$threadId",
                params: buildThreadRouteParams(
                  scopeThreadRef(threadRef.environmentId, childThreadId),
                ),
              });
            }}
          >
            <ExternalLinkIcon />
            Open thread
          </Button>
        )}
      </header>
      <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-0.5 px-3 py-2 text-xs wrap-anywhere">
        <MetadataRow label="Status">{agent.status}</MetadataRow>
        {model ? <MetadataRow label="Model">{model}</MetadataRow> : null}
        {effort ? <MetadataRow label="Effort">{effort}</MetadataRow> : null}
        {runtime ? (
          <MetadataRow label="Elapsed">
            <AgentElapsed agent={runtime} />
          </MetadataRow>
        ) : null}
        {usage ? <MetadataRow label="Usage">{usage}</MetadataRow> : null}
        {agent.usage?.toolCount ? (
          <MetadataRow label="Tools">{agent.usage.toolCount}</MetadataRow>
        ) : null}
        {agent.remoteChild ? (
          <MetadataRow label="Runs on">{agent.remoteChild.label}</MetadataRow>
        ) : null}
      </dl>
      {detail ? (
        <p className="line-clamp-3 px-3 pb-2 text-xs text-muted-foreground">{detail}</p>
      ) : null}
      {childThreadId === null ? (
        agent.remoteChild ? (
          <p className="border-t px-3 py-2 text-xs text-muted-foreground">
            Runs on {agent.remoteChild.label}
          </p>
        ) : null
      ) : (
        <div className="flex min-h-0 flex-1 flex-col border-t">
          <AgentLog
            key={childThreadId}
            childRef={scopeThreadRef(threadRef.environmentId, childThreadId)}
            limit={AGENT_HUB_PANEL_LOG_LIMIT}
          />
        </div>
      )}
    </section>
  );
}

function RosterSection(props: {
  readonly title: string;
  readonly environmentId: EnvironmentId;
  readonly agents: ReadonlyArray<OrchestrationV2Subagent>;
  readonly providers: ReadonlyArray<ServerProvider> | undefined;
  readonly focusedId: string | null;
  readonly onSelect: (agentId: string) => void;
}) {
  if (props.agents.length === 0) return null;
  return (
    <div>
      <h3 className="px-3 pt-2 pb-1 text-xs font-medium text-muted-foreground">
        {props.title} ({props.agents.length})
      </h3>
      <ul role="list" aria-label={props.title}>
        {props.agents.map((agent) => (
          <AgentHubRow
            key={agent.id}
            environmentId={props.environmentId}
            agent={agent}
            providers={props.providers}
            selected={agent.id === props.focusedId}
            onSelect={() => props.onSelect(agent.id)}
          />
        ))}
      </ul>
    </div>
  );
}

export function AgentHubPanel(props: {
  readonly threadRef: ScopedThreadRef;
  readonly surface: AgentHubSurface;
}) {
  const { threadRef, surface } = props;
  const projection = useThreadProjection(threadRef)?.projection;
  const providers = useEnvironmentProviders().get(threadRef.environmentId);
  useThreadFamily(
    threadRef.environmentId,
    projection?.thread.lineage.rootThreadId ?? threadRef.threadId,
  );
  const hub = projection ? deriveThreadAgentHub(projection) : null;
  const technical = surface.mode === "technical";
  const view = surface.view === "activity" ? "activity" : "grid";
  const update = (ref: ScopedThreadRef, patch: AgentHubPatch) => {
    useRightPanelStore.getState().updateAgentHub(ref, patch);
  };
  const focused = hub ? resolveFocusedAgent(hub, surface.focusedSubagentId) : null;
  const agents = hub ? orderedHubAgents(hub) : [];
  const totals = hub ? formatAgentHubTotals(hub.totals) : null;

  const focusAgent = (agentId: string) => {
    update(threadRef, { mode: "panel", focusedSubagentId: agentId });
  };

  return (
    <div className="flex h-full min-h-0 flex-col" data-agent-hub>
      <header className="flex flex-wrap items-center gap-x-3 gap-y-1.5 border-b px-3 py-2">
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <BotIcon aria-hidden className="size-4 shrink-0 text-muted-foreground" />
          <h2 className="text-sm font-medium">Agent Hub</h2>
          {hub ? (
            <span className="truncate text-xs tabular-nums text-muted-foreground">
              {hub.live.length}/{agents.length} live
              {totals ? ` · ${totals}` : ""}
            </span>
          ) : null}
        </div>
        <ToggleGroup
          aria-label="Agent Hub mode"
          value={[technical ? "technical" : "panel"]}
          onValueChange={(value) => {
            const next = value[0];
            if (next === "panel" || next === "technical") update(threadRef, { mode: next });
          }}
        >
          <Toggle value="panel">Panel</Toggle>
          <Toggle value="technical">Technical</Toggle>
        </ToggleGroup>
        {technical ? (
          <ToggleGroup
            aria-label="Technical view"
            value={[view]}
            onValueChange={(value) => {
              const next = value[0];
              if (next === "grid" || next === "activity") update(threadRef, { view: next });
            }}
          >
            <Toggle value="grid">Grid</Toggle>
            <Toggle value="activity">Activity</Toggle>
          </ToggleGroup>
        ) : null}
      </header>
      {hub === null ? (
        <p className="px-3 py-4 text-sm text-muted-foreground">No subagents in this thread yet.</p>
      ) : technical ? (
        view === "activity" ? (
          <AgentActivity
            environmentId={threadRef.environmentId}
            agents={agents}
            onFocus={focusAgent}
          />
        ) : (
          <AgentGrid
            environmentId={threadRef.environmentId}
            agents={agents}
            providers={providers}
            onFocus={focusAgent}
          />
        )
      ) : (
        <>
          <div className="max-h-[40%] shrink-0 overflow-y-auto border-b pb-1">
            <RosterSection
              environmentId={threadRef.environmentId}
              title="Running"
              agents={hub.live}
              providers={providers}
              focusedId={focused?.id ?? null}
              onSelect={(agentId) => update(threadRef, { focusedSubagentId: agentId })}
            />
            <RosterSection
              environmentId={threadRef.environmentId}
              title="Finished"
              agents={hub.settled}
              providers={providers}
              focusedId={focused?.id ?? null}
              onSelect={(agentId) => update(threadRef, { focusedSubagentId: agentId })}
            />
          </div>
          {focused ? (
            <AgentInspector
              key={focused.id}
              threadRef={threadRef}
              agent={focused}
              providers={providers}
            />
          ) : null}
        </>
      )}
    </div>
  );
}
