import { describe, expect, it } from "@effect/vitest";

import { extractOmpPlanApprovalElicitation, extractOmpProposedPlanMarkdown } from "./ompAcp.ts";

const approvalSchema = {
  type: "object",
  properties: { value: { type: "string", enum: ["Approve and execute", "Refine plan"] } },
  required: ["value"],
};

describe("omp plan extraction", () => {
  it("reads the plan from local plan writes and later plan edits", () => {
    expect(
      extractOmpProposedPlanMarkdown({
        toolCallId: "1",
        data: { rawInput: { path: "local://x-plan.md", content: "# Plan" } },
      }),
    ).toBe("# Plan");
    expect(
      extractOmpProposedPlanMarkdown({
        toolCallId: "2",
        data: { rawOutput: { details: { resolvedPath: "/tmp/x-plan.md", newText: "# Plan 2" } } },
      }),
    ).toBe("# Plan 2");
    expect(
      extractOmpProposedPlanMarkdown({
        toolCallId: "3",
        data: { rawInput: { path: "src/index.ts", content: "code" } },
      }),
    ).toBeUndefined();
    expect(
      extractOmpProposedPlanMarkdown({
        toolCallId: "4",
        data: { rawOutput: { details: { path: "src/index.ts", newText: "code" } } },
      }),
    ).toBeUndefined();
  });
});

describe("omp plan approval elicitation", () => {
  const request = (message: string, requestedSchema: unknown = approvalSchema) =>
    ({ mode: "form", sessionId: "s", message, requestedSchema }) as never;

  it("matches the approval form and returns the excerpt without the truncation marker", () => {
    expect(
      extractOmpPlanApprovalElicitation(
        request('Approve plan "Demo" and start implementation?\n# Demo\n- one\n…'),
      ),
    ).toEqual({ excerptMarkdown: "# Demo\n- one" });
  });

  it("ignores other forms", () => {
    expect(extractOmpPlanApprovalElicitation(request("Approve this request?"))).toBeUndefined();
    expect(
      extractOmpPlanApprovalElicitation(
        request('Approve plan "Demo" and start implementation?\nx', {
          type: "object",
          properties: { value: { type: "string", enum: ["Yes", "No"] } },
        }),
      ),
    ).toBeUndefined();
  });
});
