import { formatSubagentUsage } from "@t3tools/client-runtime/state/thread-subagents";
import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import type {
  EnvironmentId,
  OrchestrationV2Subagent,
  ScopedThreadRef,
  ServerProvider,
} from "@t3tools/contracts";
import { isActiveSubagentStatus } from "@t3tools/client-runtime/state/subagentRuntime";
import { CrosshairIcon, Maximize2Icon, Minimize2Icon, TerminalIcon } from "lucide-react";
import { useEffect, useState } from "react";

import { useEnvironmentSettings } from "../../hooks/useSettings";
import { useStableCallback } from "../../hooks/useStableCallback";
import { workLogEntryFromProjectedItem, type WorkLogEntry } from "../../session-logic";
import { useThreadVisibleTurnItems } from "../../state/entities";
import { cn } from "~/lib/utils";
import { Button } from "../ui/button";
import { Toggle, ToggleGroup } from "../ui/toggle-group";
import {
  AGENT_ACTIVITY_FILTERS,
  AGENT_HUB_ACTIVITY_AGENT_LIMIT,
  AGENT_HUB_ACTIVITY_ITEM_LIMIT,
  AGENT_HUB_GRID_LOG_LIMIT,
  AGENT_HUB_PANEL_LOG_LIMIT,
  agentActivityStrip,
  agentDisplayTitle,
  agentModelMeta,
  defaultAgentGridFilter,
  filterGridAgents,
  mergeAgentActivity,
  resolveGridPanes,
  type AgentGridFilter,
  type AgentActivityFilter,
} from "./AgentHub.logic";
import { AgentStatusIcon, AgentStopButton } from "./AgentHubParts";
import { AgentLog, AgentLogRow } from "./AgentLog";

function GridPane(props: {
  readonly environmentId: EnvironmentId;
  readonly agent: OrchestrationV2Subagent;
  readonly providers: ReadonlyArray<ServerProvider> | undefined;
  readonly focusLabel: string;
  readonly maximized: boolean;
  readonly fill: boolean;
  readonly onFocus: (agentId: string) => void;
  readonly onToggleMaximized: (agentId: string) => void;
}) {
  const { agent, environmentId } = props;
  const meta = agentModelMeta(agent, props.providers);
  const usage = formatSubagentUsage(agent.usage);
  const strip = agentActivityStrip(agent);
  const maximizeLabel = props.maximized ? "Restore agent" : "Maximize agent";
  return (
    <section
      className={cn(
        "flex min-w-0 flex-col overflow-hidden rounded-lg border bg-card",
        props.maximized
          ? props.fill
            ? "h-full"
            : "h-[75dvh] max-sm:h-[calc(100dvh-8rem)]"
          : "h-72 max-sm:h-[min(20rem,65dvh)]",
      )}
      data-subagent-id={agent.id}
      data-subagent-maximized={props.maximized ? "true" : undefined}
      aria-label={agentDisplayTitle(agent)}
    >
      <header className="flex flex-wrap items-start gap-x-2 gap-y-1 border-b px-3 py-2">
        <div className="flex min-w-[10rem] flex-1 items-start gap-2">
          <AgentStatusIcon status={agent.status} />
          <div className="flex min-w-0 flex-1 flex-col">
            <span className="flex min-w-0 flex-wrap items-baseline gap-x-1.5 text-sm">
              <span className="min-w-0 max-w-full truncate">{agentDisplayTitle(agent)}</span>
              {meta ? (
                <span className="min-w-0 max-w-full truncate text-xs text-muted-foreground">
                  {meta}
                </span>
              ) : null}
            </span>
            {usage ? (
              <span className="text-2xs tabular-nums text-muted-foreground wrap-anywhere">
                {usage}
              </span>
            ) : null}
          </div>
        </div>
        <div className="ms-auto flex shrink-0 items-center gap-1">
          <AgentStopButton environmentId={environmentId} agent={agent} />
          <Button
            size="icon-xs"
            variant="ghost-muted"
            aria-label={maximizeLabel}
            aria-pressed={props.maximized}
            onClick={() => props.onToggleMaximized(agent.id)}
          >
            {props.maximized ? <Minimize2Icon /> : <Maximize2Icon />}
          </Button>
          <Button size="xs" variant="outline" onClick={() => props.onFocus(agent.id)}>
            <CrosshairIcon />
            {props.focusLabel}
          </Button>
        </div>
      </header>
      {strip ? (
        <div
          className="flex min-w-0 items-center gap-1.5 border-b bg-muted/30 px-3 py-1 text-2xs text-muted-foreground"
          data-agent-activity-strip
        >
          <TerminalIcon aria-hidden className="size-3 shrink-0" />
          <span className="truncate">{strip}</span>
        </div>
      ) : null}
      {agent.childThreadId === null ? (
        <p className="px-3 py-2 text-xs text-muted-foreground">
          {agent.remoteChild ? `Runs on ${agent.remoteChild.label}` : "No thread yet."}
        </p>
      ) : (
        <AgentLog
          childRef={scopeThreadRef(environmentId, agent.childThreadId)}
          limit={props.maximized ? AGENT_HUB_PANEL_LOG_LIMIT : AGENT_HUB_GRID_LOG_LIMIT}
        />
      )}
    </section>
  );
}

