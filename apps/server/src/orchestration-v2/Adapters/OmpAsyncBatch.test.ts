import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, describe, it } from "@effect/vitest";
import {
  ProviderDriverKind,
  ProviderInstanceId,
  ProviderSessionId,
  ThreadId,
  type OrchestrationV2Subagent,
} from "@t3tools/contracts";
import { AcpRegistryCatalog } from "@t3tools/provider-acp-registry/server/AcpRegistrySupport";
import * as IdAllocator from "@t3tools/provider-core/server/IdAllocator";
import * as McpProviderSessions from "@t3tools/provider-core/server/McpProviderSessions";
import * as ProviderAdapter from "@t3tools/provider-core/server/ProviderAdapter";
import { OhMyPiSettings } from "@t3tools/provider-ohmypi/settings";
import { makeOhMyPiAdapterV2 } from "@t3tools/provider-ohmypi/testing";
import * as TestProviderHost from "@t3tools/provider-testing/TestProviderHost";
import { resolveSelfInvocation } from "@t3tools/shared/nodeRuntime";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as Queue from "effect/Queue";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import * as ChildProcessSpawner from "effect/process/ChildProcessSpawner";

import * as DocumentText from "../../provider/DocumentText.ts";
import {
  decodeAcpReplayTranscript,
  makeAcpReplayRuntime,
  makeTurnInput,
} from "./AcpAdapterV2.testkit.ts";
import { OMP_ASYNC_BATCH_FRAMES } from "./OmpAsyncBatchFrames.fixture.ts";

const OMP_SETTINGS = Schema.decodeSync(OhMyPiSettings)({});
const layerTest = Layer.mergeAll(
  DocumentText.layer.pipe(Layer.provide(NodeServices.layer)),
  NodeServices.layer,
  IdAllocator.layer,
  McpProviderSessions.layer,
  TestProviderHost.layer().pipe(Layer.provide(NodeServices.layer)),
);

const SESSION_ID = "omp-session";
type Frame = (typeof OMP_ASYNC_BATCH_FRAMES)[number];
const withProgress = (
  base: Frame,
  statuses: ReadonlyArray<string>,
  patch: { readonly status?: string; readonly asyncState?: string },
): Frame =>
  ({
    ...base,
    ...(patch.status === undefined ? {} : { status: patch.status }),
    rawOutput: {
      ...(base as { rawOutput: { details: Record<string, unknown> } }).rawOutput,
      details: {
        ...(base as { rawOutput: { details: Record<string, unknown> } }).rawOutput.details,
        progress: (
          base as { rawOutput: { details: { progress: ReadonlyArray<Record<string, unknown>> } } }
        ).rawOutput.details.progress.map((entry, index) => ({ ...entry, status: statuses[index] })),
        async: {
          ...(base as { rawOutput: { details: { async: Record<string, unknown> } } }).rawOutput
            .details.async,
          ...(patch.asyncState === undefined ? {} : { state: patch.asyncState }),
        },
      },
    },
  }) as unknown as Frame;
// omp's progress for a stop that settles promptly (the captured run's stopped agent only settled
// when its own background bash job ended, ~75s later).
const STOP_FRAMES: ReadonlyArray<Frame> = [
  ...OMP_ASYNC_BATCH_FRAMES.slice(0, 6),
  withProgress(OMP_ASYNC_BATCH_FRAMES[5], ["aborted", "running"], {}),
  withProgress(OMP_ASYNC_BATCH_FRAMES[7], ["aborted", "completed"], {
    status: "failed",
    asyncState: "failed",
  }),
];
const frame = (index: number, frames: ReadonlyArray<Frame>) => ({
  type: "emit_inbound" as const,
  frame: {
    kind: "notification" as const,
    method: "session/update",
    params: { sessionId: SESSION_ID, update: frames[index] },
  },
});

