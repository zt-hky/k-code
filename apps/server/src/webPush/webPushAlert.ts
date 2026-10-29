import type {
  EnvironmentId,
  OrchestrationV2ThreadShell,
  Project,
  ThreadId,
} from "@t3tools/contracts";
import {
  type ProjectThreadAwarenessV2Input,
  projectThreadAwarenessV2,
} from "@t3tools/shared/agentAwareness";
import * as DateTime from "effect/DateTime";

export type WebPushAlertThread = ProjectThreadAwarenessV2Input["thread"] &
  Pick<
    OrchestrationV2ThreadShell,
    "archivedAt" | "latestRunId" | "latestRunCompletedAt" | "pendingRuntimeRequest" | "lastError"
  >;

export type WebPushAlertKind = "completed" | "failed" | "input" | "approval";

export interface WebPushAlert {
  /** Identifies the occurrence, so one run or request alerts once. */
  readonly key: string;
  readonly kind: WebPushAlertKind;
  readonly title: string;
  readonly body: string;
  readonly tag: string;
  readonly url: string;
  readonly environmentId: EnvironmentId;
  readonly threadId: ThreadId;
}

export function resolveWebPushAlert(input: {
  readonly environmentId: EnvironmentId;
  readonly thread: WebPushAlertThread;
  readonly project: Pick<Project, "title">;
}): WebPushAlert | null {
  const { environmentId, thread } = input;
  if (thread.archivedAt !== null) return null;
  const awareness = projectThreadAwarenessV2(input);
  if (awareness === null) return null;
  const base = {
    body: thread.title,
    tag: `thread:${thread.id}`,
    url: `/${encodeURIComponent(environmentId)}/${encodeURIComponent(thread.id)}`,
    environmentId,
    threadId: thread.id,
  };
  switch (awareness.phase) {
    case "completed":
      return {
        ...base,
        key: `completed:${thread.latestRunId}`,
        kind: "completed",
        title: "Thread completed",
      };
    case "failed":
      return {
        ...base,
        body: webPushBody(thread.title, thread.lastError ?? undefined),
        key: `failed:${thread.latestRunId}`,
        kind: "failed",
        title: "Thread failed",
      };
    case "waiting_for_input":
      return {
        ...base,
        key: `input:${thread.pendingRuntimeRequest?.id}`,
        kind: "input",
        title: "Input needed",
      };
    case "waiting_for_approval":
      return {
        ...base,
        key: `approval:${thread.pendingRuntimeRequest?.id}`,
        kind: "approval",
        title: "Approval needed",
      };
    case "starting":
    case "running":
    case "stale":
      return null;
  }
}

// Lock screens show a few lines; longer text only costs push payload size.
const WEB_PUSH_DETAIL_MAX_CHARS = 280;

/** The thread title, then the start of `detail` on the following lines. */
export function webPushBody(threadTitle: string, detail: string | undefined): string {
  const text = detail?.replace(/\s+/g, " ").trim() ?? "";
  if (text.length === 0) return threadTitle;
  const clipped =
    text.length > WEB_PUSH_DETAIL_MAX_CHARS
      ? `${text.slice(0, WEB_PUSH_DETAIL_MAX_CHARS - 1).trimEnd()}…`
      : text;
  return `${threadTitle}\n${clipped}`;
}

/** "2 questions: 1. …  2. …" for an ask, listing each question text. */
export function webPushQuestionsDetail(
  questions: ReadonlyArray<{ readonly question: string }>,
): string | undefined {
  if (questions.length === 0) return undefined;
  if (questions.length === 1) return questions[0]!.question;
  return `${questions.length} questions: ${questions
    .map((entry, index) => `${index + 1}. ${entry.question}`)
    .join(" ")}`;
}

// Mirrors WORKING_EXIT_GRACE_MS: a run can end moments before its continuation starts.
export const WEB_PUSH_COMPLETION_GRACE_MS = 2_000;

export type WebPushAlertDecision =
  | { readonly _tag: "None" }
  | { readonly _tag: "Send"; readonly alert: WebPushAlert }
  | { readonly _tag: "Hold"; readonly delayMs: number };

const none: WebPushAlertDecision = { _tag: "None" };

function isFreshSince(
  thread: WebPushAlertThread,
  alert: WebPushAlert,
  startedAtMs: number,
): boolean {
  const at =
    alert.kind === "completed" || alert.kind === "failed"
      ? thread.latestRunCompletedAt
      : thread.pendingRuntimeRequest?.createdAt;
  return at != null && DateTime.toEpochMillis(at) > startedAtMs;
}

/** Decides when an observed alert should be pushed, once per occurrence. */
export function makeWebPushAlertTracker(startedAtMs: number) {
  const sent = new Map<ThreadId, string>();
  const held = new Map<ThreadId, { readonly key: string; readonly dueAtMs: number }>();
  return {
    observe(
      threadId: ThreadId,
      thread: WebPushAlertThread | null,
      alert: WebPushAlert | null,
      nowMs: number,
    ): WebPushAlertDecision {
      if (thread === null) {
        sent.delete(threadId);
        held.delete(threadId);
        return none;
      }
      if (alert === null || sent.get(threadId) === alert.key) {
        held.delete(threadId);
        return none;
      }
      // State from before this server started was already visible; a restart must not re-alert it.
      if (!sent.has(threadId) && !isFreshSince(thread, alert, startedAtMs)) {
        sent.set(threadId, alert.key);
        return none;
      }
      if (alert.kind === "completed") {
        const pending = held.get(threadId);
        if (pending === undefined || pending.key !== alert.key) {
          held.set(threadId, { key: alert.key, dueAtMs: nowMs + WEB_PUSH_COMPLETION_GRACE_MS });
          return { _tag: "Hold", delayMs: WEB_PUSH_COMPLETION_GRACE_MS };
        }
        if (nowMs < pending.dueAtMs) return none;
      }
      held.delete(threadId);
      sent.set(threadId, alert.key);
      return { _tag: "Send", alert };
    },
  };
}
