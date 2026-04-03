#!/bin/bash
#
# Plex DVR Surgery: Add XMLTV-backed DVR for Maisie cameras
#
# This script:
# 1. Stops Plex
# 2. Backs up the database
# 3. Inserts a second DVR harvester with XMLTV EPG + Maisie grabber
# 4. Verifies the inserts
# 5. Starts Plex
#
# To undo: run with --restore flag
#
# Prerequisites:
# - sshpass installed locally
# - .env file with SYNOLOGY_HOST, SYNOLOGY_SSH_PORT, SYNOLOGY_USERNAME, SYNOLOGY_PASSWORD
# - Plex should not be in active use (recordings, streaming)

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ENV_FILE="$SCRIPT_DIR/../.env"

# Load env vars
if [ ! -f "$ENV_FILE" ]; then
  echo "ERROR: .env file not found at $ENV_FILE"
  exit 1
fi

SYNOLOGY_HOST=$(grep SYNOLOGY_HOST "$ENV_FILE" | cut -d= -f2)
SSH_PORT=$(grep SYNOLOGY_SSH_PORT "$ENV_FILE" | cut -d= -f2)
SYNOLOGY_USER=$(grep SYNOLOGY_USERNAME "$ENV_FILE" | cut -d= -f2)
SYNOLOGY_PASS=$(grep SYNOLOGY_PASSWORD "$ENV_FILE" | cut -d= -f2)

PLEX_DATA="/volume1/Plex/Library/Application Support/Plex Media Server"
PLEX_DB="$PLEX_DATA/Plug-in Support/Databases/com.plexapp.plugins.library.db"
BACKUP_DIR="$PLEX_DATA/Plug-in Support/Databases/_maisie_backup"

# Maisie device config
MAISIE_HOST=$(grep MAISIE_HOST "$ENV_FILE" | cut -d= -f2)
MAISIE_DEVICE_URI="http://${MAISIE_HOST:-localhost}:5004"
MAISIE_DEVICE_ID="MAISIE01"
MAISIE_XMLTV_URL="http://${MAISIE_HOST:-localhost}:5004/xmltv.xml"
MAISIE_HARVESTER_UUID="maisie-cameras-$(date +%Y%m%d)"
MAISIE_EPG_UUID="maisie-epg-$(date +%Y%m%d)"

# Channel config (10001-10010)
CHANNELS_ENABLED="10001,10002,10003,10004,10005,10006,10007,10008,10009,10010"
# Base64 of channel mapping: 10001=10001&10002=10002&...
CHANNEL_MAPPING=$(echo -n "10001=10001&10002=10002&10003=10003&10004=10004&10005=10005&10006=10006&10007=10007&10008=10008&10009=10009&10010=10010" | base64)

ssh_cmd() {
  sshpass -p "$SYNOLOGY_PASS" ssh -o StrictHostKeyChecking=no -p "${SSH_PORT:-22}" "${SYNOLOGY_USER}@${SYNOLOGY_HOST}" "$1" 2>&1 | grep -v "post-quantum\|WARNING\|vulnerable\|upgraded"
}

