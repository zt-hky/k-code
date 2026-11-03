#!/usr/bin/env bash
# Rebuild and publish the K-code site when the GitHub Releases of zt-hky/k-code change (a new
# release, or edited notes), since the changelog page is built from them. Run from a user systemd
# timer on the host that serves the site; see docs/operations/release.md. GitHub Actions cannot
# publish the site because deploy-site.sh writes into the AgentBox gateway's directory with sudo.
#
# Usage: scripts/sync-site.sh [--force]
#   KCODE_SITE_STATE  where the last published fingerprint is kept (default ~/.local/state/kcode-site)
set -euo pipefail

repo=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
state=${KCODE_SITE_STATE:-$HOME/.local/state/kcode-site}
mkdir -p "$state"

# Tag, date and notes of every published release; download counters are left out on purpose.
fingerprint=$(curl -fsS --max-time 30 -H 'Accept: application/vnd.github+json' \
  'https://api.github.com/repos/zt-hky/k-code/releases?per_page=100' |
  jq -c '[.[] | select(.draft | not) | {tag_name, published_at, body}]' | sha256sum | cut -d' ' -f1)

if [ "${1:-}" != "--force" ] && [ "$(cat "$state/fingerprint" 2>/dev/null || true)" = "$fingerprint" ]; then
  echo "site already matches the latest releases"
  exit 0
fi

# Keep the checkout current so the build uses the published docs and scripts; a dirty or
# diverged checkout is built as is.
git -C "$repo" fetch --quiet fork main && git -C "$repo" merge --quiet --ff-only fork/main ||
  echo "warning: could not fast-forward $repo; building the current checkout" >&2

GITHUB_TOKEN=${GITHUB_TOKEN:-} "$repo/scripts/deploy-site.sh"
printf '%s\n' "$fingerprint" >"$state/fingerprint"
echo "published site for fingerprint ${fingerprint:0:12}"
