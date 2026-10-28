import { EnvironmentId, ProviderInstanceId, ThreadId } from "@t3tools/contracts";
import { scopedThreadKey, scopeThreadRef } from "@t3tools/client-runtime/environment";
import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/shell";
import { createModelSelection } from "@t3tools/shared/model";
import { AsyncResult } from "effect/reactivity";
import { expect, it, vi } from "vite-plus/test";
import { page, userEvent } from "vite-plus/test/browser";

import { act, render } from "../../../test/render";
import type { ComposerHandleRef } from "../../composerHandleContext";
import { ComposerLoopControl } from "./ComposerLoopControl";
import { loopNowItem } from "./ThreadActivityBanners";
import { ThreadNow } from "./ThreadNow";
import { useLoopMode } from "./useLoopMode";
import { useLoopModeStore } from "./loopModeStore";

const state = vi.hoisted(() => ({ startTurn: vi.fn() }));

vi.mock(import("../../state/use-orchestration-command"), async (original) => ({
  ...(await original()),
  useOrchestrationCommand: (() => state.startTurn) as never,
}));
vi.mock(import("../../state/session"), async (original) => ({
  ...(await original()),
  readEnvironmentScope: () => true,
}));

const environmentId = EnvironmentId.make("local");
const threadId = ThreadId.make("loop-thread");
const threadKey = scopedThreadKey(scopeThreadRef(environmentId, threadId));
const thread = { id: threadId, title: "Loop thread" } as EnvironmentThreadShell;
const composerRef = {
  current: {
    getSendContext: () => ({
      providerAvailable: true,
      selectedProvider: "codex",
      selectedModel: "gpt-5",
      selectedProviderModels: [],
      selectedPromptEffort: null,
      selectedModelSelection: createModelSelection(ProviderInstanceId.make("codex"), "gpt-5"),
      interactionMode: "default",
    }),
  },
} as unknown as ComposerHandleRef;

type Run = { readonly runId: string; readonly status: "running" | "completed" } | null;

function Harness({ run }: { run: Run }) {
  const { loop, stopLoop } = useLoopMode({
    environmentId,
    routeThreadKey: threadKey,
    activeThread: thread,
    isServerThread: true,
    latestRun: run,
    hasPendingRequest: false,
    isSendBusy: false,
    isConnecting: false,
    composerRef,
    beginLocalDispatch: vi.fn(),
    resetLocalDispatch: vi.fn(),
    runtimeMode: "full-access",
    localCheckoutBranchMismatch: null,
    setOptimisticUserMessages: vi.fn(),
    setThreadError: vi.fn(),
    anchorNewTurn: vi.fn(),
    persistThreadSettingsForNextTurn: async () => AsyncResult.success(undefined),
  });
  return (
    <>
      <ComposerLoopControl threadKey={threadKey} />
      <ThreadNow
        attention={null}
        work={null}
        syncPhase={null}
        goal={null}
        loop={loop ? loopNowItem({ threadKey, loop, onStop: stopLoop }) : null}
      />
    </>
  );
}

function setup() {
  state.startTurn.mockReset().mockResolvedValue(AsyncResult.success(undefined));
  useLoopModeStore.setState({ loops: {} });
}

const sendFirstMessage = () =>
  act(async () => {
    useLoopModeStore
      .getState()
      .capture(threadKey, { text: "check the build\nthen report", context: undefined }, "run-0");
  });

it("repeats the prompt after each completed run, then finishes", async () => {
  setup();
  // The harness has no routes or links.
  await using screen = await render(<Harness run={null} />, { router: false });

  await userEvent.click(page.getByRole("button", { name: "Loop" }));
  await userEvent.click(page.getByRole("menuitemradio", { name: "3 times" }));
  await expect
    .element(page.getByRole("button", { name: "Loop ×3" }))
    .toHaveAttribute("aria-pressed", "true");

  await sendFirstMessage();
  await screen.rerender(<Harness run={{ runId: "run-1", status: "running" }} />);
  await expect.element(page.getByText(/Loop · run 1 of 3/)).toBeVisible();
  await expect.element(page.getByText(/check the build/)).toBeVisible();
  expect(state.startTurn).not.toHaveBeenCalled();

  await screen.rerender(<Harness run={{ runId: "run-1", status: "completed" }} />);
  await vi.waitFor(() => expect(state.startTurn).toHaveBeenCalledTimes(1));
  await screen.rerender(<Harness run={{ runId: "run-2", status: "completed" }} />);
  await vi.waitFor(() => expect(state.startTurn).toHaveBeenCalledTimes(2));
  await expect.element(page.getByText(/Loop · run 3 of 3/)).toBeVisible();
  expect(state.startTurn.mock.calls.map(([call]) => call.input.message.text)).toEqual([
    "check the build\nthen report",
    "check the build\nthen report",
  ]);

  await screen.rerender(<Harness run={{ runId: "run-3", status: "completed" }} />);
  await expect.element(page.getByText(/Loop · run 3 of 3/)).not.toBeInTheDocument();
  await expect.element(page.getByRole("button", { name: "Loop" })).toBeVisible();
  expect(state.startTurn).toHaveBeenCalledTimes(2);
});

it("stops repeating when the loop is stopped", async () => {
  setup();
  // The harness has no routes or links.
  await using screen = await render(<Harness run={null} />, { router: false });

  await userEvent.click(page.getByRole("button", { name: "Loop" }));
  await userEvent.click(page.getByRole("menuitemradio", { name: "Until stopped" }));
  await expect.element(page.getByRole("button", { name: "Loop ∞" })).toBeVisible();

  await sendFirstMessage();
  await screen.rerender(<Harness run={{ runId: "run-1", status: "running" }} />);
  await expect.element(page.getByText(/Loop · run 1/)).toBeVisible();

  await userEvent.click(page.getByRole("button", { name: "Stop loop" }));
  await expect.element(page.getByText(/Loop · run 1/)).not.toBeInTheDocument();

  await screen.rerender(<Harness run={{ runId: "run-1", status: "completed" }} />);
  expect(state.startTurn).not.toHaveBeenCalled();
});