# ============================================================
# RESTORE MODE
# ============================================================
if [ "${1:-}" = "--restore" ]; then
  echo "=== RESTORE MODE ==="
  echo ""
  echo "This will:"
  echo "  1. Stop Plex"
  echo "  2. Restore database from backup"
  echo "  3. Start Plex"
  echo ""
  read -p "Continue? (y/N) " confirm
  [ "$confirm" = "y" ] || exit 0

  echo ""
  echo "[1/3] Stopping Plex..."
  ssh_cmd "echo '$SYNOLOGY_PASS' | sudo -S /usr/syno/bin/synopkg stop PlexMediaServer 2>&1 || true"
  sleep 3

  echo "[2/3] Restoring database..."
  ssh_cmd "
    if [ ! -d '$BACKUP_DIR' ]; then
      echo 'ERROR: No backup found at $BACKUP_DIR'
      exit 1
    fi
    cp '$BACKUP_DIR/com.plexapp.plugins.library.db' '$PLEX_DB'
    cp '$BACKUP_DIR/com.plexapp.plugins.library.db-shm' '${PLEX_DB}-shm' 2>/dev/null || true
    cp '$BACKUP_DIR/com.plexapp.plugins.library.db-wal' '${PLEX_DB}-wal' 2>/dev/null || true
    # Remove any XMLTV EPG database we may have created
    rm -f '$PLEX_DATA/Plug-in Support/Databases/tv.plex.providers.epg.xmltv-'*.db 2>/dev/null || true
    rm -f '$PLEX_DATA/Plug-in Support/Databases/tv.plex.providers.epg.xmltv-'*.db-shm 2>/dev/null || true
    rm -f '$PLEX_DATA/Plug-in Support/Databases/tv.plex.providers.epg.xmltv-'*.db-wal 2>/dev/null || true
    echo 'Database restored from backup'
  "

  echo "[3/3] Starting Plex..."
  ssh_cmd "echo '$SYNOLOGY_PASS' | sudo -S /usr/syno/bin/synopkg start PlexMediaServer 2>&1 || true"
  sleep 5

  echo ""
  echo "=== RESTORE COMPLETE ==="
  echo "Plex should be back to its previous state."
  echo "Verify at: http://$SYNOLOGY_HOST:32400/web"
  exit 0
fi

# ============================================================
# SURGERY MODE (default)
# ============================================================
echo "=== Plex DVR Surgery: Add XMLTV DVR for Maisie Cameras ==="
echo ""
echo "This will:"
echo "  1. Stop Plex on the NAS"
echo "  2. Back up the database files"
echo "  3. Insert a second DVR with XMLTV EPG for cameras"
echo "  4. Verify the inserts"
echo "  5. Start Plex"
echo ""
echo "Device:   $MAISIE_DEVICE_URI (ID: $MAISIE_DEVICE_ID)"
echo "XMLTV:    $MAISIE_XMLTV_URL"
echo "Channels: $CHANNELS_ENABLED"
echo ""
echo "To undo:  $0 --restore"
echo ""
read -p "Continue? (y/N) " confirm
[ "$confirm" = "y" ] || exit 0

# --------------------------------------------------
# Step 1: Stop Plex
# --------------------------------------------------
echo ""
echo "[1/5] Stopping Plex..."
ssh_cmd "echo '$SYNOLOGY_PASS' | sudo -S /usr/syno/bin/synopkg stop PlexMediaServer 2>&1 || true"
sleep 5

# Verify Plex is stopped
PLEX_STATUS=$(ssh_cmd "echo '$SYNOLOGY_PASS' | sudo -S /usr/syno/bin/synopkg status PlexMediaServer 2>&1 | grep -o 'stop\|running' || echo 'unknown'")
if echo "$PLEX_STATUS" | grep -q "running"; then
  echo "ERROR: Plex is still running. Aborting."
  exit 1
fi
echo "  Plex stopped: $PLEX_STATUS"

# --------------------------------------------------
# Step 2: Backup database
# --------------------------------------------------
echo ""
echo "[2/5] Backing up database..."
ssh_cmd "
  mkdir -p '$BACKUP_DIR'
  cp '$PLEX_DB' '$BACKUP_DIR/com.plexapp.plugins.library.db'
  cp '${PLEX_DB}-shm' '$BACKUP_DIR/com.plexapp.plugins.library.db-shm' 2>/dev/null || true
  cp '${PLEX_DB}-wal' '$BACKUP_DIR/com.plexapp.plugins.library.db-wal' 2>/dev/null || true
  # Also backup EPG databases
  cp '$PLEX_DATA/Plug-in Support/Databases'/tv.plex.providers.epg.* '$BACKUP_DIR/' 2>/dev/null || true
  # Backup Preferences.xml
  cp '$PLEX_DATA/Preferences.xml' '$BACKUP_DIR/Preferences.xml' 2>/dev/null || true
  ls -la '$BACKUP_DIR/'
