import type {
  OrchestrationV2UserInputQuestion,
  ProviderUserInputAnswers,
} from "@t3tools/contracts";
import type { AcpAdapterV2Flavor } from "@t3tools/provider-acp/server/adapter";
import {
  type ElicitationChoices,
  elicitationChoices,
  trimmedText,
  unknownRecord,
} from "@t3tools/provider-acp/server/elicitationForm";

// omp 18.18+ names a field after its HTML form input (`color`) and adds `color_other`; older
// builds used `q{i}` with `q{i}__other`. Either companion carries the free-text answer.
const OTHER_SUFFIXES = ["_other", "__other"] as const;
const LEGACY_OTHER = /^(q\d+)__other$/;

type OmpAskField =
  | { readonly key: string; readonly kind: "choice"; readonly choices: ElicitationChoices }
  | {
      readonly key: string;
      readonly kind: "text";
      /** Where the answer is sent when it is not the field itself (older builds' option-less ask). */
      readonly answerKey?: string;
    }
  | { readonly key: string; readonly kind: "number"; readonly integer: boolean }
  | { readonly key: string; readonly kind: "boolean" };

type OmpAskCompanions = ReadonlyMap<string, string>;

function companionOf(
  properties: Readonly<Record<string, unknown>>,
  key: string,
): string | undefined {
  for (const suffix of OTHER_SUFFIXES) {
    const candidate = `${key}${suffix}`;
    if (unknownRecord(properties[candidate])?.type === "string") return candidate;
  }
  return undefined;
}

function ompAskFields(properties: Readonly<Record<string, unknown>>):
  | {
      readonly fields: ReadonlyArray<OmpAskField>;
      readonly companions: OmpAskCompanions;
    }
  | undefined {
  const companions = new Map<string, string>();
  for (const [key, value] of Object.entries(properties)) {
    const choices = elicitationChoices(value);
    if (choices === undefined || unknownRecord(value)?.type === "boolean") continue;
    const companion = companionOf(properties, key);
    if (companion !== undefined) companions.set(key, companion);
  }
  const folded = new Set(companions.values());
  const fields: Array<OmpAskField> = [];
  for (const [key, value] of Object.entries(properties)) {
    if (folded.has(key)) continue;
    // Older builds sent only `q{i}__other` for a question without options.
    const legacyBase = LEGACY_OTHER.exec(key)?.[1];
    if (
      legacyBase !== undefined &&
      !Object.hasOwn(properties, legacyBase) &&
      unknownRecord(value)?.type === "string"
    ) {
      fields.push({ key: legacyBase, kind: "text", answerKey: key });
      continue;
    }
    const property = unknownRecord(value);
    if (property === undefined || trimmedText(key) !== key) return undefined;
    if (property.type === "boolean") {
      fields.push({ key, kind: "boolean" });
      continue;
    }
    const choices = elicitationChoices(property);
    if (choices !== undefined) {
      fields.push({ key, kind: "choice", choices });
    } else if (property.type === "string") {
      fields.push({ key, kind: "text" });
    } else if (property.type === "number" || property.type === "integer") {
      fields.push({ key, kind: "number", integer: property.type === "integer" });
    } else {
      return undefined;
    }
  }
  return fields.length === 0 ? undefined : { fields, companions };
}

function customText(answer: unknown, values: ReadonlySet<string>): string | undefined {
  const entries = Array.isArray(answer) ? answer : [answer];
  const custom = entries
    .filter((entry): entry is string => typeof entry === "string" && !values.has(entry))
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
  return custom.length === 0 ? undefined : custom.join(", ");
}

