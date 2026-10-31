#!/bin/sh
# K-code installer for Linux and macOS.
#
#   curl -fsSL https://kcode.agentbox.io.vn/install.sh | sh                 # headless server + `kcode` CLI
#   curl -fsSL https://kcode.agentbox.io.vn/install.sh | sh -s -- --desktop # desktop app
#
# Needs only sh, tar, curl or wget, and sha256sum or shasum. No Node required.
#
# Options:
#   --server            install the server CLI (default)
#   --desktop           install the desktop app instead
#   --version <x.y.z>   install a specific release instead of the latest
#   --dir <path>        directory for the `kcode` command (default: ~/.local/bin,
#                       or /usr/local/bin when run as root)
#   --system            install the `kcode` command into /usr/local/bin with sudo
#   --dry-run           download and verify, but change nothing on this machine
#   -h, --help          show this help
#
# Environment:
#   KCODE_VERSION        same as --version
#   KCODE_DOWNLOAD_BASE  where assets are fetched from (default:
#                        https://github.com/zt-hky/k-code/releases/latest/download, or
#                        .../releases/download/v<version> with a version). A plain
#                        directory path or file:// URL works for local mirrors.
#   KCODE_HOME           where the server is unpacked (default: ~/.local/share/kcode)
#   KCODE_INSTALL_DIR    same as --dir
#   KCODE_DRY_RUN=1      same as --dry-run
#
# Re-running is safe: an install whose archive checksum already matches is left
# as is, and a different release replaces the old one.
set -eu

repo="zt-hky/k-code"
mode="server"
version="${KCODE_VERSION:-}"
bin_dir="${KCODE_INSTALL_DIR:-}"
system=false
dry_run=false
[ "${KCODE_DRY_RUN:-}" = "1" ] && dry_run=true
kcode_home="${KCODE_HOME:-$HOME/.local/share/kcode}"

usage() {
  if [ -r "$0" ] && head -n 1 "$0" | grep -q '^#!'; then
    sed -n '2,/^set -eu$/p' "$0" | sed -e '/^set -eu$/d' -e 's/^# \{0,1\}//'
  else
    printf 'K-code installer: --server | --desktop | --version <x.y.z> | --dir <path> | --system | --dry-run\nSee https://kcode.agentbox.io.vn/docs\n'
  fi
}

fail() {
  printf '\nkcode install: %s\n' "$1" >&2
  exit 1
}

while [ $# -gt 0 ]; do
  case "$1" in
    --server) mode="server" ;;
    --desktop) mode="desktop" ;;
    --version) [ $# -ge 2 ] || fail "--version needs a value"; version="$2"; shift ;;
    --version=*) version="${1#--version=}" ;;
    --dir) [ $# -ge 2 ] || fail "--dir needs a value"; bin_dir="$2"; shift ;;
    --dir=*) bin_dir="${1#--dir=}" ;;
    --system) system=true ;;
    --dry-run) dry_run=true ;;
    -h | --help) usage; exit 0 ;;
    *) fail "unknown option $1 (see --help)" ;;
  esac
  shift
done
version="${version#v}"

if [ -n "${KCODE_DOWNLOAD_BASE:-}" ]; then
  base_url="${KCODE_DOWNLOAD_BASE%/}"
elif [ -n "$version" ]; then
  base_url="https://github.com/${repo}/releases/download/v${version}"
else
  base_url="https://github.com/${repo}/releases/latest/download"
fi

# ANSI stays on stderr so `curl ... | sh` output remains readable.
reset= bold= muted= green=
if [ -t 2 ] && [ "${TERM:-}" != dumb ] && [ -z "${NO_COLOR:-}" ]; then
  reset="$(printf '\033[0m')"; bold="$(printf '\033[1m')"
  muted="$(printf '\033[2m')"; green="$(printf '\033[32m')"
fi
step() { printf '  %s%s%s\n' "$muted" "$1" "$reset" >&2; }
say() { printf '%s\n' "$1" >&2; }

# Runs a command as root: directly when already root, through sudo otherwise.
as_root() {
  if [ "$(id -u)" -eq 0 ]; then "$@"
  elif command -v sudo >/dev/null 2>&1; then sudo "$@"
  else fail "root is required for: $* (install sudo or re-run as root)"; fi
}

# In dry-run mode every system change is only reported.
act() {
  if "$dry_run"; then
    printf '  %s[dry-run] %s%s\n' "$muted" "$*" "$reset" >&2
  else
    "$@"
  fi
}

