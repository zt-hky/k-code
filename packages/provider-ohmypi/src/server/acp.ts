import type {
  AcpAdapterV2Flavor,
  AcpSubagentTranscriptEntry,
} from "@t3tools/provider-acp/server/adapter";
import * as Effect from "effect/Effect";
import type * as FileSystem from "effect/FileSystem";
import * as Option from "effect/Option";
import type * as Path from "effect/Path";
import * as Predicate from "effect/Predicate";
import * as Schema from "effect/Schema";

export const OMP_MODE_OPTION_ID = "mode";

const OMP_PLAN_PATH = /(?:^|[\\/:])[^\\/:]*plan\.md$/i;
const OMP_PLAN_LOCAL_PATH = /^local:\/\/.*plan\.md$/i;
const OMP_PLAN_APPROVAL_MESSAGE = /^Approve plan "[^"]*" and start implementation\?/;
// Explicit thinking levels omp may append to a resolved model string.
const OMP_MODEL_THINKING_SUFFIX = /:(off|minimal|low|medium|high|xhigh|max|auto)$/;
const OMP_APPROVE_VALUE = "Approve and execute";

const asRecord = (value: unknown): Record<string, unknown> | undefined =>
  Predicate.isObject(value) && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;

const nonEmptyString = (value: unknown): string | undefined =>
  typeof value === "string" && value.trim().length > 0 ? value : undefined;

// omp writes the plan through its write tool (`local://…-plan.md`) and revises it with edit calls.
export const extractOmpProposedPlanMarkdown: NonNullable<
  AcpAdapterV2Flavor["extractProposedPlanMarkdown"]
> = (toolCall) => {
  const rawInput = asRecord(toolCall.data.rawInput);
  const inputPath = nonEmptyString(rawInput?.path);
  const inputContent = nonEmptyString(rawInput?.content);
  if (
    inputPath !== undefined &&
    inputContent !== undefined &&
    OMP_PLAN_LOCAL_PATH.test(inputPath)
  ) {
    return inputContent;
  }
  const details = asRecord(asRecord(toolCall.data.rawOutput)?.details);
  const newText = nonEmptyString(details?.newText);
  if (newText === undefined) return undefined;
  const detailPath = nonEmptyString(details?.resolvedPath) ?? nonEmptyString(details?.path);
  return detailPath !== undefined && OMP_PLAN_PATH.test(detailPath) ? newText : undefined;
};

// omp's native approval gate; T3's Implement action replaces it in plan mode.
export const extractOmpPlanApprovalElicitation: NonNullable<
  AcpAdapterV2Flavor["planApprovalElicitation"]
> = (request) => {
  if (request.mode !== "form" || !OMP_PLAN_APPROVAL_MESSAGE.test(request.message)) return undefined;
  const values = asRecord(asRecord(asRecord(request.requestedSchema)?.properties)?.value);
  const options = Array.isArray(values?.enum) ? values.enum : [];
  if (!options.includes(OMP_APPROVE_VALUE)) return undefined;
  const lines = request.message.split("\n").slice(1);
  if (lines.at(-1)?.trim() === "…") lines.pop();
  return { excerptMarkdown: lines.join("\n") };
};

export const OMP_PROJECTS_LIST_METHOD = "_omp/projects/list";
export const OMP_EXTENSIONS_METHOD = "_omp/extensions";
export const OMP_EXTENSIONS_TOGGLE_METHOD = "_omp/extensions/toggle";

const recordList = (value: unknown): ReadonlyArray<Record<string, unknown>> =>
  Array.isArray(value)
    ? value.flatMap((entry) => {
        const record = asRecord(entry);
        return record === undefined ? [] : [record];
      })
    : [];

const ompToolContentText = (value: unknown): string | undefined => {
  if (!Array.isArray(value)) return undefined;
  for (const entry of value) {
    const record = asRecord(entry);
    const text = nonEmptyString(record?.text) ?? nonEmptyString(asRecord(record?.content)?.text);
    if (text !== undefined) return text;
  }
  return undefined;
};

