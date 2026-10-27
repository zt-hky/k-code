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
