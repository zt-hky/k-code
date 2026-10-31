/**
 * Docs manifest. `user:<file>` pages are adapted from docs/user/<file> at the repo root;
 * `site:<file>` pages are authored in apps/marketing/docs/<file>. scripts/stage-site.mjs turns
 * every entry into src/pages/docs/<slug>.md (generated, gitignored).
 */
export interface DocEntry {
  readonly slug: string;
  readonly title: string;
  readonly group: string;
  readonly source: string;
}

export const DOCS: readonly DocEntry[] = [
  {
    slug: "introduction",
    title: "Introduction",
    group: "Getting started",
    source: "site:introduction.md",
  },
  { slug: "install", title: "Install", group: "Getting started", source: "site:install.md" },
  {
    slug: "quick-start",
    title: "Quick start",
    group: "Getting started",
    source: "site:quick-start.md",
  },

  {
    slug: "providers/overview",
    title: "Overview",
    group: "Providers",
    source: "site:providers-overview.md",
  },
  {
    slug: "providers/claude",
    title: "Claude",
    group: "Providers",
    source: "user:providers-claude.md",
  },
  {
    slug: "providers/codex",
    title: "Codex",
    group: "Providers",
    source: "user:providers-codex.md",
  },
  { slug: "providers/cursor", title: "Cursor", group: "Providers", source: "user:cursor.md" },
  {
    slug: "providers/opencode",
    title: "OpenCode",
    group: "Providers",
    source: "user:providers-opencode.md",
  },
  {
    slug: "providers/oh-my-pi",
    title: "Oh My Pi",
    group: "Providers",
    source: "user:providers-ohmypi.md",
  },
  { slug: "providers/pi", title: "Pi", group: "Providers", source: "user:providers-pi.md" },
  {
    slug: "providers/antigravity",
    title: "Antigravity",
    group: "Providers",
    source: "user:providers-antigravity.md",
  },
  {
    slug: "providers/muse",
    title: "Muse Code",
    group: "Providers",
    source: "user:providers-muse.md",
  },
  { slug: "providers/fx", title: "fx", group: "Providers", source: "user:providers-fx.md" },
  {
    slug: "providers/acp",
    title: "ACP agents",
    group: "Providers",
    source: "user:providers-acp.md",
  },

  {
    slug: "features/agent-hub",
    title: "Agent Hub & running agents",
    group: "Features",
    source: "site:agent-hub.md",
  },
  {
    slug: "features/stopping-subagents",
    title: "Stopping subagents",
    group: "Features",
    source: "site:stopping-subagents.md",
  },
  {
    slug: "features/full-transcript",
    title: "Full transcript",
    group: "Features",
    source: "site:full-transcript.md",
  },
  {
    slug: "features/resume-sessions",
    title: "Resume native sessions",
    group: "Features",
    source: "site:resume-sessions.md",
  },
  {
    slug: "features/settings-sync",
    title: "Settings sync",
    group: "Features",
    source: "site:settings-sync.md",
  },
  {
    slug: "features/remote-access",
    title: "Remote access",
    group: "Features",
    source: "site:remote-access.md",
  },
  {
    slug: "features/keybindings",
    title: "Keybindings",
    group: "Features",
    source: "user:keybindings.md",
  },
  {
    slug: "features/settings",
    title: "Settings & appearance",
    group: "Features",
    source: "user:appearance.md",
  },
  {
    slug: "features/threads",
    title: "Threads & sidebar",
    group: "Features",
    source: "user:thread-sidebar.md",
  },
  {
    slug: "features/permission-modes",
    title: "Permission modes",
    group: "Features",
    source: "user:permission-modes.md",
  },
  { slug: "features/terminal", title: "Terminal", group: "Features", source: "user:terminal.md" },
  {
    slug: "features/source-control",
    title: "Source control",
    group: "Features",
    source: "user:source-control.md",
  },
  {
    slug: "features/background-service",
    title: "Background service",
    group: "Features",
    source: "user:background-service.md",
  },

  {
    slug: "configuration",
    title: "Configuration",
    group: "Reference",
    source: "site:configuration.md",
  },
  {
    slug: "troubleshooting",
    title: "Troubleshooting & FAQ",
    group: "Reference",
    source: "site:troubleshooting.md",
  },
  { slug: "changelog", title: "Changelog", group: "Reference", source: "site:changelog.md" },
];