// omp sends no tool name; the `task` tool is recognized by its argument shape.
export const extractOmpSubagentUpdate: NonNullable<AcpAdapterV2Flavor["extractSubagentUpdate"]> = (
  tool,
) => {
  const rawInput = asRecord(tool.data.rawInput);
  if (rawInput === undefined) return undefined;
  const batch = Array.isArray(rawInput.tasks) ? rawInput.tasks : undefined;
  const isSingle = typeof rawInput.task === "string" && typeof rawInput.solutionSpace === "string";
  const isBatch =
    batch !== undefined && batch.every((entry) => typeof asRecord(entry)?.task === "string");
  if (!isSingle && !isBatch) return undefined;

  const rawOutput = asRecord(tool.data.rawOutput);
  const details = asRecord(rawOutput?.details);
  const results = recordList(details?.results);
  const progress = recordList(details?.progress);
  const asyncState = asRecord(details?.async)?.state;

  const prompt = isSingle
    ? (rawInput.task as string)
    : (batch ?? []).map((entry, index) => `${index + 1}. ${asRecord(entry)?.task}`).join("\n");
  const title = isSingle
    ? (nonEmptyString(rawInput.name) ??
      nonEmptyString(progress[0]?.description) ??
      nonEmptyString(rawInput.agent) ??
      null)
    : (nonEmptyString(tool.title) ?? `${batch?.length ?? 0} agents`);
  const agentProgress = progress.find((entry) => entry.status === "running") ?? progress[0];
  const resolvedModel =
    nonEmptyString(results[0]?.resolvedModel) ??
    nonEmptyString(agentProgress?.resolvedModel) ??
    nonEmptyString(rawInput.model) ??
    null;
  // omp suffixes `resolvedModel` with `:<level>` when the level was set explicitly.
  const model = resolvedModel?.replace(OMP_MODEL_THINKING_SUFFIX, "") ?? null;
  const reasoningEffort =
    nonEmptyString(results[0]?.resolvedThinkingLevel) ??
    nonEmptyString(agentProgress?.resolvedThinkingLevel) ??
    OMP_MODEL_THINKING_SUFFIX.exec(resolvedModel ?? "")?.[1] ??
    null;

  const status = ((): "running" | "failed" | "cancelled" | "completed" => {
    if (tool.status === "failed") return "failed";
    if (asyncState === "running") return "running";
    if (asyncState === "failed") return "failed";
    if (results.some((entry) => entry.aborted === true)) return "cancelled";
    if (tool.status === "completed") {
      return results.some(
        (entry) =>
          (typeof entry.exitCode === "number" && entry.exitCode !== 0) ||
          typeof entry.error === "string",
      )
        ? "failed"
        : "completed";
    }
    return "running";
  })();

  let result: string | null = null;
  if (status !== "running") {
    const parts = results.flatMap((entry) => {
      const text = nonEmptyString(entry.output) ?? nonEmptyString(entry.error);
      if (text === undefined) return [];
      const agent = nonEmptyString(entry.agent);
      return [isBatch && !isSingle && agent !== undefined ? `${agent}: ${text}` : text];
    });
    result =
      parts.length > 0 ? parts.join("\n\n") : (ompToolContentText(rawOutput?.content) ?? null);
  }

  const currentTool = nonEmptyString(agentProgress?.currentTool);
  const currentToolArgs = nonEmptyString(agentProgress?.currentToolArgs);
  const activity =
    status !== "running"
      ? null
      : currentTool !== undefined
        ? currentToolArgs === undefined
          ? currentTool
          : `${currentTool}: ${currentToolArgs}`
        : (nonEmptyString(agentProgress?.lastIntent) ??
          nonEmptyString(
            Array.isArray(agentProgress?.recentOutput) ? agentProgress.recentOutput[0] : undefined,
          ) ??
          null);

  const transcriptAgentIds = [
    ...new Set(
      [...progress, ...results].flatMap((entry) => {
        const id = nonEmptyString(entry.id);
        return id === undefined ? [] : [id];
      }),
    ),
  ];

  return {
    nativeTaskId: tool.toolCallId,
    childSessionId: null,
    prompt,
    title,
    model,
    status,
    result,
    progress: activity,
    reasoningEffort,
    ...(transcriptAgentIds.length === 0 ? {} : { transcriptAgentIds }),
  };
};

const decodeJsonLine = Schema.decodeUnknownOption(Schema.fromJsonString(Schema.Unknown));
const NEWLINE = 0x0a;
const textDecoder = new TextDecoder();

