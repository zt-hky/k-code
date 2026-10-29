import { describe, expect, it } from "vite-plus/test";

import { formatAppDisplayName, withInstanceName } from "./branding.logic";

describe("app titles", () => {
  it("shows the plain product name for the latest channel", () => {
    expect(formatAppDisplayName({ baseName: "T3 Code", stageLabel: "Latest" })).toBe("T3 Code");
  });

  it("appends the instance name when the server has one", () => {
    expect(withInstanceName("T3 Code", "alice")).toBe("T3 Code | alice");
    expect(withInstanceName("T3 Code", "  ")).toBe("T3 Code");
    expect(withInstanceName("T3 Code", undefined)).toBe("T3 Code");
  });
});
