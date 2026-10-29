import { matchInlineSkills } from "@t3tools/shared/inlineSkills";

// omp has no `$skill` syntax; it loads skills through `/skill:<name>`.
export function rewriteOmpSkillMentions(text: string, skillNames: ReadonlySet<string>): string {
  if (skillNames.size === 0) return text;
  let rewritten = "";
  let cursor = 0;
  for (const { start, end, skill } of matchInlineSkills(
    text,
    [...skillNames].map((name) => ({ name })),
  )) {
    rewritten += `${text.slice(cursor, start)}/skill:${skill.name}`;
    cursor = end;
  }
  return rewritten + text.slice(cursor);
}

/** omp advertises skills as `/skill:<name>` commands. */
export const OMP_SKILL_PREFIXES: ReadonlyArray<string> = ["skill:"];
