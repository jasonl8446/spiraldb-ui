#!/usr/bin/env bash
# Characterize an already-unpacked Root.wad tree (spike 1.4a / friendly-name sync).
#
# Usage: scripts/spike-wad-characterize.sh <unpack-dir>
#
# Prints bounded summaries only — never a full file listing — so it is safe to run
# against a ~173k-file tree (see docs/evidence/phase-1/spike-1.4a.md).
set -euo pipefail

DIR="${1:?usage: $0 <unpack-dir>}"
[ -d "$DIR" ] || { echo "not a directory: $DIR" >&2; exit 2; }

echo "== overview =="
du -sh "$DIR"
printf 'files: %s\ndirs:  %s\n' \
  "$(find "$DIR" -type f | wc -l)" \
  "$(find "$DIR" -type d | wc -l)"

echo
echo "== top-level tree (maxdepth 3, first 50 dirs) =="
# `head` closes these pipes early; `|| true` swallows the resulting SIGPIPE status.
find "$DIR" -maxdepth 3 -type d 2>/dev/null | head -50 || true

echo
echo "== extension histogram (top 25) =="
find "$DIR" -type f -printf '%f\n' 2>/dev/null |
  awk -F. 'NF>1{ext=$NF} NF==1{ext="(none)"} {c[ext]++} END{for(e in c) printf "%8d  %s\n", c[e], e}' |
  sort -rn | head -25 || true

echo
echo "== .lang files =="
printf 'total: %s   en-US: %s\n' \
  "$(find "$DIR" -name '*.lang' | wc -l)" \
  "$(find "$DIR/Locale/en-US" -name '*.lang' 2>/dev/null | wc -l)"

echo
echo "== _className histogram (deserialized templates) =="
# Each <name>_deser.json starts with _fileName then _className; take the first match per file.
grep -rh -m1 --include='*_deser.json' '"_className"' "$DIR" 2>/dev/null |
  sed -E 's/.*"_className"[[:space:]]*:[[:space:]]*"([^"]+)".*/\1/' |
  sort | uniq -c | sort -rn | head -40 || true

echo
echo "== template-family counts =="
echo "NOTE: WAD file names are content names, not types. The type is the JSON '_className'."
grep -rh -m1 --include='*_deser.json' '"_className"' "$DIR" 2>/dev/null |
  sed -E 's/.*"_className"[[:space:]]*:[[:space:]]*"([^"]+)".*/\1/' |
  grep -E '^(Wiz)?ItemTemplate$|^Item(Bundle|Reagent)?Template$|^(Tiered)?SpellTemplate$|^(Wiz)?(GameObject|CinematicActor)Template$|^WizPetTemplate$|^WizMountTemplate$|^ReagentItemTemplate$|^PetSnackItemTemplate$' |
  sort | uniq -c | sort -rn || true