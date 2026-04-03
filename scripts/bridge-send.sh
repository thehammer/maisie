#!/usr/bin/env bash
# Send a message to the Claude Bridge and wait for a reply.
# Usage: ./scripts/bridge-send.sh "your message here" [timeout_seconds]
#   Default timeout: 120 seconds (2 minutes)
#   Set BRIDGE_URL to override (default: http://localhost:3001)

BRIDGE_URL="${BRIDGE_URL:-http://localhost:3001}"
MESSAGE="$1"
TIMEOUT="${2:-120}"

if [ -z "$MESSAGE" ]; then
  echo "Usage: bridge-send.sh \"message\" [timeout]"
  exit 1
fi

# Send the message
PAYLOAD=$(python3 -c "import json; print(json.dumps({'from':'code','content':$(python3 -c "import json; print(json.dumps('$MESSAGE'))" 2>/dev/null || echo "\"$MESSAGE\"")}))")
RESULT=$(curl -sf -X POST "$BRIDGE_URL/api/bridge/messages" \
  -H 'Content-Type: application/json' \
  -d "$PAYLOAD" 2>/dev/null)

if [ $? -ne 0 ]; then
  echo "Failed to send message"
  exit 1
fi

SEND_TS=$(echo "$RESULT" | python3 -c "import sys,json; print(json.load(sys.stdin)['timestamp'])" 2>/dev/null)
echo "Sent. Waiting for reply (timeout: ${TIMEOUT}s)..."

# Poll for reply
ELAPSED=0
while [ "$ELAPSED" -lt "$TIMEOUT" ]; do
  sleep 5
  ELAPSED=$((ELAPSED + 5))

  RESPONSE=$(curl -sf "$BRIDGE_URL/api/bridge/messages?since=$SEND_TS" 2>/dev/null)
  REPLIES=$(echo "$RESPONSE" | python3 -c "
import sys, json
msgs = [m for m in json.load(sys.stdin)['messages'] if m['from'] == 'browser']
print(len(msgs))
" 2>/dev/null)

  if [ "$REPLIES" -gt 0 ] 2>/dev/null; then
    echo "$RESPONSE" | python3 -c "
import sys, json
msgs = [m for m in json.load(sys.stdin)['messages'] if m['from'] == 'browser']
for m in msgs:
    ts = m['timestamp'][11:19]
    print(f'[{ts}] Browser: {m[\"content\"]}')
    print()
"
    exit 0
  fi
done

echo "Timed out after ${TIMEOUT}s with no reply."
exit 1
