import { describe, expect, it } from "vite-plus/test";

import { parseClientSettingsDefaults } from "./clientSettingsDefaults";

describe("parseClientSettingsDefaults", () => {
  it("reads known client settings from the build JSON", () => {
    expect(
      parseClientSettingsDefaults('{"boringSidebarEnabled":true,"planModeEnabled":true}'),
    ).toEqual({ boringSidebarEnabled: true, planModeEnabled: true });
  });

  it("ignores unknown keys, wrong types, empty and malformed input", () => {
    expect(parseClientSettingsDefaults('{"notASetting":true}')).toEqual({});
    expect(parseClientSettingsDefaults('{"planModeEnabled":"yes"}')).toEqual({});
    expect(parseClientSettingsDefaults("")).toEqual({});
    expect(parseClientSettingsDefaults(undefined)).toEqual({});
    expect(parseClientSettingsDefaults("{nope")).toEqual({});
  });
});
