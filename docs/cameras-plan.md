# Cameras Page Plan

## Goal
Full live streaming from all UniFi Protect cameras in the Maisie dashboard.

## Architecture

```
Protect Cameras (RTSP) → go2rtc (Docker) → WebRTC → Browser
                                ↑
                          Maisie Agent generates config
                          from /api/protect/cameras
```

## Completed
- [x] Protect API client (`packages/agent/src/skills/network/protect-client.ts`)
- [x] API endpoints: `/api/protect/status`, `/api/protect/cameras`, `/api/protect/cameras/:id`, `/api/protect/events`
- [x] Shared types: `ProtectCamera`, `ProtectNvr`, `ProtectStatus`, etc.
- [x] MQTT topics: `home/protect/cameras`, `home/protect/events`
- [x] `.env.example` updated with `UNIFI_PROTECT_ENABLED`

## Remaining

### 1. go2rtc Service (Docker)
- Add `go2rtc` to `docker-compose.yml` (image: `alexxit/go2rtc`)
- Mount config volume
- Agent endpoint to generate go2rtc config from Protect camera RTSP data
- RTSP URLs: `rtsps://{camera.host}:7441/{channel.rtspAlias}`
- Use Medium channel (720p) by default for grid view, High for single-camera view

### 2. go2rtc API Proxy
- Proxy `/go2rtc/` through Maisie agent so dashboard doesn't need to know go2rtc's port
- go2rtc API on port 1984 internally
- Key endpoints: `POST /api/webrtc?src={name}` (WebRTC signaling), `GET /api/ws?src={name}` (MSE fallback)

### 3. CamerasPage Component
- `packages/dashboard/src/pages/CamerasPage.tsx`
- Fetch camera list from `/api/protect/status`
- Responsive grid layout (`.cam-*` CSS prefix)
- Each cell: camera name label + `<video>` element
- WebRTC connection to go2rtc per camera via `RTCPeerConnection` + SDP offer/answer
- MSE fallback via WebSocket if WebRTC fails
- Click to expand single camera (switch to High channel)

### 4. Dashboard Routing
- Lazy import `CamerasPage` in `App.tsx`
- Hash route: `#cameras`
- Nav link in header

### 5. Camera Grid CSS
- Add `.cam-*` styles to `styles.css`
- Grid: `repeat(auto-fill, minmax(400px, 1fr))`
- Dark surface cards matching existing design tokens
- Fullscreen/expanded single-camera mode

## Camera Inventory

Camera details (names, IPs, resolutions) are discovered dynamically via the UniFi Protect API
at `/api/protect/cameras`. Configure `UNIFI_PROTECT_HOST` and `UNIFI_PROTECT_API_KEY` in `.env`.

Supported camera models: G3 Flex (1080p/15fps), G3 Instant (1080p/30fps),
G4 Doorbell (1200p/30fps), G5 Pro (4K/30fps).
