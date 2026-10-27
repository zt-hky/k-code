import type { OrchestrationV2UserInputQuestion } from "@t3tools/contracts";
import type { AcpAdapterV2Flavor } from "@t3tools/provider-acp/server/adapter";
import {
  type ElicitationChoices,
  elicitationChoices,
  trimmedText,
  unknownRecord,
} from "@t3tools/provider-acp/server/elicitationForm";

const OTHER_SUFFIX = "__other";

interface OmpAskQuestion {
  readonly key: string;
  readonly choices: ElicitationChoices | undefined;
}

// Oh My Pi `askDialog` (modes/acp/acp-agent.ts): question i is `q{i}` (titled `oneOf`, or
// `items.anyOf` when multi) plus a free-text `q{i}__other`; option-less questions send only the
// companion. Title is the question, description the short header. Option previews are not sent.
function ompAskQuestions(
  properties: Readonly<Record<string, unknown>>,
): ReadonlyArray<OmpAskQuestion> | undefined {
  const keys = Object.keys(properties);
  const count = keys.filter((key) => key.endsWith(OTHER_SUFFIX)).length;
  if (count === 0) return undefined;
  const questions: Array<OmpAskQuestion> = [];
  for (let index = 0; index < count; index++) {
    const key = `q${index}`;
    if (unknownRecord(properties[`${key}${OTHER_SUFFIX}`])?.type !== "string") return undefined;
    const choices = Object.hasOwn(properties, key)
      ? elicitationChoices(properties[key])
      : undefined;
    if (Object.hasOwn(properties, key) && choices === undefined) return undefined;
    questions.push({ key, choices });
  }
  const expected = questions.length + questions.filter((question) => question.choices).length;
  return keys.length === expected ? questions : undefined;
}

export const extractOmpAskElicitationForm: NonNullable<
  AcpAdapterV2Flavor["extractElicitationForm"]
> = (request) => {
  if (request.mode !== "form") return undefined;
  const properties = unknownRecord(unknownRecord(request.requestedSchema)?.properties);
  const parsed = properties ? ompAskQuestions(properties) : undefined;
  if (!properties || !parsed) return undefined;
  const message = trimmedText(request.message) ?? "Answer";
  const questions = parsed.map(({ key, choices }, index): OrchestrationV2UserInputQuestion => {
    const schema = unknownRecord(properties[key]);
    return {
      id: key,
      header: trimmedText(schema?.description) ?? `Question ${index + 1}`,
      question:
        trimmedText(schema?.title) ?? (parsed.length === 1 ? message : `Question ${index + 1}`),
      options: choices?.options ?? [],
      ...(choices?.multiSelect ? { multiSelect: true } : {}),
      allowCustomAnswer: true,
    };
  });
  return {
    questions,
    respond: (answers) => {
      const content: Record<string, string | Array<string>> = {};
      for (const { key, choices } of parsed) {
        const answer = Object.hasOwn(answers, key) ? answers[key] : undefined;
        if (choices?.multiSelect && Array.isArray(answer)) {
          content[key] = answer.filter(
            (value): value is string => typeof value === "string" && choices.values.has(value),
          );
          continue;
        }
        if (typeof answer !== "string") continue;
        if (choices && !choices.multiSelect && choices.values.has(answer)) {
          content[key] = answer;
          continue;
        }
        const custom = answer.trim();
        if (custom.length === 0) continue;
        // T3 answers with either option values or custom text; Oh My Pi reads the latter from `__other`.
        if (choices?.multiSelect) content[key] = [];
        content[`${key}${OTHER_SUFFIX}`] = custom;
      }
      return { action: "accept", content };
    },
  };
};
