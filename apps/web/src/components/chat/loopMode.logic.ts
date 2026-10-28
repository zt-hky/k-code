import type { OrchestrationMessageContext, OrchestrationV2RunStatus } from "@t3tools/contracts";

export interface LoopPrompt {
  readonly text: string;
  readonly context: OrchestrationMessageContext | undefined;
}

/** `remaining` counts the runs still to start after the current one; null repeats until stopped. */
export interface LoopState {
  readonly prompt: LoopPrompt | null;
  readonly remaining: number | null;
  readonly iteration: number;
  /** The newest run the loop has already acted on or must ignore; it is never acted on twice. */
  readonly lastHandledRunId: string | null;
}

export type LoopAction =
  | { readonly type: "wait" }
  | { readonly type: "resend" }
  | { readonly type: "finish" }
  | { readonly type: "disarm" };

const WAIT: LoopAction = { type: "wait" };

const ENDED_UNSUCCESSFULLY: Partial<Record<OrchestrationV2RunStatus, true>> = {
  failed: true,
  interrupted: true,
  cancelled: true,
  rolled_back: true,
};

export function decideLoopAction(input: {
  readonly loop: LoopState | null;
  readonly latestRun: { readonly id: string; readonly status: OrchestrationV2RunStatus } | null;
  readonly hasPendingRequest: boolean;
}): LoopAction {
  const { loop, latestRun, hasPendingRequest } = input;
  if (loop === null || loop.prompt === null || latestRun === null) return WAIT;
  if (latestRun.id === loop.lastHandledRunId) return WAIT;
  if (ENDED_UNSUCCESSFULLY[latestRun.status]) return { type: "disarm" };
  if (latestRun.status !== "completed" || hasPendingRequest) return WAIT;
  return loop.remaining === 0 ? { type: "finish" } : { type: "resend" };
}

export type LoopSlashCommand =
  | { readonly kind: "toggle" }
  | { readonly kind: "runs"; runs: number };

/** `/loop` toggles the loop; `/loop 5` repeats five runs in all, and `/loop 0` turns it off. */
export function parseLoopSlashCommand(text: string): LoopSlashCommand | null {
  const match = /^\/loop(?:\s+(\d{1,3}))?\s*$/i.exec(text.trim());
  if (!match) return null;
  return match[1] === undefined ? { kind: "toggle" } : { kind: "runs", runs: Number(match[1]) };
}

export function loopTitle(loop: Pick<LoopState, "iteration" | "remaining">): string {
  return loop.remaining === null
    ? `Loop · run ${loop.iteration}`
    : `Loop · run ${loop.iteration} of ${loop.iteration + loop.remaining}`;
}

/** The control's label: the runs the loop was armed for, or ∞ when it repeats until stopped. */
export function loopControlLabel(loop: Pick<LoopState, "iteration" | "remaining">): string {
  return loop.remaining === null ? "Loop ∞" : `Loop ×${loop.iteration + loop.remaining}`;
}

export function loopFinishedTitle(runs: number): string {
  return `Loop finished (${runs} ${runs === 1 ? "run" : "runs"})`;
}