function answerContent(
  fields: ReadonlyArray<OmpAskField>,
  companions: OmpAskCompanions,
  answers: ProviderUserInputAnswers,
): Record<string, string | number | boolean | Array<string>> {
  const content: Record<string, string | number | boolean | Array<string>> = {};
  for (const field of fields) {
    const answer = Object.hasOwn(answers, field.key) ? answers[field.key] : undefined;
    if (answer === undefined) continue;
    switch (field.kind) {
      case "text":
        if (typeof answer === "string" && answer.trim().length > 0) {
          content[field.answerKey ?? field.key] =
            field.answerKey === undefined ? answer : answer.trim();
        }
        break;
      case "number": {
        const parsed = typeof answer === "number" ? answer : Number(String(answer).trim());
        if (String(answer).trim() !== "" && Number.isFinite(parsed)) {
          if (!field.integer || Number.isInteger(parsed)) content[field.key] = parsed;
        }
        break;
      }
      case "boolean":
        if (answer === true || answer === "true") content[field.key] = true;
        else if (answer === false || answer === "false") content[field.key] = false;
        break;
      case "choice": {
        const { values, multiSelect } = field.choices;
        const companion = companions.get(field.key);
        const custom = customText(answer, values);
        if (multiSelect) {
          const selected = (Array.isArray(answer) ? answer : [answer]).filter(
            (entry): entry is string => typeof entry === "string" && values.has(entry),
          );
          content[field.key] = [...new Set(selected)];
        } else if (typeof answer === "string" && values.has(answer)) {
          content[field.key] = answer;
        }
        if (custom !== undefined && companion !== undefined) content[companion] = custom;
        break;
      }
    }
  }
  return content;
}

/**
 * Oh My Pi's `ask` tool renders its HTML form as one ACP form elicitation: one property per
 * input, plus a `<name>_other` text companion on radio and checkbox groups for a typed answer.
 * The companion is folded into its question as the custom answer.
 */
export const extractOmpAskElicitationForm: NonNullable<
  AcpAdapterV2Flavor["extractElicitationForm"]
> = (request) => {
  if (request.mode !== "form") return undefined;
  const properties = unknownRecord(unknownRecord(request.requestedSchema)?.properties);
  const parsed = properties ? ompAskFields(properties) : undefined;
  if (!properties || !parsed) return undefined;
  const { fields, companions } = parsed;
  const message = trimmedText(request.message) ?? "Answer";
  const questions = fields.map((field, index): OrchestrationV2UserInputQuestion => {
    const legacy = field.kind === "text" && field.answerKey !== undefined;
    const schema = unknownRecord(properties[field.key]);
    const title = legacy ? undefined : trimmedText(schema?.title);
    const question = title ?? (fields.length === 1 ? message : `Question ${index + 1}`);
    const base = {
      id: field.key,
      header: trimmedText(schema?.description) ?? `Question ${index + 1}`,
      question,
    };
    if (field.kind === "choice") {
      return {
        ...base,
        options: field.choices.options,
        ...(field.choices.multiSelect ? { multiSelect: true } : {}),
        allowCustomAnswer: companions.has(field.key),
      };
    }
    if (field.kind === "boolean") {
      return {
        ...base,
        options: elicitationChoices(schema)?.options ?? [],
        allowCustomAnswer: false,
      };
    }
    return { ...base, options: [], allowCustomAnswer: true };
  });
  return {
    questions,
    respond: (answers) => ({
      action: "accept",
      content: answerContent(fields, companions, answers),
    }),
  };
};

/** omp's `ask` tool call; its questions are answered through the elicitation above. */
export const isOmpAskToolCall: NonNullable<AcpAdapterV2Flavor["isUserInputTool"]> = (toolCall) => {
  const rawInput = unknownRecord(toolCall.data.rawInput);
  const html = rawInput?.html;
  if (typeof html === "string" && /^\s*<form[\s>]/i.test(html)) return true;
  const questions = rawInput?.questions;
  return (
    Array.isArray(questions) &&
    questions.length > 0 &&
    questions.every((question) => {
      const record = unknownRecord(question);
      return typeof record?.question === "string" && Array.isArray(record.options);
    })
  );
};