case "$(uname -s)" in
  Darwin) os="macos" ;;
  Linux) os="linux" ;;
  *) fail "unsupported operating system $(uname -s); on Windows use install.ps1" ;;
esac
case "$(uname -m)" in
  arm64 | aarch64) arch="arm64" ;;
  x86_64 | amd64) arch="x64" ;;
  *) fail "unsupported architecture $(uname -m)" ;;
esac

if command -v sha256sum >/dev/null 2>&1; then
  checksum() { sha256sum "$1" | cut -d' ' -f1; }
elif command -v shasum >/dev/null 2>&1; then
  checksum() { shasum -a 256 "$1" | cut -d' ' -f1; }
else
  fail "sha256sum or shasum is required"
fi

# fetch <asset> <dest>; works with a URL base, file:// or a plain directory.
fetch() {
  f_asset="$1"; f_dest="$2"
  case "$base_url" in
    file://*) cp "${base_url#file://}/${f_asset}" "$f_dest" || return 1; return 0 ;;
    /*) cp "${base_url}/${f_asset}" "$f_dest" || return 1; return 0 ;;
  esac
  if command -v curl >/dev/null 2>&1; then
    curl -fSL --retry 3 --progress-bar "${base_url}/${f_asset}" -o "$f_dest" || return 1
  elif command -v wget >/dev/null 2>&1; then
    wget -q --show-progress "${base_url}/${f_asset}" -O "$f_dest" || return 1
  else
    fail "curl or wget is required"
  fi
}

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

printf '\n  %sK-code installer%s  (%s-%s, %s)\n\n' "$bold" "$reset" "$os" "$arch" "$mode" >&2

# Downloads <asset> into $tmp and checks it against SHA256SUMS.txt; sets $sha.
download_verified() {
  asset="$1"
  step "Fetching checksums..."
  fetch "SHA256SUMS.txt" "$tmp/SHA256SUMS.txt" || fail "could not download SHA256SUMS.txt from ${base_url}"
  expected="$(grep " \*\{0,1\}${asset}\$" "$tmp/SHA256SUMS.txt" | cut -d' ' -f1 | head -n 1)"
  [ -n "$expected" ] || fail "${asset} is not listed in SHA256SUMS.txt (no build for ${os}-${arch}?)"
  step "Downloading ${asset}..."
  fetch "$asset" "$tmp/$asset" || fail "could not download ${asset} from ${base_url}"
  step "Verifying SHA-256..."
  actual="$(checksum "$tmp/$asset")"
  [ "$actual" = "$expected" ] || fail "checksum mismatch for ${asset} (expected ${expected}, got ${actual})"
  sha="$actual"
}

resolve_bin_dir() {
  if [ -n "$bin_dir" ]; then return; fi
  if "$system" || [ "$(id -u)" -eq 0 ]; then bin_dir="/usr/local/bin"; else bin_dir="$HOME/.local/bin"; fi
}

done_message() {
  say ""
  printf '  %sDry run finished: %s verified, nothing was installed.%s\n\n' "$green" "$1" "$reset" >&2
}

install_server() {
  command -v tar >/dev/null 2>&1 || fail "tar is required"
  asset="kcode-server-${os}-${arch}.tar.gz"
  download_verified "$asset"
  resolve_bin_dir

  target="${kcode_home}/server"
  link="${bin_dir}/kcode"

  if [ -f "${target}/.sha256" ] && [ "$(cat "${target}/.sha256")" = "$sha" ]; then
    step "This release is already installed in ${target}."
  else
    step "Unpacking..."
    mkdir -p "$tmp/unpack"
    tar -xzf "$tmp/$asset" -C "$tmp/unpack" --strip-components=1
    [ -x "$tmp/unpack/t3" ] || fail "the archive does not contain the server executable"
    "$tmp/unpack/t3" --version >/dev/null 2>&1 || fail "the downloaded executable does not run on this machine"
    printf '%s\n' "$sha" > "$tmp/unpack/.sha256"
    if "$dry_run"; then
      step "[dry-run] would install into ${target}"
    else
      mkdir -p "$kcode_home"
      stage="$(mktemp -d "${kcode_home}/.install-XXXXXX")"
      mv "$tmp/unpack" "$stage/new"
      if [ -d "$target" ]; then mv "$target" "$stage/old"; fi
      mv "$stage/new" "$target"
      rm -rf "$stage"
    fi
  fi

  step "Linking ${link}"
  if "$system" || { [ "$(id -u)" -ne 0 ] && [ -d "$bin_dir" ] && [ ! -w "$bin_dir" ]; }; then
    act as_root mkdir -p "$bin_dir"
    act as_root ln -sfn "${target}/t3" "$link"
  else
    act mkdir -p "$bin_dir"
    act ln -sfn "${target}/t3" "$link"
  fi

  if "$dry_run"; then done_message "$asset"; return; fi
  say ""
  printf '  %sInstalled K-code server%s\n\n' "$green" "$reset" >&2
  case ":${PATH}:" in
    *":${bin_dir}:"*) ;;
    *) printf '  Add %s to your PATH first:\n    export PATH="%s:$PATH"\n\n' "$bin_dir" "$bin_dir" >&2 ;;
  esac
  printf '  Next steps:\n    %skcode serve%s                 start the server; it prints a pairing URL to open in your browser\n    %skcode auth pairing create%s   issue another pairing link for a new device\n    https://kcode.agentbox.io.vn/docs\n\n' "$bold" "$reset" "$bold" "$reset" >&2
}

install_desktop() {
  case "$os" in
    macos)
      asset="K-code-macos-${arch}.dmg"
      download_verified "$asset"
      app_dir="/Applications"
      if [ ! -w "$app_dir" ]; then app_dir="$HOME/Applications"; fi
      step "Installing into ${app_dir}..."
      if "$dry_run"; then
        step "[dry-run] would mount ${asset} and copy the app to ${app_dir}"
        done_message "$asset"
        return
      fi
      command -v hdiutil >/dev/null 2>&1 || fail "hdiutil not found"
      mkdir -p "$app_dir"
      mount="$tmp/dmg"
      mkdir -p "$mount"
      hdiutil attach -nobrowse -readonly -mountpoint "$mount" "$tmp/$asset" >/dev/null || fail "could not mount ${asset}"
      app="$(find "$mount" -maxdepth 1 -name '*.app' | head -n 1)"
      if [ -z "$app" ]; then hdiutil detach "$mount" -force >/dev/null 2>&1 || true; fail "no .app found in ${asset}"; fi
      app_name="$(basename "$app")"
      rm -rf "${app_dir:?}/${app_name}"
      cp -R "$app" "$app_dir/"
      hdiutil detach "$mount" -force >/dev/null 2>&1 || true
      # Builds are unsigned, so clear the quarantine flag Gatekeeper would block on.
      xattr -dr com.apple.quarantine "${app_dir}/${app_name}" 2>/dev/null || true
      say ""
      printf '  %sInstalled K-code to %s%s\n\n  Open it from Launchpad, or run: open -a K-code\n\n' "$green" "$app_dir" "$reset" >&2
      ;;
    linux)
      [ "$arch" = "x64" ] || fail "the desktop app is only built for x86_64 Linux; run without --desktop to install the server"
      if command -v apt-get >/dev/null 2>&1 && command -v dpkg >/dev/null 2>&1; then
        asset="K-code-linux-amd64.deb"
        download_verified "$asset"
        step "Installing the .deb with apt (needs root)..."
        # apt's sandbox user must be able to read the file.
        chmod 755 "$tmp"
        chmod 644 "$tmp/$asset"
        act as_root apt-get install -y "$tmp/$asset"
        if "$dry_run"; then done_message "$asset"; return; fi
        say ""
        printf '  %sInstalled K-code%s\n\n  Launch it from your applications menu, or run: t3code\n\n' "$green" "$reset" >&2
      else
        asset="K-code-linux-x86_64.AppImage"
        download_verified "$asset"
        apps="$HOME/Applications"
        step "Installing the AppImage into ${apps}..."
        if "$dry_run"; then
          step "[dry-run] would copy ${asset} to ${apps}/K-code.AppImage"
          done_message "$asset"
          return
        fi
        mkdir -p "$apps" "$HOME/.local/share/applications"
        cp "$tmp/$asset" "${apps}/K-code.AppImage.new"
        chmod +x "${apps}/K-code.AppImage.new"
        mv "${apps}/K-code.AppImage.new" "${apps}/K-code.AppImage"
        cat > "$HOME/.local/share/applications/kcode.desktop" <<EOF
[Desktop Entry]
Type=Application
Name=K-code
Comment=The open GUI for your coding agents
Exec=${apps}/K-code.AppImage %U
Terminal=false
Categories=Development;
EOF
        say ""
        printf '  %sInstalled K-code to %s/K-code.AppImage%s\n\n  Launch it from your applications menu, or run it directly.\n  If it does not start, install FUSE or run it with --appimage-extract-and-run.\n\n' "$green" "$apps" "$reset" >&2
      fi
      ;;
  esac
}

case "$mode" in
  server) install_server ;;
  desktop) install_desktop ;;
esac
