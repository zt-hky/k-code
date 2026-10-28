import {
  AuthOrchestrationOperateScope,
  type EnvironmentId,
  type OrchestrationV2RunStatus,
  type ProviderInteractionMode,
  type RuntimeMode,
} from "@t3tools/contracts";
import { scopedThreadKey, scopeThreadRef } from "@t3tools/client-runtime/environment";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
  type AtomCommandResult,
} from "@t3tools/client-runtime/state/runtime";
import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/shell";
import { useEffect, type Dispatch, type SetStateAction } from "react";
import { newMessageId } from "~/lib/utils";
import { useStableCallback } from "../../hooks/useStableCallback";
import type { ComposerHandleRef } from "../../composerHandleContext";
import { readEnvironmentScope } from "../../state/session";
import { threadEnvironment } from "../../state/threads";
import { useOrchestrationCommand } from "../../state/use-orchestration-command";
import type { ChatMessage } from "../../types";
import {
  formatOutgoingPrompt,
  withMessageContext,
  type makeThreadErrorSetter,
} from "../ChatView.logic";
import { stackedThreadToast, toastManager } from "../ui/toast";
import { draftSendState } from "./chatViewSend";
import { decideLoopAction, loopFinishedTitle, type LoopPrompt } from "./loopMode.logic";
import { useLoopModeStore } from "./loopModeStore";
import type { useLocalDispatchState } from "./useLocalDispatchState";
import type { useTimelineFollow } from "./useTimelineFollow";

type LocalDispatchState = ReturnType<typeof useLocalDispatchState>;

interface LoopModeInput {
  readonly environmentId: EnvironmentId;
  readonly routeThreadKey: string;
  readonly activeThread: EnvironmentThreadShell | undefined;
  readonly isServerThread: boolean;
  readonly latestRun: {
    readonly runId: string;
    readonly status: OrchestrationV2RunStatus;
  } | null;
  readonly hasPendingRequest: boolean;
  readonly isSendBusy: boolean;
  readonly isConnecting: boolean;
  readonly composerRef: ComposerHandleRef;
  readonly beginLocalDispatch: LocalDispatchState["beginLocalDispatch"];
  readonly resetLocalDispatch: LocalDispatchState["resetLocalDispatch"];
  readonly runtimeMode: RuntimeMode;
  readonly localCheckoutBranchMismatch: { readonly currentBranch: string } | null;
  readonly setOptimisticUserMessages: Dispatch<SetStateAction<ChatMessage[]>>;
  readonly setThreadError: ReturnType<typeof makeThreadErrorSetter>;
  readonly anchorNewTurn: ReturnType<typeof useTimelineFollow>["anchorNewTurn"];
  readonly persistThreadSettingsForNextTurn: (input: {
    threadId: EnvironmentThreadShell["id"];
    createdAt: string;
    branch?: string;
    runtimeMode: RuntimeMode;
    interactionMode: ProviderInteractionMode;
  }) => Promise<AtomCommandResult<void, unknown>>;
}

/**
 * Repeats the thread's loop prompt as a new turn each time a run completes. The prompt goes
 * out the way a plan follow-up does, straight to `startTurn`, so the composer draft is left
 * as the user has it.
 */
