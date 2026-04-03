#!/bin/bash
# Updates Route 53 A records with current WAN IP
# Run via cron every 5 minutes

ZONE_ID="${ROUTE53_ZONE_ID:?ROUTE53_ZONE_ID env var required}"
DOMAIN="${DOMAIN:?DOMAIN env var required}"
RECORDS=("$DOMAIN" "vpn.$DOMAIN")

CURRENT_IP=$(curl -s --max-time 5 https://api.ipify.org)
if [ -z "$CURRENT_IP" ]; then
  echo "$(date): Failed to get WAN IP" >&2
  exit 1
fi

# Check cached IP to avoid unnecessary API calls
CACHE_FILE="/tmp/maisie-ddns-ip.txt"
CACHED_IP=$(cat "$CACHE_FILE" 2>/dev/null)

if [ "$CURRENT_IP" = "$CACHED_IP" ]; then
  exit 0
fi

echo "$(date): IP changed from ${CACHED_IP:-unknown} to $CURRENT_IP"

CHANGES=""
for RECORD in "${RECORDS[@]}"; do
  CHANGES="$CHANGES{\"Action\":\"UPSERT\",\"ResourceRecordSet\":{\"Name\":\"$RECORD\",\"Type\":\"A\",\"TTL\":300,\"ResourceRecords\":[{\"Value\":\"$CURRENT_IP\"}]}},"
done
CHANGES="${CHANGES%,}"

aws route53 change-resource-record-sets \
  --hosted-zone-id "$ZONE_ID" \
  --change-batch "{\"Changes\":[$CHANGES]}" \
  --output text --query 'ChangeInfo.Status'

if [ $? -eq 0 ]; then
  echo "$CURRENT_IP" > "$CACHE_FILE"
  echo "$(date): Updated DNS to $CURRENT_IP"
else
  echo "$(date): Failed to update DNS" >&2
  exit 1
fi
