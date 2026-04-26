#!/bin/bash
# Triggered by Readarr after a successful book file import.
# Tells Audiobookshelf to scan its Audiobooks library so the new book shows up.
#
# Readarr passes event details via env vars (readarr_eventtype, readarr_book_*, etc.).
# We don't act on them — we just always trigger a library scan when invoked
# (except for Test events from the UI, which we short-circuit).
#
# Token is loaded from /config/custom-scripts/.abs-token at runtime to keep
# secrets out of version control. The deploy step writes the file from the
# ABS_TOKEN variable.

set -eu
ABS_HOST="192.168.1.10:13378"
ABS_LIB_ID="b25f5da3-d9e4-47cc-8ddf-fabeca98db32"
TOKEN_FILE="/config/custom-scripts/.abs-token"
LOG=/config/custom-scripts/abs-scan.log

ts=$(date '+%Y-%m-%d %H:%M:%S')
event="${readarr_eventtype:-unknown}"
book="${readarr_book_title:-}"
echo "[$ts] event=$event book=$book" >> "$LOG"

# Skip Test events from the Readarr UI's Test button
if [ "$event" = "Test" ]; then
  echo "[$ts] Test event — exiting OK" >> "$LOG"
  exit 0
fi

if [ ! -f "$TOKEN_FILE" ]; then
  echo "[$ts] ERROR: $TOKEN_FILE missing — cannot authenticate to ABS" >> "$LOG"
  exit 1
fi

ABS_TOKEN=$(cat "$TOKEN_FILE")

http=$(curl -s -o /dev/null -w '%{http_code}' \
  -X POST \
  -H "Authorization: Bearer $ABS_TOKEN" \
  "http://$ABS_HOST/api/libraries/$ABS_LIB_ID/scan" || echo 'curl_failed')
echo "[$ts] ABS scan response: HTTP $http" >> "$LOG"
exit 0
