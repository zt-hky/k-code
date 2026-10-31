import type {
  EnvironmentId,
  OrchestrationV2ProjectedTurnItem,
  ScopedThreadRef,
} from "@t3tools/contracts";
import { BrainIcon, InfoIcon, WrenchIcon } from "lucide-react";
import { memo, useEffect, useRef } from "react";

import { cn } from "~/lib/utils";
import { useFullTranscript } from "../../hooks/useFullTranscript";
import { useEnvironmentSettings } from "../../hooks/useSettings";
import { workEntrySignalsSevereFailure, workLogEntryFromProjectedItem } from "../../session-logic";
import type { WorkLogEntry } from "../../session-logic";
import { useThreadStatus, useThreadVisibleTurnItems } from "../../state/entities";
import { formatShortTimestamp } from "../../timestampFormat";
import ChatMarkdown from "../ChatMarkdown";
import { V2ItemInspector } from "../chat/V2ItemInspector";

const AUTOFOLLOW_THRESHOLD_PX = 24;

const entryCache = new WeakMap<OrchestrationV2ProjectedTurnItem, WorkLogEntry>();

function cachedWorkLogEntry(row: OrchestrationV2ProjectedTurnItem): WorkLogEntry {
  const cached = entryCache.get(row);
  if (cached) return cached;
  const entry = workLogEntryFromProjectedItem(row);
  entryCache.set(row, entry);
  return entry;
}

function entryMessageText(entry: WorkLogEntry): string | null {
  const payload = entry.structuredPayload;
  if (payload?.type === "assistant_message" || payload?.type === "user_message") {
    return payload.text.trim() || null;
  }
  return null;
}

function entrySummary(entry: WorkLogEntry): string | null {
  if (entry.command) return entry.command;
  const firstLine = entry.detail?.split("\n").find((line) => line.trim().length > 0);
  return firstLine?.trim() ?? null;
}

function EntryToneIcon({ entry }: { readonly entry: WorkLogEntry }) {
  const severe = workEntrySignalsSevereFailure(entry);
  const className = cn(
    "mt-0.5 size-3.5 shrink-0",
    severe ? "text-destructive" : "text-muted-foreground",
  );
  if (entry.tone === "thinking") return <BrainIcon aria-hidden className={className} />;
  if (entry.tone === "tool") return <WrenchIcon aria-hidden className={className} />;
  return <InfoIcon aria-hidden className={className} />;
}

export const AgentLogRow = memo(function AgentLogRow(props: {
  readonly entry: WorkLogEntry;
  readonly timestampFormat: Parameters<typeof formatShortTimestamp>[1];
  readonly agentTitle?: string;
  readonly environmentId?: EnvironmentId | undefined;
  /** Renders the whole entry (full tool input and output, no clamps); needs `environmentId`. */
  readonly fullTranscript?: boolean | undefined;
}) {
  const { entry, environmentId } = props;
  const fullTranscript = props.fullTranscript === true && environmentId !== undefined;
  const message = entryMessageText(entry);
  const summary = message === null ? entrySummary(entry) : null;
  const severe = workEntrySignalsSevereFailure(entry);
  const reasoning = entry.itemType === "reasoning";
  const markdownThreadRef =
    entry.projectedItem && environmentId !== undefined
      ? {
          environmentId,
          threadId: entry.projectedItem.sourceThreadId,
        }
      : undefined;
  return (
    <div
      className="flex items-start gap-2 px-3 py-1 text-xs"
      data-agent-log-entry={entry.id}
      data-tone={entry.tone}
    >
      <EntryToneIcon entry={entry} />
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <div className="flex min-w-0 items-baseline gap-1.5">
          {props.agentTitle ? (
            <span className="max-w-[8rem] shrink-0 truncate rounded-sm bg-muted px-1 text-2xs text-muted-foreground">
              {props.agentTitle}
            </span>
          ) : null}
          {message === null ? (
            <span className={cn("min-w-0 truncate", severe && "text-destructive")}>
              {entry.label}
            </span>
          ) : (
            <span className="text-muted-foreground">
              {entry.itemType === "user_message" ? "Prompt" : "Reply"}
            </span>
          )}
        </div>
        {message !== null ? (
          <div
            className={cn("min-w-0 wrap-anywhere", !fullTranscript && "max-h-24 overflow-hidden")}
          >
            <ChatMarkdown text={message} cwd={undefined} threadRef={markdownThreadRef} />
          </div>
        ) : fullTranscript && entry.projectedItem && environmentId !== undefined ? (
          <div className="min-w-0 max-w-full overflow-x-auto">
            <V2ItemInspector projectedItem={entry.projectedItem} environmentId={environmentId} />
          </div>
        ) : reasoning && entry.detail ? (
          <span className="line-clamp-2 whitespace-pre-wrap italic text-muted-foreground wrap-anywhere">
            {entry.detail}
          </span>
        ) : summary ? (
          <span className="truncate font-mono text-2xs text-muted-foreground">{summary}</span>
        ) : null}
      </div>
      <span className="shrink-0 text-2xs tabular-nums text-muted-foreground">
        {formatShortTimestamp(entry.createdAt, props.timestampFormat)}
      </span>
    </div>
  );
});

export function AgentLog(props: { readonly childRef: ScopedThreadRef; readonly limit: number }) {
  const { childRef, limit } = props;
  const items = useThreadVisibleTurnItems(childRef);
  const status = useThreadStatus(childRef);
  const fullTranscript = useFullTranscript();
  const timestampFormat = useEnvironmentSettings(
    childRef.environmentId,
    (settings) => settings.timestampFormat,
  );
  const entries = items.slice(-limit).map(cachedWorkLogEntry);
  const scrollRef = useRef<HTMLDivElement>(null);
  const followingRef = useRef(true);
  const lastEntryId = entries.at(-1)?.id;

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- keeps the scroll position at the tail after new items commit
  useEffect(() => {
    const element = scrollRef.current;
    if (element !== null && lastEntryId !== undefined && followingRef.current) {
      element.scrollTop = element.scrollHeight;
    }
  }, [lastEntryId]);

  return (
    <div
      ref={scrollRef}
      className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto py-1"
      data-agent-log
      onScroll={(event) => {
        const element = event.currentTarget;
        followingRef.current =
          element.scrollHeight - element.scrollTop - element.clientHeight <=
          AUTOFOLLOW_THRESHOLD_PX;
      }}
    >
      {entries.length === 0 ? (
        <p className="px-3 py-2 text-xs text-muted-foreground">
          {status === "empty" || status === "synchronizing" ? "Loading…" : "No activity yet."}
        </p>
      ) : (
        entries.map((entry) => (
          <AgentLogRow
            key={entry.id}
            entry={entry}
            timestampFormat={timestampFormat}
            environmentId={childRef.environmentId}
            fullTranscript={fullTranscript}
          />
        ))
      )}
    </div>
  );
}
