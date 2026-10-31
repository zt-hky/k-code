import { useAtomValue } from "@effect/atom-react";
import { subagentDetailPreview } from "@t3tools/client-runtime/state/subagent-display";
import { isTerminalSubagentStatus } from "@t3tools/client-runtime/state/subagentRuntime";
import { formatSubagentUsage } from "@t3tools/client-runtime/state/thread-subagents";
import {
  NodeId,
  type EnvironmentId,
  type OrchestrationV2Subagent,
  type ServerProvider,
} from "@t3tools/contracts";
import { SquareIcon, TerminalIcon } from "lucide-react";
import { useState } from "react";

import { cn } from "~/lib/utils";
import { orchestrationEnvironment } from "../../state/orchestration";
import { threadEnvironment } from "../../state/threads";
import { EMPTY_SERVER_PROVIDERS, serverEnvironment } from "../../state/server";
import { useAtomCommand } from "../../state/use-atom-command";
import { AgentElapsed } from "../chat/AgentElapsed";
import { SubagentStatusIcon } from "../chat/ThreadWorkPanels";
import { canStopCapableNativeSubagent, canStopSubagent } from "../chat/ThreadRelationshipsControl";
import { Button } from "../ui/button";
import { toastManager } from "../ui/toast";
import { agentDisplayTitle, agentModelMeta, agentRuntime } from "./AgentHub.logic";

export function AgentStatusIcon({
  status,
}: {
  readonly status: OrchestrationV2Subagent["status"];
}) {
  return (
    <span className="flex size-4 shrink-0 items-center justify-center [&_svg]:size-3.5">
      <SubagentStatusIcon status={status} />
    </span>
  );
}

export function AgentStopButton(props: {
  readonly environmentId: EnvironmentId;
  readonly agent: OrchestrationV2Subagent;
}) {
  const { environmentId, agent } = props;
  const interruptTurn = useAtomCommand(threadEnvironment.interruptTurn);
  const stopWorkflowCommand = useAtomCommand(orchestrationEnvironment.stopWorkflow);
  const canOperateWorkflow = useAtomValue(
    orchestrationEnvironment.stopWorkflow.permissionAtom(environmentId),
  );
  const providers =
    useAtomValue(serverEnvironment.providersValueAtom(environmentId)) ?? EMPTY_SERVER_PROVIDERS;
  const [stopping, setStopping] = useState(false);
  const isWorkflow = agentRuntime(agent)?.kind === "workflow";
  const canStopNative =
    canOperateWorkflow &&
    !isWorkflow &&
    canStopCapableNativeSubagent(
      agent,
      providers.find((provider) => provider.instanceId === agent.providerInstanceId)
        ?.supportsSubagentStop,
    );
  const canStopWorkflow =
    canStopNative ||
    (isWorkflow &&
      canOperateWorkflow &&
      agent.status === "running" &&
      agent.origin === "provider_native" &&
      agent.driver === "claudeAgent");
  if (!canStopWorkflow && !canStopSubagent(agent)) return null;

  const stop = async () => {
    if (stopping) return;
    setStopping(true);
    const result = canStopWorkflow
      ? await stopWorkflowCommand({
          environmentId,
          input: { threadId: agent.threadId, subagentId: NodeId.make(agent.id) },
        })
      : await interruptTurn({
          environmentId,
          input: { threadId: agent.threadId, subagentId: agent.id },
        });
    if (result._tag === "Failure") {
      setStopping(false);
      toastManager.add({
        type: "error",
        title: canStopWorkflow ? "Could not stop agent" : "Could not stop subagent",
      });
      return;
    }
    // The agent only turns cancelled once the provider reports it; give up waiting after a while.
    if (canStopNative) setTimeout(() => setStopping(false), 15_000);
    else setStopping(false);
  };

  return (
    <Button
      size="xs"
      variant="destructive-outline"
      disabled={stopping}
      onClick={(event) => {
        event.stopPropagation();
        void stop();
      }}
    >
      <SquareIcon />
      {stopping ? "Stopping" : "Stop"}
    </Button>
  );
}

export function AgentHubRow(props: {
  readonly environmentId: EnvironmentId;
  readonly agent: OrchestrationV2Subagent;
  readonly providers: ReadonlyArray<ServerProvider> | undefined;
  readonly selected: boolean;
  readonly onSelect: () => void;
}) {
  const { agent } = props;
  const runtime = agentRuntime(agent);
  const title = agentDisplayTitle(agent);
  const meta = agentModelMeta(agent, props.providers);
  const usage = formatSubagentUsage(agent.usage);
  const preview = subagentDetailPreview({
    status: agent.status,
    result: agent.result,
    progress: agent.progress,
  });
  const runningTool = !isTerminalSubagentStatus(agent.status) && agent.progress;
  return (
    <li
      data-subagent-id={agent.id}
      data-subagent-status={agent.status}
      className="flex items-start"
    >
      <button
        type="button"
        aria-current={props.selected ? "true" : undefined}
        className={cn(
          "flex min-w-0 flex-1 items-start gap-2 px-3 py-1.5 text-start text-sm outline-none hover:bg-accent/50 focus-visible:bg-accent/50",
          props.selected && "bg-accent",
        )}
        onClick={props.onSelect}
      >
        <span className="mt-0.5">
          <AgentStatusIcon status={agent.status} />
        </span>
        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="flex min-w-0 items-center gap-1.5">
            <span className="truncate">{title}</span>
            {meta ? <span className="truncate text-xs text-muted-foreground">{meta}</span> : null}
          </span>
          {preview ? (
            <span className="flex min-w-0 items-center gap-1 text-xs text-muted-foreground">
              {runningTool ? <TerminalIcon aria-hidden className="size-3 shrink-0" /> : null}
              <span className="truncate">{preview}</span>
            </span>
          ) : null}
          {usage ? (
            <span className="truncate text-2xs tabular-nums text-muted-foreground">{usage}</span>
          ) : null}
        </span>
        {runtime ? (
          <span className="shrink-0 text-2xs tabular-nums text-muted-foreground empty:hidden">
            <AgentElapsed agent={runtime} compact />
          </span>
        ) : null}
      </button>
      <span className="shrink-0 py-1.5 pr-2 empty:hidden">
        <AgentStopButton environmentId={props.environmentId} agent={agent} />
      </span>
    </li>
  );
}