/** Replays the captured frames: `inTurn` before the prompt resolves, `late` after it. */
const replayBatch = (
  name: string,
  input: { inTurn: number; late: number; frames: ReadonlyArray<Frame> },
) =>
  Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const directory = yield* fileSystem.makeTempDirectoryScoped({ prefix: "t3-omp-batch-" });
    const driver = ProviderDriverKind.make("ohMyPi");
    const range = (from: number, to: number) =>
      Array.from({ length: Math.max(0, to - from) }, (_, offset) =>
        frame(from + offset, input.frames),
      );
    const transcript = yield* decodeAcpReplayTranscript(
      {
        provider: driver,
        protocol: "acp.ndjson-jsonrpc",
        version: "1",
        scenario: name,
        entries: [
          {
            type: "expect_outbound",
            frame: { kind: "request", method: "initialize", params: "<any>" },
          },
          {
            type: "emit_inbound",
            frame: {
              kind: "response",
              method: "initialize",
              result: { protocolVersion: 1, agentCapabilities: {}, authMethods: [] },
            },
          },
          {
            type: "expect_outbound",
            frame: { kind: "request", method: "session/new", params: "<any>" },
          },
          {
            type: "emit_inbound",
            frame: { kind: "response", method: "session/new", result: { sessionId: SESSION_ID } },
          },
          {
            type: "expect_outbound",
            frame: { kind: "request", method: "session/prompt", params: "<any>" },
          },
          ...range(0, input.inTurn),
          {
            type: "emit_inbound",
            frame: {
              kind: "response",
              method: "session/prompt",
              result: { stopReason: "end_turn" },
            },
          },
          ...range(input.inTurn, input.inTurn + input.late),
        ],
      },
      driver,
      { retargetProvider: true },
    );
    const instanceId = ProviderInstanceId.make(`omp-${name}`);
    const adapter = yield* makeOhMyPiAdapterV2({
      instanceId,
      selfInvocation: yield* resolveSelfInvocation(),
      settings: OMP_SETTINGS,
      environment: {},
      makeRuntime: makeAcpReplayRuntime({
        transcript,
        statusPath: path.join(directory, "status.json"),
        fileSystem,
        scriptPath: yield* path.fromFileUrl(
          new URL("../../../scripts/acp-replay-agent.ts", import.meta.url),
        ),
        childProcessSpawner: yield* ChildProcessSpawner.ChildProcessSpawner,
      }),
    }).pipe(
      Effect.provide(
        Layer.mock(AcpRegistryCatalog)({ resolve: () => Effect.die("runtime is injected") }),
      ),
    );
    const threadId = ThreadId.make(`omp-${name}-thread`);
    const modelSelection = { instanceId, model: "default" } as const;
    const runtimePolicy = ProviderAdapter.ProviderAdapterV2RuntimePolicy.make({
      runtimeMode: "full-access",
      interactionMode: "default",
      cwd: directory,
    });
    const runtime = yield* adapter.openSession({
      threadId,
      modelSelection,
      runtimePolicy,
      providerSessionId: ProviderSessionId.make(`omp-${name}-session`),
    });
    const events = yield* Queue.unbounded<ProviderAdapter.ProviderAdapterV2Event>();
    yield* runtime.events.pipe(
      Stream.runForEach((event) => Queue.offer(events, event)),
      Effect.forkScoped,
    );
    const providerThread = yield* runtime.ensureThread({ threadId, modelSelection, runtimePolicy });
    yield* runtime.startTurn(
      makeTurnInput({
        threadId,
        providerThread,
        instanceId,
        runtimePolicy,
        now: yield* DateTime.now,
      }),
    );
    // Statuses each child went through, in order, until the replay goes quiet.
    const history = new Map<string, Array<OrchestrationV2Subagent["status"]>>();
    const transitions: Array<string> = [];
    let terminal: string | undefined;
    while (true) {
      const event = yield* Queue.take(events).pipe(Effect.timeoutOption("2 seconds"));
      if (event._tag === "None") break;
      const value = event.value;
      if (value.type === "turn.terminal") terminal = value.status;
      if (value.type === "subagent.updated") {
        const id = value.subagent.nativeTaskRef?.nativeId ?? "";
        const list = history.get(id) ?? [];
        if (list.at(-1) !== value.subagent.status) {
          list.push(value.subagent.status);
          transitions.push(`${id.split(":").at(-1)}:${value.subagent.status}`);
        }
        history.set(id, list);
      }
    }
    return { history, terminal, transitions };
  });

