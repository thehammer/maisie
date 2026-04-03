FROM oven/bun:1.3.10-alpine

RUN apk add --no-cache ffmpeg

WORKDIR /app

# Copy all workspace manifests — root package.json lists all workspaces,
# so bun install requires all package.json files to be present
COPY package.json bun.lock ./
COPY packages/shared/package.json packages/shared/
COPY packages/agent/package.json packages/agent/
COPY packages/dashboard/package.json packages/dashboard/
COPY packages/cli/package.json packages/cli/
COPY packages/synthetic-hdhr/package.json packages/synthetic-hdhr/
COPY packages/tokyo-streamer/package.json packages/tokyo-streamer/
COPY packages/ssdp-advertiser/package.json packages/ssdp-advertiser/
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

RUN bun install

COPY packages/shared/ packages/shared/
COPY packages/synthetic-hdhr/src/ packages/synthetic-hdhr/src/

WORKDIR /app/packages/synthetic-hdhr
EXPOSE 5004
CMD ["bun", "run", "src/index.ts"]
