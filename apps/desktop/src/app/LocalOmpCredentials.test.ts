import { describe, expect, it } from "vite-plus/test";

import { readLocalOmpCredentials, type OmpExportRunner } from "./LocalOmpCredentials.ts";

const exited =
  (stdout: string, code = 0): OmpExportRunner =>
  async () => ({ kind: "exited", code, stdout });

const exportOf = (...providers: ReadonlyArray<string>) =>
  JSON.stringify({
    version: 1,
    credentials: providers.map((provider) => ({
      provider,
      credential: { type: "api_key", key: "sk-not-real", source: "login" },
    })),
  });

describe("readLocalOmpCredentials", () => {
  it("lists each provider once and returns the export untouched", async () => {
    const payload = exportOf("synthetic", "anthropic", "synthetic");
    expect(await readLocalOmpCredentials("linux", exited(payload))).toEqual({
      status: "ok",
      providerIds: ["synthetic", "anthropic"],
      payload,
    });
  });

  it("says Oh My Pi is missing when the command is not found", async () => {
    expect(await readLocalOmpCredentials("linux", async () => ({ kind: "not_found" }))).toEqual({
      status: "not_installed",
    });
  });

  it("reports an export with no sign-ins as empty", async () => {
    expect(await readLocalOmpCredentials("linux", exited(exportOf()))).toEqual({ status: "empty" });
  });

  it.each([
    ["a failing exit", exited("", 1)],
    ["a crash", async () => ({ kind: "failed" as const })],
    ["output that is not JSON", exited("not json")],
    ["output of another shape", exited('{"credentials":[{"nope":1}]}')],
  ])("fails on %s without echoing anything", async (_name, runner) => {
    const result = await readLocalOmpCredentials("linux", runner);
    expect(result.status).toBe("failed");
    expect(JSON.stringify(result)).not.toContain("sk-");
  });
});
