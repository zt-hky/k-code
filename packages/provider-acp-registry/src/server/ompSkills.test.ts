import { describe, expect, it } from "@effect/vitest";

import { normalizeAcpRegistryCommands } from "./probe.ts";
import { rewriteOmpSkillMentions } from "./ompSkills.ts";

describe("omp skill mentions", () => {
  const skills = new Set(["tdd"]);

  it("rewrites known skills to /skill:name", () => {
    expect(rewriteOmpSkillMentions("use $tdd now", skills)).toBe("use /skill:tdd now");
    expect(rewriteOmpSkillMentions("$tdd", skills)).toBe("/skill:tdd");
    expect(rewriteOmpSkillMentions("$tdd $tdd\nx", skills)).toBe("/skill:tdd /skill:tdd\nx");
  });

  it("leaves unknown tokens alone", () => {
    expect(rewriteOmpSkillMentions("$HOME", skills)).toBe("$HOME");
    expect(rewriteOmpSkillMentions("use $tdd", new Set())).toBe("use $tdd");
  });
});

describe("omp skills in the command catalog", () => {
  const commands = [{ name: "skill:tdd", description: "Test first" }] as never;

  it("lists skill:* as skills for omp", () => {
    const result = normalizeAcpRegistryCommands(commands, "omp");
    expect(result.skills.map((skill) => skill.name)).toEqual(["tdd"]);
    expect(result.slashCommands).toEqual([]);
  });

  it("keeps skill:* as a slash command for other agents", () => {
    const result = normalizeAcpRegistryCommands(commands, "other");
    expect(result.skills).toEqual([]);
    expect(result.slashCommands.map((command) => command.name)).toEqual(["skill:tdd"]);
  });
});