"
echo "  Backup complete"

# --------------------------------------------------
# Step 3: Verify current state
# --------------------------------------------------
echo ""
echo "[3/5] Verifying current database state..."
CURRENT_ROWS=$(ssh_cmd "sqlite3 '$PLEX_DB' 'SELECT count(*) FROM media_provider_resources;'")
echo "  Current media_provider_resources rows: $CURRENT_ROWS"

if [ "$CURRENT_ROWS" -ne 3 ]; then
  echo "  WARNING: Expected 3 rows, found $CURRENT_ROWS"
  echo "  Current rows:"
  ssh_cmd "sqlite3 -header -column '$PLEX_DB' 'SELECT id, identifier, parent_id FROM media_provider_resources;'"
  echo ""
  read -p "  Continue anyway? (y/N) " confirm
  [ "$confirm" = "y" ] || exit 1
fi

# Check our device isn't already in there
EXISTING=$(ssh_cmd "sqlite3 '$PLEX_DB' \"SELECT count(*) FROM media_provider_resources WHERE uuid LIKE '%MAISIE%' OR uri LIKE '%5004%';\"")
if [ "$EXISTING" -gt 0 ]; then
  echo "  ERROR: Maisie device already exists in database. Aborting."
  echo "  Run --restore first if you want to start fresh."
  exit 1
fi
echo "  No existing Maisie entries found (good)"

# --------------------------------------------------
# Step 4: Insert new DVR rows
# --------------------------------------------------
echo ""
echo "[4/5] Inserting new DVR configuration..."

# URL-encode the extra_data fields
# Harvester extra_data: country, language, lineup URL
HARVESTER_EXTRA="at%3Acountry=usa&pv%3Alanguage=eng&pv%3Alineup=$(python3 -c "import urllib.parse; print(urllib.parse.quote('$MAISIE_XMLTV_URL', safe=''))")&pv%3AlineupTitle=Maisie%20Protect%20Cameras%20(10%20channels)"

# Grabber extra_data: device attributes + channel mapping
GRABBER_EXTRA="at%3AcanTranscode=0&at%3AdeviceAuth=maisie&at%3AdeviceId=${MAISIE_DEVICE_ID}&at%3Amake=Maisie&at%3Amodel=Maisie%20Protect%20Cameras&at%3AmodelNumber=HDHR-PROTECT&at%3Asource=1&at%3Asources=1&at%3Athumb=%2F%3A%2Fresources%2Fdvr%2Fdevice-generic-560%2Epng&at%3Atuners=4&pv%3AchannelMapping=$(python3 -c "import urllib.parse; print(urllib.parse.quote('$CHANNEL_MAPPING', safe=''))")&pv%3AchannelsEnabled=$(python3 -c "import urllib.parse; print(urllib.parse.quote('$CHANNELS_ENABLED', safe=''))")"

# EPG extra_data: recording preferences + EPG source
EPG_EXTRA="pr%3AcomskipEnabled=0&pr%3AcomskipMethod=0&pr%3AdefaultLibrarySectionIdForType-2=3&pr%3AdefaultLibrarySectionIdForType-3=3&pr%3AdefaultSectionLocationIdForType-2=5&pr%3AdefaultSectionLocationIdForType-3=5&pr%3AendOffsetMinutes=0&pr%3AminVideoQuality=0&pr%3ApostprocessingScript=&pr%3ArecordPartials=1&pr%3AreplaceLowerQuality=0&pr%3AstartOffsetMinutes=0&pv%3AepgSource=XMLTV"

NOW=$(date -u +"%Y-%m-%d %H:%M:%S")

