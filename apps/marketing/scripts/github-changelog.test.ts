import { describe, expect, it } from "vite-plus/test";

import { buildChangelogMarkdown, renderChangelog } from "./github-changelog.mjs";

const body = [
  "Intro.",
  "",
  "## Highlights",
  "",
  "- One",
  "",
  "## Downloads",
  "",
  "| a | b |",
  "",
  "```sh",
  "curl x",
  "```",
  "",
  "**Full changelog**: https://example.test/compare",
].join("\n");

const release = (tag: string, date: string, extra: object = {}) => ({
  tag,
  url: `https://github.com/zt-hky/k-code/releases/tag/${tag}`,
  date,
  body,
  draft: false,
  ...extra,
});

describe("renderChangelog", () => {
  it("lists releases newest first, hides drafts, and keeps the body without its downloads table", () => {
    const markdown = renderChangelog([
      release("v0.1.0", "2026-10-31T10:00:00Z"),
      release("v0.1.8", "2026-11-05T10:00:00Z", { draft: true }),
      release("v0.1.7", "2026-11-03T02:47:00Z"),
    ]);
    expect(markdown.indexOf("v0.1.7")).toBeLessThan(markdown.indexOf("v0.1.0"));
    expect(markdown).not.toContain("v0.1.8");
    expect(markdown).toContain(
      "## [v0.1.7](https://github.com/zt-hky/k-code/releases/tag/v0.1.7) · 2026-11-03",
    );
    expect(markdown).toContain("### Highlights");
    expect(markdown).not.toContain("curl x");
    expect(markdown).toContain("**Full changelog**");
  });
});

describe("buildChangelogMarkdown", () => {
  it("falls back to the repository's release notes when GitHub is rate limited", async () => {
    const warnings: string[] = [];
    const markdown = await buildChangelogMarkdown({
      releasesDir: new URL("../../../docs/releases", import.meta.url).pathname,
      fetchFn: async () => new Response("rate limited", { status: 403 }),
      log: (message: string) => warnings.push(message),
    });
    expect(warnings[0]).toContain("403");
    expect(markdown).toContain("[v0.1.7]");
  });
});
