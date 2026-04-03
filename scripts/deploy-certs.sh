#!/bin/bash
# Deploy Let's Encrypt certs to UDM Pro and Synology NAS
# Run after certbot renewal (via post-renewal hook or cron)

set -e

ENV_FILE="$(dirname "$0")/../.env"

# Read .env
get_env() { grep "^$1=" "$ENV_FILE" | cut -d= -f2-; }

DOMAIN=$(get_env DOMAIN)
CERT_DIR="${CERTS_DIR:-$HOME/certs/config/live/${DOMAIN:?DOMAIN env var required}}"

UNIFI_HOST=$(get_env UNIFI_HOST)
UNIFI_SSH_PASSWORD=$(get_env UNIFI_SSH_PASSWORD)
SYNOLOGY_HOST=$(get_env SYNOLOGY_HOST)
SYNOLOGY_USERNAME=$(get_env SYNOLOGY_USERNAME)
SYNOLOGY_PASSWORD=$(get_env SYNOLOGY_PASSWORD)

echo "$(date): Deploying certs..."

# --- UDM Pro via SSH ---
if [ -n "$UNIFI_SSH_PASSWORD" ]; then
  echo "  Deploying to UDM Pro..."
  # Find the custom cert UUID file
  CERT_ID=$(sshpass -p "$UNIFI_SSH_PASSWORD" ssh -o StrictHostKeyChecking=no -o ConnectTimeout=10 \
    root@"$UNIFI_HOST" "ls /data/unifi-core/config/*.crt 2>/dev/null | grep -oP '[0-9a-f-]{36}' | head -1" 2>/dev/null)

  if [ -n "$CERT_ID" ]; then
    sshpass -p "$UNIFI_SSH_PASSWORD" scp -o StrictHostKeyChecking=no \
      "$CERT_DIR/fullchain.pem" "root@$UNIFI_HOST:/data/unifi-core/config/${CERT_ID}.crt"
    sshpass -p "$UNIFI_SSH_PASSWORD" scp -o StrictHostKeyChecking=no \
      "$CERT_DIR/privkey.pem" "root@$UNIFI_HOST:/data/unifi-core/config/${CERT_ID}.key"
    sshpass -p "$UNIFI_SSH_PASSWORD" ssh -o StrictHostKeyChecking=no \
      root@"$UNIFI_HOST" "unifi-os restart" 2>/dev/null || true
    echo "  ✓ UDM Pro cert deployed (ID: $CERT_ID)"
  else
    echo "  ✗ No custom cert found on UDM — upload one manually first"
  fi
else
  echo "  ⚠ Skipping UDM (no UNIFI_SSH_PASSWORD)"
fi

# --- Synology NAS via API ---
if [ -n "$SYNOLOGY_HOST" ] && [ -n "$SYNOLOGY_USERNAME" ] && [ -n "$SYNOLOGY_PASSWORD" ]; then
  echo "  Deploying to Synology NAS..."
  SID=$(curl -sk --max-time 15 \
    "https://$SYNOLOGY_HOST:5001/webapi/auth.cgi?api=SYNO.API.Auth&version=3&method=login&account=$SYNOLOGY_USERNAME&passwd=$SYNOLOGY_PASSWORD&format=cookie" \
    | python3 -c "import sys,json; print(json.load(sys.stdin)['data']['sid'])" 2>/dev/null)

  if [ -n "$SID" ]; then
    # Find existing Let's Encrypt cert ID
    CERT_ID=$(curl -sk --max-time 15 -b "id=$SID" \
      "https://$SYNOLOGY_HOST:5001/webapi/entry.cgi?api=SYNO.Core.Certificate.CRT&version=1&method=list" \
      | python3 -c "
import sys, json
certs = json.load(sys.stdin)['data']['certificates']
for c in certs:
    if 'Let' in c.get('issuer',{}).get('organization',''):
        print(c['id']); break
" 2>/dev/null)

    RESULT=$(curl -sk --max-time 30 -b "id=$SID" \
      -F "key=@$CERT_DIR/privkey.pem" \
      -F "cert=@$CERT_DIR/fullchain.pem" \
      -F "inter_cert=@$CERT_DIR/chain.pem" \
      -F "id=${CERT_ID}" \
      -F "desc=${DOMAIN}" \
      -F "as_default=true" \
      "https://$SYNOLOGY_HOST:5001/webapi/entry.cgi?api=SYNO.Core.Certificate&version=1&method=import")

    if echo "$RESULT" | python3 -c "import sys,json; assert json.load(sys.stdin)['success']" 2>/dev/null; then
      echo "  ✓ Synology cert deployed"
    else
      echo "  ✗ Synology cert deploy failed: $RESULT"
    fi

    # Logout
    curl -sk --max-time 5 "https://$SYNOLOGY_HOST:5001/webapi/auth.cgi?api=SYNO.API.Auth&version=1&method=logout&_sid=$SID" >/dev/null 2>&1
  else
    echo "  ✗ Synology login failed"
  fi
else
  echo "  ⚠ Skipping Synology (not configured)"
fi

echo "$(date): Done."
