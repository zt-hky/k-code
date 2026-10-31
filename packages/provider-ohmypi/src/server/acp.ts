import type { OrchestrationV2SubagentUsage } from "@t3tools/contracts";
import type {
  AcpAdapterV2Flavor,
  AcpSubagentTranscriptEntry,
} from "@t3tools/provider-acp/server/adapter";
import * as Effect from "effect/Effect";
import * as EffectAcpErrors from "effect-acp/errors";
import type * as FileSystem from "effect/FileSystem";
import * as Option from "effect/Option";
import type * as Path from "effect/Path";
import * as Predicate from "effect/Predicate";
import * as Schema from "effect/Schema";

import { ompSubagentStopMarkerName } from "./stopExtension.ts";

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
export const OMP_SESSIONS_LIST_ALL_METHOD = "_omp/sessions/listAll";
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

const finiteNumber = (value: unknown): number | undefined =>
  typeof value === "number" && Number.isFinite(value) ? value : undefined;

// Resource totals add up across a task's progress entries; context is per agent.
const ompSubagentUsage = (
  progress: ReadonlyArray<Record<string, unknown>>,
): OrchestrationV2SubagentUsage | undefined => {
  const sum = (key: string): number | undefined =>
    progress.reduce<number | undefined>((total, entry) => {
      const value = finiteNumber(entry[key]);
      return value === undefined ? total : (total ?? 0) + value;
    }, undefined);
  const largestContext = (entries: ReadonlyArray<Record<string, unknown>>) =>
    entries.reduce<Record<string, unknown> | undefined>((largest, entry) => {
      const context = finiteNumber(entry.contextTokens);
      return context !== undefined && context > (finiteNumber(largest?.contextTokens) ?? -1)
        ? entry
        : largest;
    }, undefined);
  const contextEntry =
    largestContext(progress.filter((entry) => entry.status === "running")) ??
    largestContext(progress);
  const fields = {
    tokens: sum("tokens"),
    costUsd: sum("cost"),
    contextTokens: finiteNumber(contextEntry?.contextTokens),
    contextWindow: finiteNumber(contextEntry?.contextWindow),
    toolCount: sum("toolCount"),
    requests: sum("requests"),
  };
  const usage: OrchestrationV2SubagentUsage = Object.fromEntries(
    Object.entries(fields).filter(([, value]) => value !== undefined),
  );
  return Object.keys(usage).length === 0 ? undefined : usage;
};

type OmpSubagentStatus = "pending" | "running" | "failed" | "cancelled" | "completed";

const ompResultStatus = (result: Record<string, unknown>): OmpSubagentStatus => {
  if (result.aborted === true) return "cancelled";
  return (typeof result.exitCode === "number" && result.exitCode !== 0) ||
    typeof result.error === "string"
    ? "failed"
    : "completed";
};

const ompProgressStatus = (
  progress: Record<string, unknown> | undefined,
): OmpSubagentStatus | undefined => {
  switch (progress?.status) {
    case "pending":
      return "pending";
    case "running":
      return "running";
    case "completed":
      return "completed";
    case "failed":
      return "failed";
    case "aborted":
      return "cancelled";
    default:
      return undefined;
  }
};

const ompStatusIsTerminal = (
  status: OmpSubagentStatus | undefined,
): status is "completed" | "failed" | "cancelled" =>
  status === "completed" || status === "failed" || status === "cancelled";

const ompProgressActivity = (progress: Record<string, unknown> | undefined): string | null => {
  const currentTool = nonEmptyString(progress?.currentTool);
  const currentToolArgs = nonEmptyString(progress?.currentToolArgs);
  if (currentTool !== undefined) {
    return currentToolArgs === undefined ? currentTool : `${currentTool}: ${currentToolArgs}`;
  }
  return (
    nonEmptyString(progress?.lastIntent) ??
    nonEmptyString(Array.isArray(progress?.recentOutput) ? progress.recentOutput[0] : undefined) ??
    null
  );
};

