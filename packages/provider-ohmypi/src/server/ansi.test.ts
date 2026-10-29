import { describe, expect, it } from "@effect/vitest";

import { makeAnsiFilter, stripAnsi } from "./ansi.ts";

describe("omp ansi", () => {
  it("strips complete escapes", () => {
    expect(stripAnsi("[\u001b[38;5;243m░░\u001b[39m] 0%")).toBe("[░░] 0%");
  });

  it("holds back an escape split across chunks", () => {
    const filter = makeAnsiFilter();
    expect(filter.push("a\u001b[3")).toBe("a");
    expect(filter.push("1mb")).toBe("b");
    expect(filter.push("c\u001b")).toBe("c");
    expect(filter.push("[0m")).toBe("");
  });
});
