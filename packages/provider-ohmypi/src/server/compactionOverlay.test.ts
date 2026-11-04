import { describe, expect, it } from "@effect/vitest";

import { withOmpConfigOverlay } from "./compactionOverlay.ts";

describe("withOmpConfigOverlay", () => {
  it.each([
    { existing: undefined, platform: "linux", expected: "/k/off.yml" },
    { existing: "", platform: "linux", expected: "/k/off.yml" },
    // The user's overlays load first, so K-code's switch still wins over them.
    { existing: "/u/a.yml:/u/b.yml", platform: "darwin", expected: "/u/a.yml:/u/b.yml:/k/off.yml" },
    { existing: "C:\\u\\a.yml", platform: "win32", expected: "C:\\u\\a.yml;/k/off.yml" },
  ] as const)("appends after $existing on $platform", ({ existing, platform, expected }) => {
    expect(withOmpConfigOverlay(existing, "/k/off.yml", platform)).toBe(expected);
  });
});
