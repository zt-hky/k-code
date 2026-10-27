import type {
  OrchestrationV2UserInputQuestion,
  ProviderUserInputAnswers,
} from "@t3tools/contracts";
import type * as EffectAcpSchema from "effect-acp/compat";

type QuestionOption = OrchestrationV2UserInputQuestion["options"][number];

export interface AcpElicitationForm {
  readonly questions: ReadonlyArray<OrchestrationV2UserInputQuestion>;
  readonly respond: (
    answers: ProviderUserInputAnswers,
  ) => EffectAcpSchema.CreateElicitationResponse;
}

export interface ElicitationChoices {
  readonly options: ReadonlyArray<QuestionOption>;
  readonly values: ReadonlySet<string>;
  readonly multiSelect: boolean;
}

export function unknownRecord(value: unknown): Readonly<Record<string, unknown>> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Readonly<Record<string, unknown>>)
    : undefined;
}

export function trimmedText(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

// Untitled `enum` values and titled `oneOf`/`anyOf` options (`const` + `title`) per the ACP form schema.
function enumOptions(container: Readonly<Record<string, unknown>> | undefined, key: string) {
  const entries = container?.[key];
  if (!Array.isArray(entries)) return [];
  return entries.flatMap((entry): Array<{ value: string; title: string; description?: string }> => {
    if (typeof entry === "string") return entry.length > 0 ? [{ value: entry, title: entry }] : [];
    const option = unknownRecord(entry);
    if (typeof option?.const !== "string" || option.const.length === 0) return [];
    const title = trimmedText(option.title) ?? option.const;
    const description = trimmedText(option.description);
    return [{ value: option.const, title, ...(description ? { description } : {}) }];
  });
}

/** Choices of a single-select (`enum`/`oneOf`), multi-select (`items.enum`/`items.anyOf`), or boolean field. */
export function elicitationChoices(property: unknown): ElicitationChoices | undefined {
  const schema = unknownRecord(property);
  if (schema?.type === "boolean") {
    return {
      options: [
        { label: "true", description: "Yes", value: "true" },
        { label: "false", description: "No", value: "false" },
      ],
      values: new Set(["true", "false"]),
      multiSelect: false,
    };
  }
  const multiSelect = schema?.type === "array";
  const items = multiSelect ? unknownRecord(schema.items) : schema;
  const entries =
    schema?.type === "string"
      ? [...enumOptions(items, "enum"), ...enumOptions(items, "oneOf")]
      : multiSelect
        ? [...enumOptions(items, "enum"), ...enumOptions(items, "anyOf")]
        : [];
  if (entries.length === 0) return undefined;
  const defaults = new Set(
    Array.isArray(schema?.default)
      ? schema.default.filter((value): value is string => typeof value === "string")
      : typeof schema?.default === "string"
        ? [schema.default]
        : [],
  );
  return {
    // The question UI has no preselection; mark the agent's default the way native pickers do.
    options: entries.map((entry) => ({
      label: defaults.has(entry.value) ? `${entry.title} (Recommended)` : entry.title,
      description: entry.description ?? entry.title,
      value: entry.value,
    })),
    values: new Set(entries.map((entry) => entry.value)),
    multiSelect,
  };
}

function contentValue(
  property: unknown,
  answer: unknown,
  choices: ElicitationChoices | undefined,
): EffectAcpSchema.ElicitationContentValue | undefined {
  const type = unknownRecord(property)?.type;
  if (type === "boolean") {
    if (typeof answer === "boolean") return answer;
    return answer === "true" ? true : answer === "false" ? false : undefined;
  }
  if (type === "number" || type === "integer") {
    const value = typeof answer === "number" ? answer : Number(trimmedText(answer) ?? Number.NaN);
    return Number.isFinite(value) && (type === "number" || Number.isInteger(value))
      ? value
      : undefined;
  }
  if (type === "array") {
    if (!Array.isArray(answer)) return undefined;
    return answer.filter(
      (entry): entry is string =>
        typeof entry === "string" && (choices === undefined || choices.values.has(entry)),
    );
  }
  return typeof answer === "string" ? answer : undefined;
}

/** Maps any ACP form to T3 questions, one per property, and answers back with typed content. */
export function genericElicitationForm(
  message: string,
  requestedSchema: unknown,
): AcpElicitationForm {
  const properties = unknownRecord(unknownRecord(requestedSchema)?.properties) ?? {};
  const choicesById = new Map(
    Object.entries(properties).map(([id, property]) => [id, elicitationChoices(property)]),
  );
  return {
    questions: Object.entries(properties).map(([id, property], index) => {
      const schema = unknownRecord(property);
      const choices = choicesById.get(id);
      return {
        id,
        header: trimmedText(schema?.title) ?? `Question ${index + 1}`,
        question: trimmedText(schema?.description) ?? trimmedText(message) ?? "Answer",
        options: choices?.options ?? [],
        ...(choices?.multiSelect ? { multiSelect: true, allowCustomAnswer: false } : {}),
      };
    }),
    respond: (answers) => {
      const content: Record<string, EffectAcpSchema.ElicitationContentValue> = {};
      for (const [id, property] of Object.entries(properties)) {
        if (!Object.hasOwn(answers, id)) continue;
        const value = contentValue(property, answers[id], choicesById.get(id));
        if (value !== undefined) content[id] = value;
      }
      return { action: "accept", content };
    },
  };
}
