#!/usr/bin/env bash
# Fail when a built app points at its own assets through a subpath.
#
#   scripts/check-asset-prefixes.sh                 # every app's deployable directory
#   scripts/check-asset-prefixes.sh apps/bundant/dist
#   → ASSET-PREFIX OK apps=5 local-refs=<n>
#   → ASSET-PREFIX FAILED ... (one line per offender)
#
# Why this exists: apps/bundant shipped with astro's GitHub Pages base ('/bundant'), so every asset
# reference became /bundant/_astro/*.css. The Pages project is gone and the site is served from the
# ROOT of bundant.qqntt.com, where that path 404s — the page arrived unstyled and only a visual pass
# caught it. A base is a property of the site, not of the runner it is built on, so this gate checks
# the BUILT output rather than trusting the config: every local reference must start at '/' AND the
# file it names must exist in the same build.
set -uo pipefail

root=$(cd "$(dirname "$0")/.." && pwd)
cd "$root" || exit 2

if [ "$#" -gt 0 ]; then
  dirs=("$@")
else
  dirs=()
  for d in apps/*/dist; do [ -d "$d" ] && dirs+=("$d"); done
fi

[ "${#dirs[@]}" -gt 0 ] || { echo "ASSET-PREFIX error=no-built-dirs (build first)"; exit 2; }

problems=0
apps=0
refs=0

for dir in "${dirs[@]}"; do
  [ -d "$dir" ] || { echo "MISSING-DIR $dir"; problems=$((problems + 1)); continue; }
  apps=$((apps + 1))

  # every href/src that is a local path
  while IFS= read -r ref; do
    refs=$((refs + 1))

    case "$ref" in
      //*)
        echo "NON-ROOT $dir: $ref (protocol-relative)"
        problems=$((problems + 1)); continue ;;
    esac

    # a bare '/' or '/docs/' is a route, not an asset: only asset-looking paths are resolved
    case "$ref" in
      /_astro/*|/fonts/*|/themes/*|/downloads/*|/assets/*|/img/*) ;;
      *) continue ;;
    esac

    target="$dir${ref%%\?*}"
    if [ ! -f "$target" ]; then
      echo "BROKEN-REF $dir: $ref (no ${target})"
      problems=$((problems + 1))
    fi
  done < <(rg -o --no-filename '(?:href|src)="/[^"]*"' "$dir" -g '*.html' 2>/dev/null | sed -E 's/^(href|src)="//; s/"$//' | sort -u)

  # the specific shape that broke prod: some other app's prefix, e.g. /bundant/_astro/...
  while IFS= read -r ref; do
    echo "SUB-PATH $dir: $ref"
    problems=$((problems + 1))
  done < <(rg -o --no-filename '(?:href|src)="/[a-z0-9-]+/(?:_astro|fonts|themes|downloads|assets|img)/[^"]*"' "$dir" -g '*.html' 2>/dev/null | sed -E 's/^(href|src)="//; s/"$//' | sort -u)
done

if [ "$problems" -eq 0 ]; then
  echo "ASSET-PREFIX OK apps=$apps local-refs=$refs"
  exit 0
fi
echo "ASSET-PREFIX FAILED apps=$apps local-refs=$refs problems=$problems"
exit 1