export function AgentGridFilterToggle(props: {
  readonly filter: AgentGridFilter;
  readonly liveCount?: number;
  readonly totalCount?: number;
  readonly onChange: (filter: AgentGridFilter) => void;
}) {
  return (
    <ToggleGroup
      aria-label="Agent filter"
      value={[props.filter]}
      onValueChange={(value) => {
        const next = value[0];
        if (next === "live" || next === "all") props.onChange(next);
      }}
    >
      <Toggle value="live">
        Live{props.liveCount === undefined ? "" : ` (${props.liveCount})`}
      </Toggle>
      <Toggle value="all">
        All{props.totalCount === undefined ? "" : ` (${props.totalCount})`}
      </Toggle>
    </ToggleGroup>
  );
}

/** Panes for already-filtered agents; one can be maximized to fill the grid. */
export function AgentGridPanes(props: {
  readonly environmentId: EnvironmentId;
  readonly agents: ReadonlyArray<OrchestrationV2Subagent>;
  readonly providers: ReadonlyArray<ServerProvider> | undefined;
  readonly onFocus: (agentId: string) => void;
  readonly focusLabel?: string;
  /** The grid has a bounded height to fill; otherwise a maximized pane takes a viewport share. */
  readonly fill: boolean;
}) {
  const [maximizedId, setMaximizedId] = useState<string | null>(null);
  const panes = resolveGridPanes(props.agents, maximizedId);
  const maximized = maximizedId !== null && panes.length === 1 && panes[0]?.id === maximizedId;
  return (
    <div
      className={cn(
        "grid gap-3",
        maximized
          ? cn("grid-cols-1", props.fill && "h-full grid-rows-[minmax(0,1fr)]")
          : "grid-cols-1 @min-[40rem]/agent-grid:grid-cols-2 @min-[64rem]/agent-grid:grid-cols-3 @min-[88rem]/agent-grid:grid-cols-4",
      )}
    >
      {panes.map((agent) => (
        <GridPane
          key={agent.id}
          environmentId={props.environmentId}
          agent={agent}
          providers={props.providers}
          focusLabel={props.focusLabel ?? "Focus"}
          maximized={maximized}
          fill={props.fill}
          onFocus={props.onFocus}
          onToggleMaximized={(agentId) =>
            setMaximizedId((current) => (current === agentId ? null : agentId))
          }
        />
      ))}
    </div>
  );
}

