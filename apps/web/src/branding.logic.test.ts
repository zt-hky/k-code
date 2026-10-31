import { describe, expect, it } from "vite-plus/test";

import { formatAppDisplayName, withInstanceName } from "./branding.logic";

describe("app titles", () => {
  it("shows the plain product name for the latest channel", () => {
    expect(formatAppDisplayName({ baseName: "K-code", stageLabel: "Latest" })).toBe("K-code");
  });

  it("appends the instance name when the server has one", () => {
    expect(withInstanceName("K-code", "alice")).toBe("K-code | alice");
    expect(withInstanceName("K-code", "  ")).toBe("K-code");
    expect(withInstanceName("K-code", undefined)).toBe("K-code");
  });
});
