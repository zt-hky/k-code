import { scopedThreadKey } from "@t3tools/client-runtime/environment";
import {
  formatSubagentDisplayTitle,
  resolveSubagentMetadata,
  subagentDetailPreview,
} from "@t3tools/client-runtime/state/subagent-display";
import {
  isTerminalSubagentStatus,
  projectedSubagentsToRuntime,
} from "@t3tools/client-runtime/state/subagentRuntime";
import { getReasoningEffortOptionValue } from "@t3tools/client-runtime/state/thread-execution";
import {
  resolveSubagentPillSegment,
  type ThreadTurnSubagents,
} from "@t3tools/client-runtime/state/thread-subagents";
import type {
  OrchestrationV2PlanStep,
  OrchestrationV2Subagent,
  ScopedThreadRef,
  ServerProvider,
  ThreadId,
} from "@t3tools/contracts";
import {
  BotIcon,
  ChevronRightIcon,
  CircleCheckIcon,
  CircleDashedIcon,
  CircleIcon,
  CircleXIcon,
  ListTodoIcon,
  TerminalIcon,
} from "lucide-react";
import { useState, type ReactNode } from "react";

import { cn } from "~/lib/utils";
import type { LatestTodoListState } from "../../session-logic";
import { useThreadTurnSubagents } from "../../state/entities";
import { useEnvironmentProviders } from "../../state/environments";
import { Button } from "../ui/button";
import { Collapsible, CollapsiblePanel, CollapsibleTrigger } from "../ui/collapsible";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { AgentElapsed } from "./AgentElapsed";
import { ComposerBanner } from "./ComposerBanner";
import {
  countCompletedSteps,
  splitSubagentsByState,
  windowTodoSteps,
} from "./ThreadWorkPanels.logic";

function TruncatedText(props: { readonly children: string; readonly className?: string }) {
  return (
    <Tooltip>
      <TooltipTrigger
        delay={400}
        render={<span className={cn("min-w-0 truncate", props.className)} />}
      >
        {props.children}
      </TooltipTrigger>
      <TooltipPopup side="top" className="max-w-[min(30rem,calc(100vw-2rem))] wrap-anywhere">
        {props.children}
      </TooltipPopup>
    </Tooltip>
  );
}

function PanelHeader(props: {
  readonly icon: ReactNode;
  readonly title: string;
  readonly summary: string;
  readonly expanded: boolean;
}) {
  return (
    <CollapsibleTrigger render={<ComposerBanner.Row render={<button type="button" />} />}>
      <ComposerBanner.Icon>{props.icon}</ComposerBanner.Icon>
      <ComposerBanner.Content>
        <span className="font-medium">{props.title}</span>
      </ComposerBanner.Content>
      <ComposerBanner.Actions className="gap-0">
        <span className="px-1 text-muted-foreground tabular-nums">{props.summary}</span>
        <ComposerBanner.ToggleIcon expanded={props.expanded} />
      </ComposerBanner.Actions>
    </CollapsibleTrigger>
  );
}

function TodoStatusIcon({ status }: { readonly status: OrchestrationV2PlanStep["status"] }) {
  if (status === "completed") return <CircleCheckIcon className="text-muted-foreground" />;
  if (status === "running") return <CircleDashedIcon className="text-primary" />;
  return <CircleIcon className="text-muted-foreground" />;
}

