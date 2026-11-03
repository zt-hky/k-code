export const SITE_URL = "https://kcode.agentbox.io.vn";
export const GITHUB_URL = "https://github.com/zt-hky/k-code";
export const RELEASES_URL = `${GITHUB_URL}/releases`;
export const AGENTBOX_URL = "https://agentbox.io.vn";

export interface LatestRelease {
  readonly version: string;
  readonly assets: ReadonlyMap<string, string>;
}

/** The newest published release, or null when GitHub is unreachable (the page then falls back to /latest/download links). */
export async function fetchLatestRelease(): Promise<LatestRelease | null> {
  try {
    const response = await fetch(`https://api.github.com/repos/zt-hky/k-code/releases/latest`, {
      headers: { accept: "application/vnd.github+json" },
      signal: AbortSignal.timeout(8_000),
    });
    if (!response.ok) return null;
    const release = (await response.json()) as {
      tag_name: string;
      assets: { name: string; browser_download_url: string }[];
    };
    return {
      version: release.tag_name.replace(/^v/, ""),
      assets: new Map(release.assets.map((a) => [a.name, a.browser_download_url])),
    };
  } catch {
    return null;
  }
}

export const INSTALL_SH = `curl -fsSL ${SITE_URL}/install.sh | sh`;
export const INSTALL_PS1 = `irm ${SITE_URL}/install.ps1 | iex`;

export const assetUrl = (name: string) => `${RELEASES_URL}/latest/download/${name}`;

export interface DownloadAsset {
  readonly id: string;
  readonly platform: "linux" | "windows" | "macos";
  readonly label: string;
  readonly file: string;
  readonly note?: string;
}

export const DESKTOP_ASSETS: readonly DownloadAsset[] = [
  {
    id: "linux-appimage",
    platform: "linux",
    label: "Linux AppImage (x86_64)",
    file: "K-code-linux-x86_64.AppImage",
  },
  {
    id: "linux-deb",
    platform: "linux",
    label: "Linux .deb (amd64)",
    file: "K-code-linux-amd64.deb",
    note: "Debian, Ubuntu",
  },
  {
    id: "windows",
    platform: "windows",
    label: "Windows installer (x64)",
    file: "K-code-windows-x64-setup.exe",
  },
  {
    id: "macos-arm64",
    platform: "macos",
    label: "macOS Apple Silicon",
    file: "K-code-macos-arm64.dmg",
    note: "Unsigned",
  },
  {
    id: "macos-x64",
    platform: "macos",
    label: "macOS Intel",
    file: "K-code-macos-x64.dmg",
    note: "Unsigned",
  },
];

export const SERVER_ASSETS: readonly DownloadAsset[] = [
  {
    id: "srv-linux-x64",
    platform: "linux",
    label: "Linux x64",
    file: "kcode-server-linux-x64.tar.gz",
  },
  {
    id: "srv-linux-arm64",
    platform: "linux",
    label: "Linux arm64",
    file: "kcode-server-linux-arm64.tar.gz",
  },
  {
    id: "srv-macos-arm64",
    platform: "macos",
    label: "macOS Apple Silicon",
    file: "kcode-server-macos-arm64.tar.gz",
  },
  {
    id: "srv-macos-x64",
    platform: "macos",
    label: "macOS Intel",
    file: "kcode-server-macos-x64.tar.gz",
  },
  {
    id: "srv-windows-x64",
    platform: "windows",
    label: "Windows x64",
    file: "kcode-server-windows-x64.zip",
  },
];

export const CHECKSUMS_FILE = "SHA256SUMS.txt";
