#!/usr/bin/env bash
# Build the K-code site (apps/marketing) and publish it for the AgentBox Caddy gateway.
#
# Caddy (container agentbox-caddy, user abx-cp) mounts /var/lib/agentbox-cp/kcode-site read-only at
# /srv/kcode and serves it for kcode.agentbox.io.vn (infra/cp/Caddyfile in the agentbox repo). That
# directory belongs to abx-cp and sits under a 0700 home, so publishing needs sudo.
#
# Usage: scripts/deploy-site.sh [--no-build]
#   KCODE_SITE_DIR   override the destination (default /var/lib/agentbox-cp/kcode-site)
#   KCODE_SITE_OWNER owner of the published files (default abx-cp; empty = leave as the invoking user)
set -euo pipefail

repo=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
dest=${KCODE_SITE_DIR:-/var/lib/agentbox-cp/kcode-site}
owner=${KCODE_SITE_OWNER-abx-cp}
dist=$repo/apps/marketing/dist

if [ "${1:-}" != "--no-build" ]; then
  echo "== building apps/marketing"
  (cd "$repo" && ./node_modules/.bin/vp run --filter @t3tools/marketing build)
fi
[ -f "$dist/index.html" ] || { echo "missing $dist/index.html: build failed?" >&2; exit 1; }
[ -f "$dist/install.sh" ] || echo "warning: $dist/install.sh is missing (apps/marketing/public/install.sh)" >&2

run() { if [ -w "$(dirname "$dest")" ] && [ -z "$owner" ]; then "$@"; else sudo "$@"; fi; }

echo "== publishing to $dest"
stage=$dest.new
run rm -rf --one-file-system "$stage"
run mkdir -p "$stage"
run cp -a "$dist/." "$stage/"
if [ -n "$owner" ]; then run chown -R "$owner:$owner" "$stage"; fi
run chmod -R a+rX "$stage"
# Swap in place: the container mounts $dest itself, so keep the directory and replace its contents.
run find "$dest" -mindepth 1 -maxdepth 1 -exec rm -rf --one-file-system {} +
run cp -a "$stage/." "$dest/"
run rm -rf --one-file-system "$stage"
echo "== done: https://kcode.agentbox.io.vn/"