export function useLoopMode(input: LoopModeInput) {
  const {
    environmentId,
    routeThreadKey,
    activeThread,
    isServerThread,
    latestRun,
    hasPendingRequest,
    isSendBusy,
    isConnecting,
    composerRef,
    beginLocalDispatch,
    resetLocalDispatch,
    runtimeMode,
    localCheckoutBranchMismatch,
    setOptimisticUserMessages,
    setThreadError,
    anchorNewTurn,
    persistThreadSettingsForNextTurn,
  } = input;
  const loop = useLoopModeStore((state) => state.loops[routeThreadKey] ?? null);
  const startThreadTurn = useOrchestrationCommand(threadEnvironment.startTurn, {
    reportFailure: false,
  });
  const { sendInFlight: sendInFlightRef } = draftSendState(routeThreadKey);

  const stopLoop = () => useLoopModeStore.getState().disarm(routeThreadKey);

  const resend = async (prompt: LoopPrompt) => {
    const failLoop = () => {
      useLoopModeStore.getState().disarm(routeThreadKey);
      resetLocalDispatch();
      sendInFlightRef.current = false;
    };
    const sendCtx = composerRef.current?.getSendContext();
    if (!activeThread || !sendCtx?.providerAvailable) {
      useLoopModeStore.getState().disarm(routeThreadKey);
      toastManager.add(
        stackedThreadToast({
          type: "warning",
          title: "Loop stopped",
          description: "The provider is not available.",
        }),
      );
      return;
    }
    const threadId = activeThread.id;
    const messageId = newMessageId();
    const createdAt = new Date().toISOString();
    const text = formatOutgoingPrompt({
      provider: sendCtx.selectedProvider,
      model: sendCtx.selectedModel,
      models: sendCtx.selectedProviderModels,
      effort: sendCtx.selectedPromptEffort,
      text: prompt.text,
    });
    const message = withMessageContext({
      text,
      context: prompt.context,
    });

    sendInFlightRef.current = true;
    beginLocalDispatch({ preparingWorktree: false });
    setThreadError(threadId, null);
    anchorNewTurn(scopedThreadKey(scopeThreadRef(environmentId, threadId)), messageId);
    setOptimisticUserMessages((existing) => [
      ...existing,
      {
        id: messageId,
        role: "user",
        text,
        ...(prompt.context ? { context: prompt.context } : {}),
        runId: null,
        createdAt,
        updatedAt: createdAt,
        streaming: false,
      },
    ]);

    const settingsResult = await persistThreadSettingsForNextTurn({
      threadId,
      createdAt,
      ...(localCheckoutBranchMismatch ? { branch: localCheckoutBranchMismatch.currentBranch } : {}),
      runtimeMode,
      interactionMode: sendCtx.interactionMode,
    });
    const result =
      settingsResult._tag === "Failure"
        ? settingsResult
        : await startThreadTurn({
            environmentId,
            input: {
              threadId,
              message: { messageId, role: "user", attachments: [], ...message },
              modelSelection: sendCtx.selectedModelSelection,
              titleSeed: activeThread.title,
              runtimeMode,
              interactionMode: sendCtx.interactionMode,
              createdAt,
            },
          });
    if (result._tag === "Failure") {
      setOptimisticUserMessages((existing) => existing.filter((entry) => entry.id !== messageId));
      if (!isAtomCommandInterrupted(result)) {
        const error = squashAtomCommandFailure(result);
        setThreadError(threadId, error instanceof Error ? error.message : "Failed to repeat loop.");
      }
      failLoop();
      return;
    }
    sendInFlightRef.current = false;
    resetLocalDispatch();
  };

  const latestRunForLoop =
    latestRun === null ? null : { id: latestRun.runId, status: latestRun.status };
  const action = decideLoopAction({ loop, latestRun: latestRunForLoop, hasPendingRequest });
  const canResend =
    isServerThread &&
    !isSendBusy &&
    !isConnecting &&
    readEnvironmentScope(environmentId, AuthOrchestrationOperateScope);
  const runLoopAction = useStableCallback(() => {
    const store = useLoopModeStore.getState();
    // The store, not this render, says whether the run was already handled: an effect can run twice.
    const current = store.loops[routeThreadKey] ?? null;
    const next = decideLoopAction({
      loop: current,
      latestRun: latestRunForLoop,
      hasPendingRequest,
    });
    if (next.type === "disarm") {
      store.disarm(routeThreadKey);
      return;
    }
    if (next.type === "finish") {
      store.disarm(routeThreadKey);
      toastManager.add(
        stackedThreadToast({ type: "success", title: loopFinishedTitle(current?.iteration ?? 0) }),
      );
      return;
    }
    if (next.type !== "resend" || !current?.prompt || !latestRun || sendInFlightRef.current) return;
    store.advance(routeThreadKey, latestRun.runId);
    void resend(current.prompt);
  });
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- a run settling is a server event no handler in this view causes; the loop answers it with the next turn
  useEffect(() => {
    if (action.type === "resend" && !canResend) return;
    runLoopAction();
  }, [action.type, canResend, runLoopAction]);

  return { loop, stopLoop };
}