ssh_cmd "
sqlite3 '$PLEX_DB' << 'EOSQL'
-- Insert harvester (DVR instance #2)
INSERT INTO media_provider_resources (parent_id, type, status, state, identifier, protocol, uri, uuid, extra_data, created_at, updated_at)
VALUES (NULL, 1, 1, 1, 'tv.plex.harvesters.dvr', '', '', '$MAISIE_HARVESTER_UUID', '$HARVESTER_EXTRA', '$NOW', '$NOW');

-- Get the harvester's auto-generated ID
-- Insert grabber (Maisie device) as child of new harvester
INSERT INTO media_provider_resources (parent_id, type, status, state, identifier, protocol, uri, uuid, extra_data, last_seen_at, created_at, updated_at)
VALUES (
  (SELECT id FROM media_provider_resources WHERE uuid = '$MAISIE_HARVESTER_UUID'),
  4, 1, 1,
  'tv.plex.grabbers.hdhomerun',
  'livetv',
  '$MAISIE_DEVICE_URI',
  'device://tv.plex.grabbers.hdhomerun/$MAISIE_DEVICE_ID',
  '$GRABBER_EXTRA',
  '$NOW', '$NOW', '$NOW'
);

-- Insert XMLTV EPG provider as child of new harvester
INSERT INTO media_provider_resources (parent_id, type, status, state, identifier, protocol, uri, uuid, extra_data, created_at, updated_at)
VALUES (
  (SELECT id FROM media_provider_resources WHERE uuid = '$MAISIE_HARVESTER_UUID'),
  3, 1, 1,
  'tv.plex.providers.epg.xmltv',
  'livetv',
  '$MAISIE_XMLTV_URL',
  '$MAISIE_EPG_UUID',
  '$EPG_EXTRA',
  '$NOW', '$NOW'
);
EOSQL
"

# Verify inserts
echo ""
echo "  Verifying inserts..."
NEW_ROWS=$(ssh_cmd "sqlite3 '$PLEX_DB' 'SELECT count(*) FROM media_provider_resources;'")
echo "  Total rows now: $NEW_ROWS (was $CURRENT_ROWS, expected $(($CURRENT_ROWS + 3)))"

if [ "$NEW_ROWS" -ne $(($CURRENT_ROWS + 3)) ]; then
  echo "  ERROR: Row count mismatch! Expected $(($CURRENT_ROWS + 3)), got $NEW_ROWS"
  echo "  Restoring backup..."
  ssh_cmd "cp '$BACKUP_DIR/com.plexapp.plugins.library.db' '$PLEX_DB'"
  echo "  Backup restored. Starting Plex..."
  ssh_cmd "echo '$SYNOLOGY_PASS' | sudo -S /usr/syno/bin/synopkg start PlexMediaServer 2>&1 || true"
  exit 1
fi

echo ""
echo "  New DVR structure:"
ssh_cmd "sqlite3 -header -column '$PLEX_DB' 'SELECT id, identifier, parent_id, uuid FROM media_provider_resources ORDER BY id;'"

# Verify parent-child relationships
echo ""
echo "  Checking parent-child relationships..."
ssh_cmd "
sqlite3 '$PLEX_DB' \"
  SELECT
    h.id as harvester_id,
    h.uuid as harvester_uuid,
    g.id as grabber_id,
    g.uri as grabber_uri,
    e.id as epg_id,
    e.identifier as epg_type
  FROM media_provider_resources h
  LEFT JOIN media_provider_resources g ON g.parent_id = h.id AND g.identifier LIKE '%grabber%'
  LEFT JOIN media_provider_resources e ON e.parent_id = h.id AND e.identifier LIKE '%provider%'
  WHERE h.identifier = 'tv.plex.harvesters.dvr'
  ORDER BY h.id;
\"
"

# --------------------------------------------------
# Step 5: Start Plex
# --------------------------------------------------
echo ""
echo "[5/5] Starting Plex..."
ssh_cmd "echo '$SYNOLOGY_PASS' | sudo -S /usr/syno/bin/synopkg start PlexMediaServer 2>&1 || true"
sleep 10

echo ""
echo "=== SURGERY COMPLETE ==="
echo ""
echo "Check Plex at: http://$SYNOLOGY_HOST:32400/web"
echo "Go to Settings > Live TV & DVR to see if both DVRs appear."
echo ""
echo "If anything is broken, run: $0 --restore"
