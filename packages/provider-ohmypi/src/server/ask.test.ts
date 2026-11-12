import { describe, expect, it } from "@effect/vitest";

import { extractOmpAskElicitationForm, isOmpAskToolCall } from "./ask.ts";

// Captured from `omp acp` 18.18.8 answering the `ask` tool.
const request = (properties: Record<string, unknown>, message = "Which color?\n\nWhich size?") =>
  ({
    mode: "form",
    sessionId: "s",
    message,
    requestedSchema: { type: "object", properties },
  }) as Parameters<typeof extractOmpAskElicitationForm>[0];

const choiceForm = {
  color: {
    type: "string",
    title: "Which color?",
    oneOf: [
      { const: "Red", title: "Red" },
      { const: "Blue", title: "Blue" },
    ],
  },
  color_other: { type: "string", title: "Which color? — Other" },
  size: {
    type: "array",
    title: "Which size?",
    items: {
      anyOf: [
        { const: "Small", title: "Small" },
        { const: "Large", title: "Large" },
      ],
    },
    default: [],
  },
  size_other: { type: "string", title: "Which size? — Other" },
};

describe("extractOmpAskElicitationForm", () => {
  it("asks each question once and folds the _other companion into it", () => {
    const form = extractOmpAskElicitationForm(request(choiceForm));
    expect(form?.questions.map((question) => question.id)).toEqual(["color", "size"]);
    expect(form?.questions.map((question) => question.allowCustomAnswer)).toEqual([true, true]);
    expect(form?.questions[1]?.multiSelect).toBe(true);
  });

  it("routes typed answers to the companion and keeps option answers on the field", () => {
    const form = extractOmpAskElicitationForm(request(choiceForm));
    expect(form?.respond({ color: "Red", size: ["Small"] })).toEqual({
      action: "accept",
      content: { color: "Red", size: ["Small"] },
    });
    expect(form?.respond({ color: "Teal", size: ["Large", "XL"] })).toEqual({
      action: "accept",
      content: { color_other: "Teal", size: ["Large"], size_other: "XL" },
    });
  });

  it("types text, number, boolean and select inputs", () => {
    const form = extractOmpAskElicitationForm(
      request({
        project_name: { type: "string", title: "project name" },
        count: { type: "number", title: "count" },
        agree: { type: "boolean", title: "I agree", default: false },
        level: {
          type: "string",
          title: "Level",
          oneOf: [
            { const: "a", title: "Alpha" },
            { const: "b", title: "Beta" },
          ],
          default: "a",
        },
      }),
    );
    expect(form?.questions.map((question) => question.id)).toEqual([
      "project_name",
      "count",
      "agree",
      "level",
    ]);
    // A select has no companion, so it only accepts its own options.
    expect(form?.questions[3]?.allowCustomAnswer).toBe(false);
    expect(form?.respond({ project_name: "demo", count: "3", agree: "true", level: "b" })).toEqual({
      action: "accept",
      content: { project_name: "demo", count: 3, agree: true, level: "b" },
    });
  });

  it("still reads the q{i}__other form of older builds", () => {
    const form = extractOmpAskElicitationForm(
      request(
        {
          q0: {
            type: "string",
            title: "Which port?",
            description: "Port",
            oneOf: [{ const: "80", title: "80" }],
          },
          q0__other: { type: "string", title: "Other" },
        },
        "Which port?",
      ),
    );
    expect(form?.questions).toHaveLength(1);
    expect(form?.respond({ q0: "8080" })).toEqual({
      action: "accept",
      content: { q0__other: "8080" },
    });
  });
});

describe("isOmpAskToolCall", () => {
  it("matches the html form the ask tool sends and ignores other html", () => {
    const call = (rawInput: unknown) => ({ toolCallId: "t", data: { rawInput } });
    expect(isOmpAskToolCall(call({ html: '<form>\n<input name="a"></form>' }))).toBe(true);
    expect(isOmpAskToolCall(call({ html: "<!doctype html><p>page</p>" }))).toBe(false);
  });
});