function TasksCard({ todoList }: { readonly todoList: LatestTodoListState }) {
  const [open, setOpen] = useState(true);
  const [showAll, setShowAll] = useState(false);
  const { steps } = todoList;
  const { visible, hasMore } = windowTodoSteps(steps, showAll);
  return (
    <ComposerBanner.Attachment data-thread-work-panel="tasks">
      <ComposerBanner.Root density="comfortable">
        <Collapsible open={open} onOpenChange={setOpen}>
          <PanelHeader
            icon={<ListTodoIcon />}
            title="Tasks"
            summary={`${countCompletedSteps(steps)}/${steps.length} complete`}
            expanded={open}
          />
          <CollapsiblePanel>
            <ComposerBanner.Scroll>
              <ComposerBanner.Children render={<ul role="list" />} aria-label="Tasks">
                {todoList.explanation ? (
                  <ComposerBanner.Row render={<li />}>
                    <ComposerBanner.Icon />
                    <ComposerBanner.Content className="text-muted-foreground">
                      <TruncatedText>{todoList.explanation}</TruncatedText>
                    </ComposerBanner.Content>
                  </ComposerBanner.Row>
                ) : null}
                {visible.map((step) => (
                  <ComposerBanner.Row render={<li />} key={step.id} data-todo-status={step.status}>
                    <ComposerBanner.Icon>
                      <TodoStatusIcon status={step.status} />
                    </ComposerBanner.Icon>
                    <ComposerBanner.Content>
                      <TruncatedText
                        className={cn(
                          step.status === "completed" && "text-muted-foreground line-through",
                        )}
                      >
                        {step.text}
                      </TruncatedText>
                    </ComposerBanner.Content>
                  </ComposerBanner.Row>
                ))}
                {hasMore ? (
                  <ComposerBanner.Row render={<li />}>
                    <ComposerBanner.Icon />
                    <ComposerBanner.Content>
                      <Button
                        size="xs"
                        variant="link"
                        className="-ms-1.5"
                        onClick={() => setShowAll(true)}
                      >
                        Show all tasks
                      </Button>
                    </ComposerBanner.Content>
                  </ComposerBanner.Row>
                ) : null}
              </ComposerBanner.Children>
            </ComposerBanner.Scroll>
          </CollapsiblePanel>
        </Collapsible>
      </ComposerBanner.Root>
    </ComposerBanner.Attachment>
  );
}

function SubagentStatusIcon({ status }: { readonly status: OrchestrationV2Subagent["status"] }) {
  switch (status) {
    case "running":
    case "waiting":
      return <CircleDashedIcon className="text-primary" />;
    case "completed":
      return <CircleCheckIcon className="text-muted-foreground" />;
    case "failed":
      return <CircleXIcon className="text-destructive" />;
    case "cancelled":
    case "interrupted":
      return <CircleXIcon className="text-muted-foreground" />;
    case "idle":
    case "pending":
      return <CircleIcon className="text-muted-foreground" />;
  }
}

function SubagentRow(props: {
  readonly subagent: OrchestrationV2Subagent;
  readonly providers: ReadonlyArray<ServerProvider> | undefined;
  readonly onOpen: (threadId: ThreadId) => void;
}) {
  const { subagent } = props;
  const runtime = projectedSubagentsToRuntime([subagent])[0];
  if (runtime === undefined) return null;
  const title = formatSubagentDisplayTitle(runtime.title);
  const preview = subagentDetailPreview({
    status: subagent.status,
    result: subagent.result,
    progress: subagent.progress,
  });
  const provider = props.providers?.find(
    (candidate) => candidate.instanceId === subagent.providerInstanceId,
  );
  const model = subagent.model?.trim()
    ? resolveSubagentMetadata({ model: subagent.model, provider }).modelLabel
    : null;
  const meta = [model, getReasoningEffortOptionValue(subagent.modelSelection)]
    .filter(Boolean)
    .join(" · ");
  const runningTool = !isTerminalSubagentStatus(subagent.status) && subagent.progress;
  const { childThreadId } = subagent;
  const content = (
    <>
      <ComposerBanner.Icon>
        <SubagentStatusIcon status={subagent.status} />
      </ComposerBanner.Icon>
      <ComposerBanner.Content className="flex-col items-stretch gap-0">
        <span className="flex min-w-0 items-center gap-1">
          <TruncatedText className="shrink-0 max-w-[60%]">{title}</TruncatedText>
          {meta ? (
            <>
              <ComposerBanner.Separator />
              <TruncatedText className="text-muted-foreground">{meta}</TruncatedText>
            </>
          ) : null}
        </span>
        {preview ? (
          <span className="flex min-w-0 items-center gap-1 text-xs text-muted-foreground">
            {runningTool ? <TerminalIcon aria-hidden className="size-3 shrink-0" /> : null}
            <TruncatedText className="flex-1">{preview}</TruncatedText>
          </span>
        ) : null}
      </ComposerBanner.Content>
      <ComposerBanner.Actions>
        <span className="text-2xs text-muted-foreground tabular-nums empty:hidden">
          <AgentElapsed agent={runtime} compact />
        </span>
      </ComposerBanner.Actions>
    </>
  );
  return (
    <li data-subagent-id={subagent.id} data-subagent-status={subagent.status}>
      {childThreadId === null ? (
        <ComposerBanner.Row>{content}</ComposerBanner.Row>
      ) : (
        <ComposerBanner.Row
          render={<button type="button" aria-label={`Open ${title}`} />}
          onClick={() => props.onOpen(childThreadId)}
        >
          {content}
        </ComposerBanner.Row>
      )}
    </li>
  );
}

