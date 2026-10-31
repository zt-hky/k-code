// Stages generated inputs for the site build:
//   - public/brand/*: logo assets from assets/brand (owned by the brand slice)
//   - src/pages/docs/**.md: one page per entry in src/lib/docs.ts, sourced from docs/user (adapted)
//     or apps/marketing/docs (authored). Both outputs are gitignored.
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";
import * as NodeURL from "node:url";

import { DOCS } from "../src/lib/docs.ts";

const marketingDir = NodePath.dirname(NodePath.dirname(NodeURL.fileURLToPath(import.meta.url)));
const repoRoot = NodePath.dirname(NodePath.dirname(marketingDir));
const publicDir = NodePath.join(marketingDir, "public");
const brandDir = NodePath.join(repoRoot, "assets", "brand");
const userDocsDir = NodePath.join(repoRoot, "docs", "user");
const siteDocsDir = NodePath.join(marketingDir, "docs");
const pagesDocsDir = NodePath.join(marketingDir, "src", "pages", "docs");
const GITHUB = "https://github.com/zt-hky/k-code";

function copyIfExists(from, to) {
  if (!NodeFS.existsSync(from)) return false;
  NodeFS.mkdirSync(NodePath.dirname(to), { recursive: true });
  NodeFS.copyFileSync(from, to);
  return true;
}

// brand assets
NodeFS.rmSync(NodePath.join(publicDir, "brand"), { recursive: true, force: true });
for (const name of NodeFS.existsSync(brandDir) ? NodeFS.readdirSync(brandDir) : []) {
  if (name.endsWith(".svg") || name === "palette.json") {
    copyIfExists(NodePath.join(brandDir, name), NodePath.join(publicDir, "brand", name));
  }
}
const png = (size) => NodePath.join(brandDir, "png", `${size}.png`);
const pngNamed = (size) => NodePath.join(brandDir, "png", `kcode-${size}.png`);
const pickPng = (size) => (NodeFS.existsSync(png(size)) ? png(size) : pngNamed(size));
copyIfExists(NodePath.join(brandDir, "kcode-mark.svg"), NodePath.join(publicDir, "favicon.svg"));
if (
  !copyIfExists(NodePath.join(brandDir, "favicon.ico"), NodePath.join(publicDir, "favicon.ico"))
) {
  copyIfExists(
    NodePath.join(brandDir, "png", "favicon.ico"),
    NodePath.join(publicDir, "favicon.ico"),
  );
}
copyIfExists(pickPng(180), NodePath.join(publicDir, "apple-touch-icon.png"));
copyIfExists(pickPng(512), NodePath.join(publicDir, "og.png"));

// docs
const fileToSlug = new Map();
for (const entry of DOCS) {
  const [kind, file] = entry.source.split(":");
  if (kind === "user") fileToSlug.set(file, entry.slug);
}

// Hosted T3 services (T3 Connect, T3 Chat, app.t3.codes) do not exist for K-code: drop the
// paragraphs, list items and sections that describe them.
const HOSTED = /T3 Connect|T3 Chat|app\.t3\.codes|t3-connect/i;
function dropHostedBlocks(text) {
  const lines = text.split("\n");
  const kept = [];
  let fenced = false;
  let skipLevel = 0;
  let block = [];
  const flush = () => {
    if (block.length === 0) return;
    if (!block.some((l) => HOSTED.test(l))) kept.push(...block);
    block = [];
    kept.push("");
  };
  for (const line of lines) {
    if (/^```/.test(line)) fenced = !fenced;
    const heading = !fenced && /^(#{1,6}) /.exec(line);
    if (heading) {
      flush();
      const level = heading[1].length;
      if (skipLevel && level <= skipLevel) skipLevel = 0;
      if (!skipLevel && HOSTED.test(line)) skipLevel = level;
      if (!skipLevel) block.push(line);
      continue;
    }
    if (skipLevel) continue;
    if (!fenced && line.trim() === "") flush();
    else block.push(line);
  }
  flush();
  return kept.join("\n").replace(/\n{3,}/g, "\n\n");
}

function adapt(text) {
  let out = text
    // Product + repo naming (docs/user is being reworded in parallel; this is a safety net).
    .replaceAll("T3 Code", "K-code")
    .replaceAll("https://github.com/pingdotgg/t3code", GITHUB)
    .replaceAll("pingdotgg/t3code", "zt-hky/k-code")
    .replaceAll("https://t3.codes/install", "https://kcode.agentbox.io.vn/install")
    .replace(/\bnpx t3(@latest)?\b/g, "kcode")
    .replace(/`t3 (serve|pair|auth|service|update|doctor|uninstall|app|help|start)\b/g, "`kcode $1")
    .replace(
      /^(\s*)t3 (serve|pair|auth|service|update|doctor|uninstall|app|help|start)\b/gm,
      "$1kcode $2",
    )
    .replace(/\[([^\]]+)\]\(\.\/([a-z0-9-]+\.md)(#[^)]*)?\)/g, (_m, label, file, hash = "") => {
      const slug = fileToSlug.get(file);
      return slug
        ? `[${label}](/docs/${slug}/${hash})`
        : `[${label}](${GITHUB}/blob/main/docs/user/${file}${hash})`;
    });
  out = dropHostedBlocks(out)
    .replaceAll("T3-owned", "K-code-owned")
    .replaceAll("T3-managed", "K-code-managed")
    .replaceAll("T3 tools", "K-code tools")
    .replaceAll("T3 owns", "K-code owns")
    .replaceAll("T3 data directory", "K-code data directory")
    .replaceAll("`t3` executable", "`kcode` executable")
    .replace(/`t3 (theme|connect)\b/g, "`kcode $1");
  // Drop the leading H1: the layout renders the title itself.
  out = out.replace(/^\s*# .*\n+/, "");
  return out;
}

NodeFS.rmSync(pagesDocsDir, { recursive: true, force: true });
for (const entry of DOCS) {
  const [kind, file] = entry.source.split(":");
  const dir = kind === "user" ? userDocsDir : siteDocsDir;
  const raw = NodeFS.readFileSync(NodePath.join(dir, file), "utf8");
  const body = kind === "user" ? adapt(raw) : raw;
  const frontmatter = [
    "---",
    `layout: ${"../".repeat(entry.slug.split("/").length + 1)}layouts/DocsLayout.astro`,
    `title: ${JSON.stringify(entry.title)}`,
    `slug: ${JSON.stringify(entry.slug)}`,
    `source: ${JSON.stringify(kind === "user" ? `docs/user/${file}` : `apps/marketing/docs/${file}`)}`,
    "---",
    "",
  ].join("\n");
  const target = NodePath.join(pagesDocsDir, `${entry.slug}.md`);
  NodeFS.mkdirSync(NodePath.dirname(target), { recursive: true });
  NodeFS.writeFileSync(target, frontmatter + body);
}
console.log(`staged ${DOCS.length} docs pages`);
