// Agents describe a command's argument in one free-form hint, e.g. omp's `[on|off|status]`
// for `/fast`. Enumerations become choices; placeholders (`[title]`, `<path>`) stay free text.

/** First `<…>` or `[…]` group of a hint: the argument being completed now. */
const FIRST_HINT_GROUP_PATTERN = /[<[]([^<>[\]]*(?:\[[^\]]*\][^<>[\]]*)*)[>\]]/;
/** A literal a user could type: a word or a flag, not a placeholder phrase. */
const HINT_LITERAL_PATTERN = /^-{0,2}[A-Za-z][\w-]*$/;

/**
 * Read the choices a hint enumerates, in hint order. Returns an empty list
 * for placeholders and for single-choice hints: one "option" is not a menu,
 * it is the argument's name.
 */
export function parseSlashCommandArgumentOptions(hint: string | undefined): ReadonlyArray<string> {
  const group = hint === undefined ? null : FIRST_HINT_GROUP_PATTERN.exec(hint);
  const body = group?.[1];
  if (body === undefined || !body.includes("|")) {
    return [];
  }
  const options: Array<string> = [];
  for (const alternative of body.split("|")) {
    // `dump [raw]` enumerates `dump`; the nested group is that choice's own
    // argument and is completed on the next keystroke, not here.
    const literal = alternative.trim().split(/\s+/)[0] ?? "";
    if (HINT_LITERAL_PATTERN.test(literal) && !options.includes(literal)) {
      options.push(literal);
    }
  }
  return options.length > 1 ? options : [];
}

/** Prefix-filter the choices, keeping hint order. Empty query keeps all. */
export function searchSlashCommandArgumentOptions(
  options: ReadonlyArray<string>,
  query: string,
): ReadonlyArray<string> {
  const normalized = query.trim().toLowerCase();
  if (normalized.length === 0) {
    return options;
  }
  return options.filter((option) => option.toLowerCase().startsWith(normalized));
}

export interface SlashCommandArgumentChoice {
  readonly value: string;
  readonly description: string;
}

/**
 * Second-level choices for a command. Declared subcommands (with usage) win over the
 * enumeration parsed from the free-form input hint.
 */
export function slashCommandArgumentChoices(
  command: {
    readonly description?: string | undefined;
    readonly input?: { readonly hint?: string | undefined } | undefined;
    readonly subcommands?:
      | ReadonlyArray<{
          readonly name: string;
          readonly description?: string | undefined;
          readonly usage?: string | undefined;
        }>
      | undefined;
  },
  query: string,
): ReadonlyArray<SlashCommandArgumentChoice> {
  if (command.subcommands && command.subcommands.length > 0) {
    return searchSlashCommandArgumentOptions(
      command.subcommands.map((subcommand) => subcommand.name),
      query,
    ).map((value) => {
      const subcommand = command.subcommands!.find((candidate) => candidate.name === value)!;
      return {
        value,
        description: [subcommand.usage, subcommand.description]
          .filter((part): part is string => part !== undefined && part.length > 0)
          .join(" · "),
      };
    });
  }
  return searchSlashCommandArgumentOptions(
    parseSlashCommandArgumentOptions(command.input?.hint),
    query,
  ).map((value) => ({
    value,
    description: command.description ?? command.input?.hint ?? "",
  }));
}
