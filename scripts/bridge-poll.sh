#!/usr/bin/env bash
# Poll the Claude Bridge for new messages and print them.
# Usage: ./scripts/bridge-poll.sh [interval_seconds]
#   Default interval: 5 seconds
#   Set BRIDGE_URL to override (default: http://localhost:3001)

BRIDGE_URL="${BRIDGE_URL:-http://localhost:3001}"
INTERVAL="${1:-5}"
SINCE=""

while true; do
  if [ -z "$SINCE" ]; then
    URL="$BRIDGE_URL/api/bridge/messages"
  else
    URL="$BRIDGE_URL/api/bridge/messages?since=$SINCE"
  fi

  RESPONSE=$(curl -sf "$URL" 2>/dev/null)
  if [ $? -ne 0 ]; then
    sleep "$INTERVAL"
    continue
  fi

  COUNT=$(echo "$RESPONSE" | python3 -c "import sys,json; print(len(json.load(sys.stdin)['messages']))" 2>/dev/null)

  if [ "$COUNT" -gt 0 ] 2>/dev/null; then
    echo "$RESPONSE" | python3 -c "
import sys, json
msgs = json.load(sys.stdin)['messages']
for m in msgs:
    who = 'Claude Code' if m['from'] == 'code' else 'Browser'
    ts = m['timestamp'][11:19]
    print(f'[{ts}] {who}: {m[\"content\"]}')
    print()
" 2>/dev/null

    # Update since to latest message timestamp
    SINCE=$(echo "$RESPONSE" | python3 -c "
import sys, json
msgs = json.load(sys.stdin)['messages']
print(msgs[-1]['timestamp'])
" 2>/dev/null)
  fi

  sleep "$INTERVAL"
done
