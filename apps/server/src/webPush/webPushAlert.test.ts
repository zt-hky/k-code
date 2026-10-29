import { describe, expect, it } from "@effect/vitest";
import {
  type EnvironmentId,
  ProviderInstanceId,
  RunId,
  RuntimeRequestId,
  type ThreadId,
} from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";

import {
  makeWebPushAlertTracker,
  resolveWebPushAlert,
  WEB_PUSH_COMPLETION_GRACE_MS,
  type WebPushAlertThread,
  webPushBody,
  webPushQuestionsDetail,
} from "./webPushAlert.ts";

const environmentId = "env-1" as EnvironmentId;
const threadId = "thread-1" as ThreadId;
const project = { title: "t3code" };
const STARTED_AT = Date.parse("2026-05-22T12:00:00.000Z");
const at = (offsetMs: number) => DateTime.makeUnsafe(STARTED_AT + offsetMs);

const thread = (overrides: Partial<WebPushAlertThread> = {}): WebPushAlertThread => ({
  id: threadId,
  lineage: { rootThreadId: threadId, parentThreadId: null, relationshipToParent: null },
  title: "Fix the flaky test",
  modelSelection: { instanceId: ProviderInstanceId.make("codex"), model: "gpt-5.4" },
  status: "running",
  pendingRuntimeRequest: null,
  settledOverride: null,
  updatedAt: at(0),
  archivedAt: null,
  latestRunId: RunId.make("run-1"),
  latestRunCompletedAt: null,
  ...overrides,
});

const completed = (runId: string, completedAtOffset: number) =>
  thread({
    status: "completed",
    latestRunId: RunId.make(runId),
    latestRunCompletedAt: at(completedAtOffset),
  });

const waitingForInput = (requestId: string) =>
  thread({
    pendingRuntimeRequest: {
      id: RuntimeRequestId.make(requestId),
      kind: "user_input",
      createdAt: at(1_000),
    },
  });

function observer() {
  const tracker = makeWebPushAlertTracker(STARTED_AT);
  return (shell: WebPushAlertThread | null, nowMs: number) => {
    const decision = tracker.observe(
      threadId,
      shell,
      shell === null ? null : resolveWebPushAlert({ environmentId, thread: shell, project }),
      STARTED_AT + nowMs,
    );
    return decision._tag === "Send" ? `Send:${decision.alert.title}` : decision._tag;
  };
}

describe("web push alerts", () => {
  it("holds a completion for the grace period, then sends it once", () => {
    const observe = observer();
    expect(observe(thread(), 0)).toBe("None");
    expect(observe(completed("run-1", 1_000), 1_000)).toBe("Hold");
    expect(observe(completed("run-1", 1_000), 1_000 + WEB_PUSH_COMPLETION_GRACE_MS - 1)).toBe(
      "None",
    );
    expect(observe(completed("run-1", 1_000), 1_000 + WEB_PUSH_COMPLETION_GRACE_MS)).toBe(
      "Send:Thread completed",
    );
    expect(observe(completed("run-1", 1_000), 10_000)).toBe("None");
  });

  it("drops a completion when a continuation starts during the grace period", () => {
    const observe = observer();
    expect(observe(completed("run-1", 1_000), 1_000)).toBe("Hold");
    expect(observe(thread({ latestRunId: RunId.make("run-2") }), 1_500)).toBe("None");
    expect(observe(thread({ latestRunId: RunId.make("run-2") }), 5_000)).toBe("None");
    expect(observe(completed("run-2", 6_000), 6_000)).toBe("Hold");
  });

  it("sends attention immediately, once per request", () => {
    const observe = observer();
    expect(observe(waitingForInput("request-1"), 1_000)).toBe("Send:Input needed");
    expect(observe(waitingForInput("request-1"), 2_000)).toBe("None");
    expect(observe(waitingForInput("request-2"), 3_000)).toBe("Send:Input needed");
    expect(observe(thread({ status: "failed", latestRunCompletedAt: at(4_000) }), 4_000)).toBe(
      "Send:Thread failed",
    );
  });

  it("does not re-alert state from before the server started", () => {
    const observe = observer();
    expect(observe(completed("run-1", -60_000), 0)).toBe("None");
    expect(observe(completed("run-1", -60_000), 10_000)).toBe("None");
    expect(observe(completed("run-2", 20_000), 20_000)).toBe("Hold");
  });

  it("never alerts archived threads", () => {
    expect(
      resolveWebPushAlert({
        environmentId,
        project,
        thread: { ...completed("run-1", 1_000), archivedAt: at(2_000) },
      }),
    ).toBeNull();
  });
});

describe("web push notification body", () => {
  it("shows the start of the latest reply, the error, or the questions", () => {
    const reply = "word ".repeat(100);
    const body = webPushBody("Fix the flaky test", reply);
    expect(body?.startsWith("Fix the flaky test\nword word")).toBe(true);
    expect(body?.endsWith("…")).toBe(true);
    expect(body!.length).toBeLessThanOrEqual("Fix the flaky test\n".length + 280);

    expect(
      resolveWebPushAlert({
        environmentId,
        project,
        thread: thread({
          status: "failed",
          latestRunCompletedAt: at(1_000),
          lastError: "Rate limited",
        }),
      })?.body,
    ).toBe("Fix the flaky test\nRate limited");

    expect(webPushQuestionsDetail([{ question: "Which DB?" }])).toBe("Which DB?");
    expect(webPushQuestionsDetail([{ question: "Which DB?" }, { question: "Rebase?" }])).toBe(
      "2 questions: 1. Which DB? 2. Rebase?",
    );
    expect(webPushBody("Title", undefined)).toBe("Title");
  });
});
