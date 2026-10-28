import { create } from "zustand";
import type { LoopPrompt, LoopSlashCommand, LoopState } from "./loopMode.logic";

/** Loops live on the client that armed them and are keyed by `scopedThreadKey`. */
interface LoopModeStore {
  readonly loops: Readonly<Record<string, LoopState>>;
  /** `runs` counts every run, including the one the next message starts; null repeats until stopped. */
  readonly arm: (threadKey: string, runs: number | null) => void;
  /** Takes the next message sent from the thread as the loop's prompt, once. */
  readonly capture: (
    threadKey: string,
    prompt: LoopPrompt,
    baselineRunId: string | null,
  ) => boolean;
  /** Records that `handledRunId` led to another run. */
  readonly advance: (threadKey: string, handledRunId: string) => void;
  readonly disarm: (threadKey: string) => void;
}

function withLoop(
  loops: LoopModeStore["loops"],
  threadKey: string,
  update: (loop: LoopState) => LoopState,
): LoopModeStore["loops"] {
  const loop = loops[threadKey];
  return loop === undefined ? loops : { ...loops, [threadKey]: update(loop) };
}

export const useLoopModeStore = create<LoopModeStore>((set, get) => ({
  loops: {},
  arm: (threadKey, runs) =>
    set((state) => ({
      loops: {
        ...state.loops,
        [threadKey]: { prompt: null, remaining: runs, iteration: 0, lastHandledRunId: null },
      },
    })),
  capture: (threadKey, prompt, baselineRunId) => {
    if (get().loops[threadKey]?.prompt !== null) return false;
    set((state) => ({
      loops: withLoop(state.loops, threadKey, (loop) => ({
        prompt,
        remaining: loop.remaining === null ? null : Math.max(0, loop.remaining - 1),
        iteration: 1,
        lastHandledRunId: baselineRunId,
      })),
    }));
    return true;
  },
  advance: (threadKey, handledRunId) =>
    set((state) => ({
      loops: withLoop(state.loops, threadKey, (loop) => ({
        ...loop,
        remaining: loop.remaining === null ? null : Math.max(0, loop.remaining - 1),
        iteration: loop.iteration + 1,
        lastHandledRunId: handledRunId,
      })),
    })),
  disarm: (threadKey) =>
    set((state) => {
      if (state.loops[threadKey] === undefined) return state;
      const { [threadKey]: _removed, ...loops } = state.loops;
      return { loops };
    }),
}));

export function applyLoopSlashCommand(threadKey: string, command: LoopSlashCommand) {
  const { loops, arm, disarm } = useLoopModeStore.getState();
  if (command.kind === "runs") {
    if (command.runs === 0) disarm(threadKey);
    else arm(threadKey, command.runs);
    return;
  }
  if (loops[threadKey] === undefined) arm(threadKey, null);
  else disarm(threadKey);
}
