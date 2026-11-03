// Builds the Markdown of /docs/changelog/ from the GitHub Releases of zt-hky/k-code, so the page
// has the same source as the release notes. When the API is unreachable or rate limited the build
// falls back to docs/releases/*.md in this repo, which the release workflow publishes from.
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";

const REPOSITORY = "zt-hky/k-code";
const RELEASES_API = `https://api.github.com/repos/${REPOSITORY}/releases?per_page=100`;
const MAX_PAGES = 5;

/** The per-release downloads table is on the home page already; drop it from the changelog. */
const DOWNLOADS_SECTION = /^## Downloads\b[\s\S]*?(?=^\*\*Full changelog\*\*|(?![\s\S]))/m;

/** Release bodies use `##` sections; under a `## vX` entry they become `###`. Fences are left alone. */
function demoteHeadings(markdown) {
  let fenced = false;
  return markdown
    .split("\n")
    .map((line) => {
      if (/^```/.test(line)) fenced = !fenced;
      return !fenced && /^#{1,5} /.test(line) ? `#${line}` : line;
    })
    .join("\n");
}

export function renderEntry({ tag, url, date, body }) {
  const heading = `## [${tag}](${url})${date ? ` · ${date.slice(0, 10)}` : ""}`;
  const text = demoteHeadings((body ?? "").replace(DOWNLOADS_SECTION, "").trim());
  return `${heading}\n\n${text}\n`;
}

/** Newest first, drafts hidden. Entries without a date (local fallback) sort by version. */
export function renderChangelog(releases) {
  const byVersion = (a, b) =>
    b.tag.localeCompare(a.tag, undefined, { numeric: true, sensitivity: "base" });
  return releases
    .filter((release) => !release.draft)
    .sort((a, b) => (b.date ?? "").localeCompare(a.date ?? "") || byVersion(a, b))
    .map(renderEntry)
    .join("\n");
}

async function fetchGithubReleases(fetchFn, token) {
  const releases = [];
  for (let page = 1; page <= MAX_PAGES; page += 1) {
    const response = await fetchFn(`${RELEASES_API}&page=${page}`, {
      headers: {
        accept: "application/vnd.github+json",
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) throw new Error(`GitHub releases API answered ${response.status}`);
    const batch = await response.json();
    releases.push(
      ...batch.map((release) => ({
        tag: release.tag_name,
        url: release.html_url,
        date: release.published_at ?? release.created_at,
        body: release.body,
        draft: release.draft,
      })),
    );
    if (batch.length < 100) break;
  }
  return releases;
}

function readLocalReleases(releasesDir) {
  if (!NodeFS.existsSync(releasesDir)) return [];
  return NodeFS.readdirSync(releasesDir)
    .filter((name) => /^\d+\.\d+\.\d+.*\.md$/.test(name))
    .map((name) => {
      const tag = `v${name.replace(/\.md$/, "")}`;
      return {
        tag,
        url: `https://github.com/${REPOSITORY}/releases/tag/${tag}`,
        date: null,
        body: NodeFS.readFileSync(NodePath.join(releasesDir, name), "utf8"),
        draft: false,
      };
    });
}

export async function buildChangelogMarkdown({
  releasesDir,
  fetchFn = globalThis.fetch,
  token = process.env.GITHUB_TOKEN,
  log = console.warn,
}) {
  let releases;
  try {
    releases = await fetchGithubReleases(fetchFn, token);
    if (releases.filter((release) => !release.draft).length === 0) {
      throw new Error("GitHub returned no published releases");
    }
  } catch (error) {
    log(`changelog: ${error.message}; using docs/releases/ from the repository instead`);
    releases = readLocalReleases(releasesDir);
  }
  if (releases.length === 0)
    throw new Error("changelog: no releases from GitHub or docs/releases/");
  return renderChangelog(releases);
}
