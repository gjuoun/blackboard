#!/usr/bin/env bash
# ui-drift.sh — the stock-component contract: every file under src/components/ui/ must be byte-for-byte
# what `shadcn add` produced, so an edit belongs in a wrapper or in composite.css, never in the file.
# The manifest is the reference; regenerate it after a deliberate `shadcn add` upgrade.
#   bash scripts/ui-drift.sh            check
#   bash scripts/ui-drift.sh --write    rewrite the manifest from the current files
set -uo pipefail
cd "$(dirname "$0")/.." || exit 1
MANIFEST=scripts/ui-drift.txt

if [ "${1:-}" = "--write" ]; then
  : > "$MANIFEST"
  for f in src/components/ui/*.tsx; do printf '%s  %s\n' "$(shasum -a 256 "$f" | cut -d' ' -f1)" "$f" >> "$MANIFEST"; done
  echo "ui-drift: wrote $(wc -l < "$MANIFEST" | tr -d ' ') hashes"
  exit 0
fi

[ -f "$MANIFEST" ] || { echo "ui-drift: no $MANIFEST — run with --write first"; exit 1; }
files=0; bad=0
while read -r want path; do
  files=$((files + 1))
  have=$(shasum -a 256 "$path" 2>/dev/null | cut -d' ' -f1)
  [ "$have" = "$want" ] || { bad=$((bad + 1)); echo "drift $path"; }
done < "$MANIFEST"
echo "ui-drift ok files=$files"
[ "$bad" -eq 0 ] || { echo "ui-drift: $bad file(s) differ from the shadcn output — regenerate or move the change out"; exit 1; }