/** Maps one line of an omp session file (`<agentId>.jsonl`) to transcript entries. */
function ompTranscriptEntries(
  agentId: string,
  line: string,
): ReadonlyArray<AcpSubagentTranscriptEntry> {
  const entry = asRecord(Option.getOrUndefined(decodeJsonLine(line)));
  const message = asRecord(entry?.message);
  if (entry?.type !== "message" || message === undefined) return [];
  const lineId = nonEmptyString(entry.id) ?? "";
  if (message.role === "toolResult") {
    const toolCallId = nonEmptyString(message.toolCallId);
    if (toolCallId === undefined) return [];
    return [
      {
        type: "tool",
        toolCall: {
          toolCallId,
          status: message.isError === true ? "failed" : "completed",
          data: { rawOutput: { content: message.content, details: message.details } },
        },
      },
    ];
  }
  if (message.role !== "assistant" || !Array.isArray(message.content)) return [];
  return message.content.flatMap((part, index): ReadonlyArray<AcpSubagentTranscriptEntry> => {
    const record = asRecord(part);
    const nativeId = `${agentId}:${lineId}:${index}`;
    switch (record?.type) {
      case "text": {
        const text = nonEmptyString(record.text);
        return text === undefined ? [] : [{ type: "assistant", nativeId, text }];
      }
      case "thinking": {
        const text = nonEmptyString(record.thinking);
        return text === undefined ? [] : [{ type: "reasoning", nativeId, text }];
      }
      case "toolCall": {
        const toolCallId = nonEmptyString(record.id);
        const name = nonEmptyString(record.name);
        if (toolCallId === undefined || name === undefined) return [];
        return [
          {
            type: "tool",
            toolCall: {
              toolCallId,
              title: nonEmptyString(record.intent) ?? name,
              kind: name,
              status: "inProgress",
              data: { rawInput: record.arguments ?? {} },
            },
          },
        ];
      }
      default:
        return [];
    }
  });
}

/**
 * omp runs subagents in-process and streams none of their work over ACP, but it saves each
 * child's session beside the parent's: `<agentDir>/sessions/<cwd>/<stamp>_<sessionId>/<agentId>.jsonl`.
 */
export function makeOmpSubagentTranscriptReader(input: {
  readonly fileSystem: FileSystem.FileSystem;
  readonly path: Path.Path;
  readonly agentDir: string;
}): NonNullable<AcpAdapterV2Flavor["readSubagentTranscript"]> {
  const { fileSystem, path } = input;
  const sessionsRoot = path.join(input.agentDir, "sessions");
  const sessionDirs = new Map<string, string>();

  const findSessionDir = Effect.fnUntraced(function* (sessionId: string) {
    const cached = sessionDirs.get(sessionId);
    if (cached !== undefined) return cached;
    const suffix = `_${sessionId}`;
    for (const project of yield* fileSystem.readDirectory(sessionsRoot)) {
      const projectDir = path.join(sessionsRoot, project);
      const match = (yield* fileSystem
        .readDirectory(projectDir)
        .pipe(Effect.orElseSucceed((): ReadonlyArray<string> => []))).find((name) =>
        name.endsWith(suffix),
      );
      if (match === undefined) continue;
      const dir = path.join(projectDir, match);
      if ((yield* fileSystem.stat(dir)).type !== "Directory") continue;
      sessionDirs.set(sessionId, dir);
      return dir;
    }
    return undefined;
  });

  return ({ sessionId, agentId, fromByte }) =>
    Effect.gen(function* () {
      const dir = yield* findSessionDir(sessionId);
      if (dir === undefined || agentId.includes("/") || agentId.includes("\\")) {
        return { entries: [], nextByte: fromByte };
      }
      const bytes = yield* Effect.scoped(
        Effect.gen(function* () {
          const file = yield* fileSystem.open(path.join(dir, `${agentId}.jsonl`), { flag: "r" });
          const size = Number((yield* file.stat).size);
          if (size <= fromByte) return undefined;
          return Option.getOrUndefined(
            yield* file.readAlloc(size - fromByte, { position: BigInt(fromByte) }),
          );
        }),
      );
      // A trailing line without its newline is still being written; read it next time.
      const end = bytes === undefined ? -1 : bytes.lastIndexOf(NEWLINE);
      if (bytes === undefined || end < 0) return { entries: [], nextByte: fromByte };
      const entries = textDecoder
        .decode(bytes.subarray(0, end))
        .split("\n")
        .flatMap((line) => ompTranscriptEntries(agentId, line));
      return { entries, nextByte: fromByte + end + 1 };
    }).pipe(Effect.orElseSucceed(() => ({ entries: [], nextByte: fromByte })));
}
