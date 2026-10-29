const ANSI_PATTERN =
  /\u001b\[[0-?]*[ -/]*[@-~]|\u001b\][^\u0007\u001b]*(?:\u0007|\u001b\\)|\u001b[@-Z\\-_]/g;
const PARTIAL_ANSI_TAIL_PATTERN = /\u001b(?:\[[0-?]*[ -/]*|\][^\u0007\u001b]*\u001b?)?$/;

export function stripAnsi(text: string): string {
  return text.replace(ANSI_PATTERN, "");
}

export interface AnsiFilter {
  readonly push: (text: string) => string;
}

// A held tail is escape-only, so dropping it at turn end loses no text.
export function makeAnsiFilter(): AnsiFilter {
  let held = "";
  return {
    push: (text) => {
      const combined = held + text;
      const tail = PARTIAL_ANSI_TAIL_PATTERN.exec(combined);
      held = tail?.[0] ?? "";
      return stripAnsi(tail === null ? combined : combined.slice(0, tail.index));
    },
  };
}
