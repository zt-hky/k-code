import type { AcpAdapterV2Flavor } from "@t3tools/provider-acp/server/adapter";
import * as Predicate from "effect/Predicate";

export const OMP_AGENT_ID = "omp";
export const OMP_MODE_OPTION_ID = "mode";

const OMP_PLAN_PATH = /(?:^|[\\/:])[^\\/:]*plan\.md$/i;
const OMP_PLAN_LOCAL_PATH = /^local:\/\/.*plan\.md$/i;
const OMP_PLAN_APPROVAL_MESSAGE = /^Approve plan "[^"]*" and start implementation\?/;
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
  const model =
    nonEmptyString(results[0]?.resolvedModel) ??
    nonEmptyString(progress[0]?.resolvedModel) ??
    nonEmptyString(rawInput.model) ??
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

  return {
    nativeTaskId: tool.toolCallId,
    childSessionId: null,
    prompt,
    title,
    model,
    status,
    result,
  };
};
