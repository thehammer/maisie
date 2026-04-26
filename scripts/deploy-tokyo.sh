#!/usr/bin/env bash
# Deploy Maisie to the production host (set LAN_IP env var)
#
# Usage:
#   ./scripts/deploy-tokyo.sh          # rebuild all changed services
#   ./scripts/deploy-tokyo.sh maisie   # rebuild only the maisie service
#   ./scripts/deploy-tokyo.sh --sync   # rsync only, no rebuild

set -euo pipefail

TOKYO="${TOKYO_HOST:-tokyo}"
REMOTE_DIR="~/maisie"
TOKYO_IP="${LAN_IP:?LAN_IP env var required (IP address of this Maisie host)}"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_DIR="$(dirname "$SCRIPT_DIR")"

cd "$REPO_DIR"

# Parse args
SYNC_ONLY=false
SERVICES=()
for arg in "$@"; do
  case "$arg" in
    --sync) SYNC_ONLY=true ;;
    *) SERVICES+=("$arg") ;;
  esac
done

echo "==> Syncing code to Tokyo..."
rsync -av --delete \
  --exclude node_modules \
  --exclude .git \
  --exclude data \
  --exclude .env \
  --exclude .claude \
  --exclude .claire \
  ./ "${TOKYO}:${REMOTE_DIR}/"

echo "==> Restoring Tokyo go2rtc config..."
scp config/go2rtc.tokyo.yaml "${TOKYO}:${REMOTE_DIR}/config/go2rtc.yaml"

# Prowlarr runs outside docker-compose (bind mount to /opt/docker/prowlarr).
# Sync our custom Cardigann indexer definitions into its config directory
# and restart the container so it picks up any additions/changes.
if compgen -G "config/prowlarr-definitions/*.yml" > /dev/null; then
  echo "==> Syncing Prowlarr custom indexer definitions..."
  ssh "$TOKYO" "mkdir -p /tmp/maisie-prowlarr-defs"
  scp config/prowlarr-definitions/*.yml "${TOKYO}:/tmp/maisie-prowlarr-defs/"
  ssh "$TOKYO" "docker exec prowlarr mkdir -p /config/Definitions/Custom && \
                for f in /tmp/maisie-prowlarr-defs/*.yml; do \
                  docker cp \"\$f\" prowlarr:/config/Definitions/Custom/\$(basename \"\$f\"); \
                done && \
                docker restart prowlarr > /dev/null && \
                rm -rf /tmp/maisie-prowlarr-defs"
fi

# Readarr also runs outside docker-compose (bind mount to /opt/docker/readarr).
# Sync our custom-scripts directory so the abs-scan notification target works.
# The ABS auth token lives in .abs-token and must already exist on Tokyo
# (one-time setup; see config/readarr-custom-scripts/README.md).
if compgen -G "config/readarr-custom-scripts/*.sh" > /dev/null; then
  echo "==> Syncing Readarr custom scripts..."
  ssh "$TOKYO" "sudo mkdir -p /opt/docker/readarr/custom-scripts && \
                sudo chown 1000:1000 /opt/docker/readarr/custom-scripts"
  scp config/readarr-custom-scripts/*.sh "${TOKYO}:/tmp/"
  ssh "$TOKYO" "for f in /tmp/abs-scan.sh; do \
                  [ -f \"\$f\" ] || continue; \
                  sudo cp \"\$f\" /opt/docker/readarr/custom-scripts/\$(basename \"\$f\"); \
                  sudo chown 1000:1000 /opt/docker/readarr/custom-scripts/\$(basename \"\$f\"); \
                  sudo chmod +x /opt/docker/readarr/custom-scripts/\$(basename \"\$f\"); \
                  rm \"\$f\"; \
                done"
fi

if $SYNC_ONLY; then
  echo "==> Sync complete (--sync mode, skipping rebuild)"
  exit 0
fi

# Build and restart
if [ ${#SERVICES[@]} -eq 0 ]; then
  echo "==> Rebuilding all services..."
  ssh "$TOKYO" "cd ${REMOTE_DIR} && docker compose build && docker compose up -d"
else
  echo "==> Rebuilding: ${SERVICES[*]}..."
  ssh "$TOKYO" "cd ${REMOTE_DIR} && docker compose build ${SERVICES[*]} && docker compose up -d ${SERVICES[*]}"
fi

# Wait for maisie to be healthy
echo "==> Waiting for Maisie to start..."
for i in $(seq 1 15); do
  if curl -sf "http://${TOKYO_IP}:3001/api/health" > /dev/null 2>&1; then
    echo "==> Maisie is up"
    break
  fi
  if [ "$i" -eq 15 ]; then
    echo "==> Warning: Maisie health check timed out after 15s"
  fi
  sleep 1
done

# Rebuild synthetic-hdhr lineup (picks up any channel changes)
echo "==> Triggering synthetic-hdhr lineup rebuild..."
curl -sf -X POST "http://${TOKYO_IP}:5004/api/rebuild" > /dev/null 2>&1 && echo "==> Lineup rebuilt" || echo "==> Warning: lineup rebuild failed"

# Show status
echo ""
echo "==> Deploy complete. Container status:"
ssh "$TOKYO" "cd ${REMOTE_DIR} && docker compose ps --format 'table {{.Name}}\t{{.Status}}'"
echo ""
echo "Dashboard: http://${TOKYO_IP}:3001"