const ompThinkingFields = (
  results: ReadonlyArray<Record<string, unknown> | undefined>,
  fallbackModel: string | undefined,
) => {
  const resolvedModel =
    results.map((entry) => nonEmptyString(entry?.resolvedModel)).find((value) => value) ??
    fallbackModel ??
    null;
  // omp suffixes `resolvedModel` with `:<level>` when the level was set explicitly.
  return {
    model: resolvedModel?.replace(OMP_MODEL_THINKING_SUFFIX, "") ?? null,
    reasoningEffort:
      results.map((entry) => nonEmptyString(entry?.resolvedThinkingLevel)).find((value) => value) ??
      OMP_MODEL_THINKING_SUFFIX.exec(resolvedModel ?? "")?.[1] ??
      null,
  };
};

const ompTranscriptAgentIds = (entries: ReadonlyArray<Record<string, unknown> | undefined>) => [
  ...new Set(
    entries.flatMap((entry) => {
      const id = nonEmptyString(entry?.id);
      return id === undefined ? [] : [id];
    }),
  ),
];

// Entries carry the task's position in `index`; fall back to list position when they do not.
const ompEntryAt = (
  entries: ReadonlyArray<Record<string, unknown>>,
  index: number,
): Record<string, unknown> | undefined =>
  entries.some((entry) => finiteNumber(entry.index) !== undefined)
    ? entries.find((entry) => entry.index === index)
    : entries[index];

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

  if (!isSingle) {
    const tasks = (batch ?? []).map((entry) => asRecord(entry) ?? {});
    const children = tasks.map((task, index) => {
      const entryProgress = ompEntryAt(progress, index);
      const entryResult = ompEntryAt(results, index);
      const own =
        entryResult === undefined ? ompProgressStatus(entryProgress) : ompResultStatus(entryResult);
      const status: OmpSubagentStatus = ompStatusIsTerminal(own)
        ? own
        : tool.status === "failed" || asyncState === "failed"
          ? "failed"
          : asyncState === "running"
            ? (own ?? "running")
            : tool.status === "completed"
              ? "completed"
              : (own ?? "running");
      const terminal = ompStatusIsTerminal(status);
      const resultText =
        terminal && entryResult !== undefined
          ? (nonEmptyString(entryResult.output) ?? nonEmptyString(entryResult.error) ?? null)
          : null;
      const usage = ompSubagentUsage(entryProgress === undefined ? [] : [entryProgress]);
      const transcriptAgentIds = ompTranscriptAgentIds([entryProgress, entryResult]);
      return {
        nativeTaskId: `${tool.toolCallId}:batch:${index}`,
        childSessionId: null,
        prompt: task.task as string,
        title:
          nonEmptyString(entryProgress?.description) ??
          nonEmptyString(task.name) ??
          nonEmptyString(task.agent) ??
          nonEmptyString(entryProgress?.agent) ??
          nonEmptyString(entryResult?.agent) ??
          null,
        ...ompThinkingFields(
          [entryResult, entryProgress],
          nonEmptyString(task.model) ?? nonEmptyString(rawInput.model),
        ),
        status,
        result: resultText,
        progress: terminal ? null : ompProgressActivity(entryProgress),
        ...(usage === undefined ? {} : { usage }),
        ...(transcriptAgentIds.length === 0 ? {} : { transcriptAgentIds }),
      };
    });
    const statuses = children.map((child) => child.status);
    const status: OmpSubagentStatus = !statuses.every(ompStatusIsTerminal)
      ? "running"
      : statuses.includes("failed")
        ? "failed"
        : statuses.includes("cancelled")
          ? "cancelled"
          : "completed";
    return {
      nativeTaskId: tool.toolCallId,
      childSessionId: null,
      prompt: tasks.map((task, index) => `${index + 1}. ${task.task}`).join("\n"),
      title: nonEmptyString(tool.title) ?? `${tasks.length} agents`,
      model: null,
      status,
      result: null,
      children,
    };
  }

  const title =
    nonEmptyString(rawInput.name) ??
    nonEmptyString(progress[0]?.description) ??
    nonEmptyString(rawInput.agent) ??
    null;
  const agentProgress = progress.find((entry) => entry.status === "running") ?? progress[0];
  const { model, reasoningEffort } = ompThinkingFields(
    [results[0], agentProgress],
    nonEmptyString(rawInput.model),
  );

  const status = ((): "running" | "failed" | "cancelled" | "completed" => {
    if (tool.status === "failed") return "failed";
    if (asyncState === "running") return "running";
    if (asyncState === "failed") return "failed";
    if (results.some((entry) => entry.aborted === true)) return "cancelled";
    if (tool.status === "completed") {
      return results.some((entry) => ompResultStatus(entry) === "failed") ? "failed" : "completed";
    }
    return "running";
  })();

  let result: string | null = null;
  if (status !== "running") {
    const parts = results.flatMap((entry) => {
      const text = nonEmptyString(entry.output) ?? nonEmptyString(entry.error);
      return text === undefined ? [] : [text];
    });
    result =
      parts.length > 0 ? parts.join("\n\n") : (ompToolContentText(rawOutput?.content) ?? null);
  }

  const usage = ompSubagentUsage(progress);
  const transcriptAgentIds = ompTranscriptAgentIds([...progress, ...results]);

  return {
    nativeTaskId: tool.toolCallId,
    childSessionId: null,
    prompt: rawInput.task as string,
    title,
    model,
    status,
    result,
    progress: status === "running" ? ompProgressActivity(agentProgress) : null,
    reasoningEffort,
    ...(usage === undefined ? {} : { usage }),
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

interface OmpSessionDirectoryInput {
  readonly fileSystem: FileSystem.FileSystem;
  readonly path: Path.Path;
  readonly agentDir: string;
}

/** Finds `<agentDir>/sessions/<cwd>/<stamp>_<sessionId>/`, where omp saves a session's children. */
function makeOmpSessionDirectoryFinder(input: OmpSessionDirectoryInput) {
  const { fileSystem, path } = input;
  const sessionsRoot = path.join(input.agentDir, "sessions");
  const sessionDirs = new Map<string, string>();

  return Effect.fnUntraced(function* (sessionId: string) {
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
}

/**
 * omp runs subagents in-process and streams none of their work over ACP, but it saves each
 * child's session beside the parent's: `<agentDir>/sessions/<cwd>/<stamp>_<sessionId>/<agentId>.jsonl`.
 */
export function makeOmpSubagentTranscriptReader(
  input: OmpSessionDirectoryInput,
): NonNullable<AcpAdapterV2Flavor["readSubagentTranscript"]> {
  const { fileSystem, path } = input;
  const findSessionDir = makeOmpSessionDirectoryFinder(input);

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

/**
 * Asks the stop extension inside omp to abort one child: it polls for a marker named after the
 * child's session file, so a marker only ever reaches that agent.
 */
export function makeOmpSubagentStopper(
  input: OmpSessionDirectoryInput & { readonly stopDir: string },
): NonNullable<AcpAdapterV2Flavor["stopSubagent"]> {
  const { fileSystem, path } = input;
  const findSessionDir = makeOmpSessionDirectoryFinder(input);

  return ({ sessionId, agentIds }) =>
    Effect.gen(function* () {
      const dir = yield* findSessionDir(sessionId);
      if (dir === undefined) {
        return yield* new EffectAcpErrors.AcpTransportError({
          detail: "The omp session directory was not found",
          cause: sessionId,
        });
      }
      for (const agentId of agentIds) {
        if (agentId.includes("/") || agentId.includes("\\")) continue;
        const marker = path.join(
          input.stopDir,
          ompSubagentStopMarkerName(path.join(dir, `${agentId}.jsonl`)),
        );
        yield* fileSystem.writeFileString(marker, "");
      }
    }).pipe(
      Effect.mapError(
        (cause) =>
          new EffectAcpErrors.AcpTransportError({
            detail: "Could not write the omp subagent stop marker",
            cause,
          }),
      ),
    );
}
