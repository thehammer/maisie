# Home Assistant Setup for Maisie

## Overview

Home Assistant acts as a bridge between Maisie and your HomeKit devices. It pairs with your existing HomeKit setup as a "controller" — your Apple Home app continues to work as normal.

## Step 1: Install Home Assistant on Synology

In Synology Docker (Container Manager):

1. Pull the image: `homeassistant/home-assistant:stable`
2. Create the container with these settings:
   - **Container name**: `homeassistant`
   - **Network**: `host` (required for HomeKit device discovery via mDNS)
   - **Volume mount**: `/volume1/docker/homeassistant` → `/config`
   - **Restart policy**: `unless-stopped`
   - **Environment**: `TZ=America/Chicago`

Or via SSH on the Synology:

```bash
docker run -d \
  --name homeassistant \
  --restart unless-stopped \
  --network host \
  -v /volume1/docker/homeassistant:/config \
  -e TZ=America/Chicago \
  homeassistant/home-assistant:stable
```

## Step 2: Initial HA Setup

1. Open `http://<synology-ip>:8123` in your browser
2. Create an admin account
3. Set your home location and timezone
4. Skip any auto-discovered integrations for now

## Step 3: Add HomeKit Controller Integration

This lets HA pair with your existing HomeKit accessories:

1. Go to **Settings** → **Devices & Services** → **Add Integration**
2. Search for **"HomeKit Controller"** (NOT "HomeKit" — that's the other direction)
3. HA will discover your HomeKit accessories on the network
4. For each device you want to control via Maisie:
   - Click to pair
   - Enter the HomeKit pairing code (the 8-digit code from the device or its manual)
   - The device stays in Apple Home AND becomes available in HA

**Note**: HomeKit allows multiple controllers. Adding HA as a controller does NOT remove your Apple Home/HomePod control. Both work simultaneously.

## Step 4: Generate a Long-Lived Access Token

Maisie needs an API token to talk to HA:

1. In HA, click your profile (bottom-left)
2. Scroll to **Long-Lived Access Tokens**
3. Click **Create Token**
4. Name it `Maisie`
5. Copy the token (it's only shown once)

## Step 5: Configure Maisie

Add to your `.env`:

```
HA_HOST=<your-ha-host>
HA_PORT=8123
HA_TOKEN=<your-long-lived-token>
```

Restart the Maisie agent. You should see:
```
  ✓ Home Assistant connected (API running.)
```

## Step 6: Verify

Test the API:

```bash
# List all lights
curl http://localhost:3001/api/ha/lights | python3 -m json.tool

# List all scenes
curl http://localhost:3001/api/ha/scenes | python3 -m json.tool
```

## Troubleshooting

**HA can't find HomeKit devices**: Make sure the container uses `--network host`. Bridge mode blocks mDNS discovery.

**Pairing fails**: Some devices only allow a limited number of controllers. You may need to remove an existing pairing first (unlikely with most devices).

**Token doesn't work**: Long-lived tokens don't expire, but if you regenerate it, update `.env` and restart the agent.

**Homebridge conflict**: If you're running Homebridge, it's exposing non-HomeKit devices TO HomeKit. That's the opposite direction from what we need. You can keep Homebridge running — it won't conflict with HA's HomeKit Controller. Eventually you could move Homebridge's devices into HA directly and retire Homebridge.