const batchKey = (index: number) => `${OMP_ASYNC_BATCH_FRAMES[0].toolCallId}:batch:${index}`;

describe("omp async batch (frames captured from omp acp)", () => {
  it.live("settles each child from its own progress when one agent is stopped", () =>
    Effect.gen(function* () {
      // omp: the call returns at once (tool `completed`, async `running`, progress `pending`),
      // progress turns `aborted` for the stopped agent while its sibling runs, and the final
      // frame is tool `failed` / async `failed` with `[aborted, completed]`.
      const result = yield* replayBatch("stop-in-turn", {
        inTurn: STOP_FRAMES.length,
        late: 0,
        frames: STOP_FRAMES,
      });
      assert.deepEqual(result.history.get(batchKey(0))?.at(-1), "cancelled");
      assert.deepEqual(result.history.get(batchKey(1))?.at(-1), "completed");
      // The sibling stays live until its own settle frame, which comes after the stop.
      assert.isBelow(
        result.transitions.indexOf("0:cancelled"),
        result.transitions.indexOf("1:completed"),
      );
      assert.equal(result.terminal, "completed");
    }).pipe(Effect.provide(layerTest), Effect.scoped),
  );

  it.live(
    "never re-queues a started child when the tool-end frame replays spawn-time progress",
    () =>
      Effect.gen(function* () {
        const result = yield* replayBatch("no-requeue", {
          inTurn: OMP_ASYNC_BATCH_FRAMES.length,
          late: 0,
          frames: OMP_ASYNC_BATCH_FRAMES,
        });
        for (const index of [0, 1]) {
          const statuses = result.history.get(batchKey(index)) ?? [];
          assert.isFalse(
            statuses.slice(statuses.indexOf("running")).includes("pending"),
            `child ${index} went back to pending: ${statuses.join(",")}`,
          );
        }
        assert.equal(result.history.get(batchKey(0))?.at(-1), "cancelled");
        assert.equal(result.history.get(batchKey(1))?.at(-1), "completed");
      }).pipe(Effect.provide(layerTest), Effect.scoped),
  );

  it.live("keeps both children running when the turn ends before any agent settles", () =>
    Effect.gen(function* () {
      const result = yield* replayBatch("turn-ends-early", {
        inTurn: 5,
        late: 0,
        frames: OMP_ASYNC_BATCH_FRAMES,
      });
      assert.equal(result.terminal, "completed");
      assert.equal(result.history.get(batchKey(0))?.at(-1), "running");
      assert.equal(result.history.get(batchKey(1))?.at(-1), "running");
    }).pipe(Effect.provide(layerTest), Effect.scoped),
  );

  it.live("applies only the stopped child's terminal from a post-turn frame", () =>
    Effect.gen(function* () {
      const result = yield* replayBatch("late-stop", {
        inTurn: 6,
        late: 1,
        frames: STOP_FRAMES,
      });
      assert.equal(result.history.get(batchKey(0))?.at(-1), "cancelled");
      assert.equal(result.history.get(batchKey(1))?.at(-1), "running");
    }).pipe(Effect.provide(layerTest), Effect.scoped),
  );

  it.live("settles the sibling from the final post-turn frame", () =>
    Effect.gen(function* () {
      const result = yield* replayBatch("late-settle", {
        inTurn: 6,
        late: 2,
        frames: STOP_FRAMES,
      });
      assert.equal(result.history.get(batchKey(0))?.at(-1), "cancelled");
      assert.equal(result.history.get(batchKey(1))?.at(-1), "completed");
    }).pipe(Effect.provide(layerTest), Effect.scoped),
  );
});
