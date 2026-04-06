# Stage 1: Install dependencies + build dashboard
FROM oven/bun:1.3.10-alpine AS build

WORKDIR /app

# Copy workspace manifests for install
# All plugin packages must be listed so bun install can resolve the lockfile
COPY package.json bun.lock tsconfig.json ./
COPY packages/agent/package.json packages/agent/
COPY packages/dashboard/package.json packages/dashboard/
COPY packages/shared/package.json packages/shared/
COPY packages/cli/package.json packages/cli/
COPY packages/plugin-core/package.json packages/plugin-core/
COPY packages/plugin-unifi/package.json packages/plugin-unifi/
COPY packages/plugin-synology/package.json packages/plugin-synology/
COPY packages/plugin-plex/package.json packages/plugin-plex/
COPY packages/plugin-radarr/package.json packages/plugin-radarr/
COPY packages/plugin-sonarr/package.json packages/plugin-sonarr/
COPY packages/plugin-calibre/package.json packages/plugin-calibre/
COPY packages/plugin-home-assistant/package.json packages/plugin-home-assistant/
COPY packages/plugin-bambu/package.json packages/plugin-bambu/
COPY packages/plugin-google/package.json packages/plugin-google/
COPY packages/plugin-hp-printer/package.json packages/plugin-hp-printer/
COPY packages/synthetic-hdhr/package.json packages/synthetic-hdhr/
COPY packages/tokyo-streamer/package.json packages/tokyo-streamer/
COPY packages/ssdp-advertiser/package.json packages/ssdp-advertiser/
RUN bun install

# Copy source for dashboard build
COPY packages/shared/ packages/shared/
COPY packages/dashboard/ packages/dashboard/
RUN cd packages/dashboard && bunx --bun vite build

# Stage 2: Runtime (fresh install, no symlink issues)
FROM oven/bun:1.3.10-alpine

WORKDIR /app

# Copy all workspace manifests (lockfile requires all workspaces present)
COPY package.json bun.lock tsconfig.json ./
COPY packages/agent/package.json packages/agent/
COPY packages/dashboard/package.json packages/dashboard/
COPY packages/shared/package.json packages/shared/
COPY packages/cli/package.json packages/cli/
COPY packages/plugin-core/package.json packages/plugin-core/
COPY packages/plugin-unifi/package.json packages/plugin-unifi/
COPY packages/plugin-synology/package.json packages/plugin-synology/
COPY packages/plugin-plex/package.json packages/plugin-plex/
COPY packages/plugin-radarr/package.json packages/plugin-radarr/
COPY packages/plugin-sonarr/package.json packages/plugin-sonarr/
COPY packages/plugin-calibre/package.json packages/plugin-calibre/
COPY packages/plugin-home-assistant/package.json packages/plugin-home-assistant/
COPY packages/plugin-bambu/package.json packages/plugin-bambu/
COPY packages/plugin-google/package.json packages/plugin-google/
COPY packages/plugin-hp-printer/package.json packages/plugin-hp-printer/
COPY packages/synthetic-hdhr/package.json packages/synthetic-hdhr/
COPY packages/tokyo-streamer/package.json packages/tokyo-streamer/
COPY packages/ssdp-advertiser/package.json packages/ssdp-advertiser/

# Docker CLI for calibredb exec into sibling container
RUN apk add --no-cache docker-cli

# Install deps (full install to match lockfile)
RUN bun install

# Copy source
COPY packages/shared/ packages/shared/
COPY packages/agent/ packages/agent/
COPY packages/plugin-core/ packages/plugin-core/
COPY packages/plugin-unifi/ packages/plugin-unifi/
COPY packages/plugin-synology/ packages/plugin-synology/
COPY packages/plugin-plex/ packages/plugin-plex/
COPY packages/plugin-radarr/ packages/plugin-radarr/
COPY packages/plugin-sonarr/ packages/plugin-sonarr/
COPY packages/plugin-calibre/ packages/plugin-calibre/
COPY packages/plugin-home-assistant/ packages/plugin-home-assistant/
COPY packages/plugin-bambu/ packages/plugin-bambu/
COPY packages/plugin-google/ packages/plugin-google/
COPY packages/plugin-hp-printer/ packages/plugin-hp-printer/

# Copy built dashboard from build stage
COPY --from=build /app/packages/dashboard/dist packages/dashboard/dist

# Data directory for SQLite
RUN mkdir -p /app/data

ENV NODE_TLS_REJECT_UNAUTHORIZED=0
EXPOSE 3001

CMD ["bun", "run", "packages/agent/src/index.ts"]