export function AgentGrid(props: {
  readonly environmentId: EnvironmentId;
  readonly agents: ReadonlyArray<OrchestrationV2Subagent>;
  readonly providers: ReadonlyArray<ServerProvider> | undefined;
  readonly onFocus: (agentId: string) => void;
}) {
  const liveCount = props.agents.filter((agent) => isActiveSubagentStatus(agent.status)).length;
  const [filterOverride, setFilterOverride] = useState<AgentGridFilter | null>(null);
  const filter = filterOverride ?? defaultAgentGridFilter(liveCount);
  const agents = filterGridAgents(props.agents, filter);
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex flex-wrap items-center gap-2 border-b px-3 py-2">
        <AgentGridFilterToggle
          filter={filter}
          liveCount={liveCount}
          totalCount={props.agents.length}
          onChange={setFilterOverride}
        />
      </div>
      <div className="@container/agent-grid min-h-0 flex-1 overflow-y-auto p-3">
        {agents.length === 0 ? (
          <p className="text-center text-xs text-muted-foreground">No agents are running.</p>
        ) : (
          <AgentGridPanes
            environmentId={props.environmentId}
            agents={agents}
            providers={props.providers}
            onFocus={props.onFocus}
            fill
          />
        )}
      </div>
    </div>
  );
}

function AgentActivitySource(props: {
  readonly childRef: ScopedThreadRef;
  readonly agentId: string;
  readonly onItems: (agentId: string, entries: ReadonlyArray<WorkLogEntry>) => void;
}) {
  const { childRef, agentId, onItems } = props;
  const items = useThreadVisibleTurnItems(childRef);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- publishes a child thread's items into the hub's merged feed
  useEffect(() => {
    onItems(
      agentId,
      items.slice(-AGENT_HUB_ACTIVITY_ITEM_LIMIT).map(workLogEntryFromProjectedItem),
    );
  }, [agentId, items, onItems]);
  return null;
}

export function AgentActivity(props: {
  readonly environmentId: EnvironmentId;
  readonly agents: ReadonlyArray<OrchestrationV2Subagent>;
  readonly onFocus: (agentId: string) => void;
}) {
  const { environmentId } = props;
  const [filter, setFilter] = useState<AgentActivityFilter>("all");
  const [entriesByAgentId, setEntriesByAgentId] = useState<
    ReadonlyMap<string, ReadonlyArray<WorkLogEntry>>
  >(new Map());
  const timestampFormat = useEnvironmentSettings(
    environmentId,
    (settings) => settings.timestampFormat,
  );
  const sources = props.agents
    .flatMap((agent) =>
      agent.childThreadId === null ? [] : [{ agent, childThreadId: agent.childThreadId }],
    )
    .slice(0, AGENT_HUB_ACTIVITY_AGENT_LIMIT);
  const onItems = useStableCallback((agentId: string, entries: ReadonlyArray<WorkLogEntry>) => {
    setEntriesByAgentId((previous) => new Map(previous).set(agentId, entries));
  });
  const sourceIds = new Set<string>(sources.map(({ agent }) => agent.id));
  const feed = mergeAgentActivity(
    new Map(Array.from(entriesByAgentId).filter(([agentId]) => sourceIds.has(agentId))),
    filter,
  );
  const titlesById = new Map<string, string>(
    sources.map(({ agent }) => [agent.id, agentDisplayTitle(agent)]),
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {sources.map(({ agent, childThreadId }) => (
        <AgentActivitySource
          key={agent.id}
          agentId={agent.id}
          childRef={scopeThreadRef(environmentId, childThreadId)}
          onItems={onItems}
        />
      ))}
      <div
        className="flex flex-wrap gap-1 border-b px-3 py-2"
        role="group"
        aria-label="Activity filter"
      >
        {AGENT_ACTIVITY_FILTERS.map((option) => (
          <Button
            key={option.id}
            size="xs"
            variant={filter === option.id ? "secondary" : "ghost-muted"}
            aria-pressed={filter === option.id}
            onClick={() => setFilter(option.id)}
          >
            {option.label}
          </Button>
        ))}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto py-1">
        {feed.length === 0 ? (
          <p className="px-3 py-2 text-xs text-muted-foreground">No activity yet.</p>
        ) : (
          feed.map(({ agentId, entry }) => (
            <button
              key={`${agentId}:${entry.id}`}
              type="button"
              className="block w-full text-start outline-none hover:bg-accent/50 focus-visible:bg-accent/50"
              onClick={() => props.onFocus(agentId)}
            >
              <AgentLogRow
                entry={entry}
                timestampFormat={timestampFormat}
                agentTitle={titlesById.get(agentId) ?? "Agent"}
              />
            </button>
          ))
        )}
      </div>
    </div>
  );
}
