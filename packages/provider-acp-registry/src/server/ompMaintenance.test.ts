import { assert, describe, it } from "@effect/vitest";

import { parseOmpLatestVersion } from "./ompMaintenance.ts";

describe("parseOmpLatestVersion", () => {
  it("reads the new version when an update exists", () => {
    assert.equal(
      parseOmpLatestVersion("Current version: 18.13.2\nNew version available: 18.13.3\n"),
      "18.13.3",
    );
  });

  it("falls back to the current version when already up to date", () => {
    assert.equal(
      parseOmpLatestVersion("Current version: 18.13.3\nAlready up to date\n"),
      "18.13.3",
    );
  });

  it("returns null for unrecognised output", () => {
    assert.isNull(parseOmpLatestVersion("error: network unreachable"));
  });
});