function SubagentsCard(props: {
  readonly turn: ThreadTurnSubagents;
  readonly providers: ReadonlyArray<ServerProvider> | undefined;
  readonly summary: string;
  readonly onOpenSubagent: (threadId: ThreadId) => void;
}) {
  const [open, setOpen] = useState(true);
  const [settledOpen, setSettledOpen] = useState(false);
  const { active, settled } = splitSubagentsByState(props.turn.subagents);
  return (
    <ComposerBanner.Attachment data-thread-work-panel="subagents">
      <ComposerBanner.Root density="comfortable">
        <Collapsible open={open} onOpenChange={setOpen}>
          <PanelHeader
            icon={<BotIcon />}
            title="Subagents"
            summary={props.summary}
            expanded={open}
          />
          <CollapsiblePanel>
            <ComposerBanner.Scroll>
              <ComposerBanner.Children render={<ul role="list" />} aria-label="Subagents">
                {active.map((subagent) => (
                  <SubagentRow
                    key={subagent.id}
                    subagent={subagent}
                    providers={props.providers}
                    onOpen={props.onOpenSubagent}
                  />
                ))}
              </ComposerBanner.Children>
              {settled.length > 0 ? (
                <Collapsible open={settledOpen} onOpenChange={setSettledOpen}>
                  <CollapsibleTrigger
                    className="group/settled"
                    render={<ComposerBanner.Row render={<button type="button" />} />}
                  >
                    <ComposerBanner.Icon>
                      <ChevronRightIcon className="transition-transform group-data-[panel-open]/settled:rotate-90 motion-reduce:transition-none" />
                    </ComposerBanner.Icon>
                    <ComposerBanner.Content className="text-muted-foreground">
                      Completed ({settled.length})
                    </ComposerBanner.Content>
                  </CollapsibleTrigger>
                  <CollapsiblePanel>
                    <ComposerBanner.Children
                      render={<ul role="list" />}
                      aria-label="Completed subagents"
                    >
                      {settled.map((subagent) => (
                        <SubagentRow
                          key={subagent.id}
                          subagent={subagent}
                          providers={props.providers}
                          onOpen={props.onOpenSubagent}
                        />
                      ))}
                    </ComposerBanner.Children>
                  </CollapsiblePanel>
                </Collapsible>
              ) : null}
            </ComposerBanner.Scroll>
          </CollapsiblePanel>
        </Collapsible>
      </ComposerBanner.Root>
    </ComposerBanner.Attachment>
  );
}

export function ThreadWorkPanels(props: {
  readonly todoList: LatestTodoListState | null;
  readonly subagents: ThreadTurnSubagents | null;
  readonly providers?: ReadonlyArray<ServerProvider> | undefined;
  readonly onOpenSubagent: (threadId: ThreadId) => void;
}) {
  const pill = resolveSubagentPillSegment(props.subagents);
  return (
    <>
      {props.todoList === null ? null : <TasksCard todoList={props.todoList} />}
      {props.subagents === null || pill === null ? null : (
        <SubagentsCard
          turn={props.subagents}
          providers={props.providers}
          summary={pill.label}
          onOpenSubagent={props.onOpenSubagent}
        />
      )}
    </>
  );
}

/** Keyed by thread so each thread starts with its panels open. */
export function ThreadWorkPanelsDock(props: {
  readonly threadRef: ScopedThreadRef;
  readonly todoList: LatestTodoListState | null;
  readonly onOpenSubagent: (threadId: ThreadId) => void;
}) {
  const subagents = useThreadTurnSubagents(props.threadRef);
  const providers = useEnvironmentProviders().get(props.threadRef.environmentId);
  return (
    <ThreadWorkPanels
      key={scopedThreadKey(props.threadRef)}
      todoList={props.todoList}
      subagents={subagents}
      providers={providers}
      onOpenSubagent={props.onOpenSubagent}
    />
  );
}
