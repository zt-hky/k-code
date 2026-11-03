// Builds the GitHub release body for a version from docs/releases/<version>.md plus the parts that
// are the same every release: the downloads table, the one-line installer, and the compare link.
// The release workflow and any backfill both run this, so the notes have one source.
//   node scripts/compose-release-notes.mjs <version> [--previous vX.Y.Z]
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";
import * as NodeURL from "node:url";
import * as NodeUtil from "node:util";

const repoRoot = NodePath.dirname(NodePath.dirname(NodeURL.fileURLToPath(import.meta.url)));
const GITHUB = "https://github.com/zt-hky/k-code";

const { values, positionals } = NodeUtil.parseArgs({
  allowPositionals: true,
  options: { previous: { type: "string" } },
});
const version = positionals[0]?.replace(/^v/, "");
if (!version || !/^\d+\.\d+\.\d+/.test(version)) {
  throw new Error("usage: compose-release-notes.mjs <version> [--previous vX.Y.Z]");
}

const sourcePath = NodePath.join(repoRoot, "docs", "releases", `${version}.md`);
if (!NodeFS.existsSync(sourcePath)) {
  throw new Error(`Missing release notes: write docs/releases/${version}.md before releasing.`);
}
const body = NodeFS.readFileSync(sourcePath, "utf8").trim();
if (!body.includes("## Highlights")) {
  throw new Error(`docs/releases/${version}.md needs a "## Highlights" section.`);
}

const tag = `v${version}`;
const download = (file) => `${GITHUB}/releases/download/${tag}/${file}`;
const row = (label, file) => `| ${label} | [${file}](${download(file)}) |`;
const downloads = [
  "## Downloads",
  "",
  "| Platform | File |",
  "| --- | --- |",
  row("macOS Apple Silicon (unsigned)", "K-code-macos-arm64.dmg"),
  row("macOS Intel (unsigned)", "K-code-macos-x64.dmg"),
  row("Windows", "K-code-windows-x64-setup.exe"),
  row("Linux AppImage", "K-code-linux-x86_64.AppImage"),
  row("Linux .deb", "K-code-linux-amd64.deb"),
  row("Server, Linux x64", "kcode-server-linux-x64.tar.gz"),
  row("Server, Linux arm64", "kcode-server-linux-arm64.tar.gz"),
  row("Server, macOS Apple Silicon", "kcode-server-macos-arm64.tar.gz"),
  row("Server, macOS Intel", "kcode-server-macos-x64.tar.gz"),
  row("Server, Windows", "kcode-server-windows-x64.zip"),
  row("Checksums (SHA-256)", "SHA256SUMS.txt"),
  "",
  "Install the server with one command:",
  "",
  "```sh",
  "curl -fsSL https://kcode.agentbox.io.vn/install.sh | sh",
  "```",
].join("\n");

const compare = values.previous
  ? `**Full changelog**: ${GITHUB}/compare/${values.previous}...${tag}`
  : `**Full changelog**: ${GITHUB}/commits/${tag}`;

process.stdout.write(`${body}\n\n${downloads}\n\n${compare}\n`);
