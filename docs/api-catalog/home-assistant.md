# Home Assistant API Catalog

**Source**: https://developers.home-assistant.io/docs/api/rest/ and https://developers.home-assistant.io/docs/api/websocket  
**Last reviewed**: 2026-04-03  
**HA version**: Current (2024+)

---

## Table of Contents

1. [Authentication](#authentication)
2. [REST API](#rest-api)
3. [WebSocket API](#websocket-api)
4. [MQTT Integration](#mqtt-integration)
5. [Entity Model](#entity-model)
6. [Domain Service Catalog](#domain-service-catalog)
7. [Registry Model](#registry-model)
8. [Current Maisie Implementation vs. Full Surface](#current-maisie-implementation-vs-full-surface)

---

## Authentication

### Long-Lived Access Tokens (Recommended for integrations)

- Valid for **10 years**
- Created at `http://HA_HOST:8123/profile` under "Long-Lived Access Tokens"
- Can also be created via WebSocket: `auth/long_lived_access_token`
- **Not stored by HA** — record on creation

**Usage in all REST requests:**
```
Authorization: Bearer <token>
Content-Type: application/json
```

### OAuth 2 / IndieAuth (for third-party apps)

HA implements OAuth 2 + IndieAuth extension:
- Client ID is the application's URL (e.g. `https://myapp.io`)
- Authorization at `/auth/authorize`
- Token exchange at `/auth/token`
- Access tokens are short-lived (1800 seconds); refresh tokens are long-lived

### WebSocket Authentication

During the WebSocket handshake, the server sends `{"type": "auth_required"}`. Client responds:

```json
{"type": "auth", "access_token": "<token>"}
```

Server replies with `{"type": "auth_ok", "ha_version": "..."}` or `{"type": "auth_invalid"}`.

### Signed Paths

Temporary authenticated URLs with embedded signatures, default 30-second TTL. Useful for camera proxy URLs shared with third-party players.

---

## REST API

Base URL: `http://HA_HOST:8123/api`  
All endpoints require `Authorization: Bearer <token>`.

### Health Check

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/` | Returns `{"message": "API running."}` — note the trailing slash |

### Configuration & Discovery

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/config` | Full HA config: location, timezone, unit system, version, loaded components |
| GET | `/api/components` | Array of loaded component/integration names |
| GET | `/api/discovery_info` | Instance discovery info (base URL, location name, etc.) |
| POST | `/api/config/core/check_config` | Validate `configuration.yaml`. Response: `{"result": "valid"\|"invalid", "errors": null\|"string"}` |

### Entity States

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/states` | All entity states as array |
| GET | `/api/states/<entity_id>` | Single entity state. 404 if not found |
| POST | `/api/states/<entity_id>` | Create or update a state (representation only — does not talk to device). Body: `{"state": "on", "attributes": {...}}`. Returns 200 (updated) or 201 (created) |
| DELETE | `/api/states/<entity_id>` | Remove an entity state from HA's state machine |

**State object shape:**
```json
{
  "entity_id": "light.living_room",
  "state": "on",
  "attributes": {
    "friendly_name": "Living Room",
    "brightness": 200,
    "rgb_color": [255, 200, 100]
  },
  "last_changed": "2024-01-15T10:00:00+00:00",
  "last_updated": "2024-01-15T10:00:00+00:00",
  "context": {"id": "...", "parent_id": null, "user_id": null}
}
```

### Services

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/services` | All available services organized by domain |
| POST | `/api/services/<domain>/<service>` | Call a service. Body is service_data (e.g. `{"entity_id": "light.living_room", "brightness": 200}`). Returns array of changed states. Append `?return_response` to also get service return data |

### Events

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/events` | All event types with listener counts |
| POST | `/api/events/<event_type>` | Fire an event. Body: optional JSON object as event_data. Response: `{"message": "Event [type] fired."}` |

### History & Logbook

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/history/period/<timestamp>` | State change history. `<timestamp>` optional (ISO 8601, defaults to 24h ago) |
| GET | `/api/logbook/<timestamp>` | Logbook entries. `<timestamp>` optional |

**History query parameters:**
- `filter_entity_id=light.living_room,switch.fan` — required, comma-separated
- `end_time=<ISO8601>` — end of range
- `minimal_response` — returns only `last_changed` and `state` (no attributes)
- `no_attributes` — omit attribute data entirely
- `significant_changes_only` — filter to meaningful state transitions

**Logbook query parameters:**
- `entity=<entity_id>` — filter to single entity
- `end_time=<ISO8601>` — end of range

### Template Rendering

| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/template` | Render a Jinja2 template using live state data |

Request body:
```json
{"template": "The living room is {{ states('light.living_room') }}."}
```
Response: rendered string as plaintext.

### Calendars

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/calendars` | All calendar entities: `[{"entity_id": "calendar.family", "name": "Family"}]` |
| GET | `/api/calendars/<entity_id>` | Events in time range. Requires `?start=<ISO8601>&end=<ISO8601>` |

**Calendar event shape:**
```json
{
  "summary": "Doctor Appointment",
  "start": {"dateTime": "2024-01-15T14:00:00"},
  "end": {"dateTime": "2024-01-15T15:00:00"},
  "description": "Annual checkup",
  "location": "123 Main St"
}
```

### Camera

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/camera_proxy/<camera_entity_id>` | Returns JPEG image data. Optional `?time=<timestamp>` |

### Error Log

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/error_log` | All errors from current HA session as plaintext |

### Intent Handling

| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/intent/handle` | Handle an intent. Requires `intent:` in configuration.yaml. Body: `{"name": "TurnOn", "data": {"name": "Living Room"}}` |

---

## WebSocket API

Endpoint: `ws://HA_HOST:8123/api/websocket`

All messages are JSON. Client messages require an incrementing integer `id`. Server responses echo the `id` and include `"type": "result"` with `"success": true|false`.

### Connection Handshake

```
Server → {"type": "auth_required", "ha_version": "..."}
Client → {"type": "supported_features", "id": 1, "features": {"coalesce_messages": 1}}
Client → {"type": "auth", "access_token": "<token>"}
Server → {"type": "auth_ok", "ha_version": "..."}
```

`coalesce_messages: 1` tells the server it can bundle multiple responses into a single WebSocket frame for efficiency.

### Heartbeat

```json
{"id": 9, "type": "ping"}
```
Response: `{"id": 9, "type": "pong"}`

### State & Config Queries

| Command | Description |
|---------|-------------|
| `get_states` | Snapshot of all current entity states |
| `get_config` | Current HA configuration dump |
| `get_services` | All available service actions across all domains |
| `get_panels` | Registered frontend panels |

Example:
```json
{"id": 10, "type": "get_states"}
```

### Event Subscriptions

**Subscribe to all events:**
```json
{"id": 11, "type": "subscribe_events"}
```

**Subscribe to specific event type:**
```json
{"id": 12, "type": "subscribe_events", "event_type": "state_changed"}
```

**Unsubscribe:**
```json
{"id": 13, "type": "unsubscribe_events", "subscription": 12}
```

**Key event types:**
- `state_changed` — entity state changed. Event data: `{"entity_id": "...", "old_state": {...}, "new_state": {...}}`
- `call_service` — service was called
- `automation_triggered` — automation fired
- `script_started` / `script_finished`
- `homeassistant_start` / `homeassistant_stop`
- `component_loaded`
- `service_registered`
- `platform_discovered`

### Trigger Subscriptions

Subscribe using automation-style trigger definitions:
```json
{
  "id": 14,
  "type": "subscribe_trigger",
  "trigger": {
    "platform": "state",
    "entity_id": "binary_sensor.motion_hallway",
    "to": "on"
  }
}
```

Trigger platforms: `state`, `numeric_state`, `time`, `time_pattern`, `homeassistant`, `event`, `mqtt`, `template`, `zone`, `geo_location`, `device`, `calendar`, `persistent_notification`.

### Service Calls

```json
{
  "id": 15,
  "type": "call_service",
  "domain": "light",
  "service": "turn_on",
  "target": {
    "entity_id": "light.living_room"
  },
  "service_data": {
    "brightness_pct": 75,
    "color_temp_kelvin": 3000
  }
}
```

Set `"return_response": true` for services that return data (e.g., `conversation.process`).

**Target** can specify:
- `entity_id`: string or array
- `device_id`: string or array
- `area_id`: string or array — targets all entities in the area

### Entity Registry

**List (display-optimized):**
```json
{"id": 16, "type": "config/entity_registry/list_for_display"}
```
Returns lightweight entries with abbreviated fields (`ei` = entity_id, `di` = device_id, `ai` = area_id, `n` = name, `ic` = icon, `pl` = platform, etc.). Excludes disabled entities.

**Full CRUD (available via WS, not in public docs — use REST for these):**
- Full entity registry management is primarily handled through the UI or via REST calls to internal APIs. The WS endpoint above is the officially documented read path.

### Voice Assistant Exposure

**List exposure status:**
```json
{"id": 17, "type": "homeassistant/expose_entity/list"}
```

**Set exposure:**
```json
{
  "id": 18,
  "type": "homeassistant/expose_entity",
  "assistants": ["conversation", "cloud.alexa", "cloud.google_assistant"],
  "entity_ids": ["light.living_room"],
  "should_expose": true
}
```

### Config Validation

```json
{
  "id": 19,
  "type": "validate_config",
  "trigger": {"platform": "state", "entity_id": "..."},
  "condition": {"condition": "state", "entity_id": "..."},
  "action": {"service": "light.turn_on", "target": {}}
}
```

Response includes `{"trigger": {"valid": true, "error": null}, "condition": {...}, "action": {...}}`.

### Target Extraction

Expand a target specification into concrete entity/device/area lists:
```json
{"id": 20, "type": "extract_from_target", "target": {"area_id": "living_room"}}
```

### Discovery Helpers

```json
{"id": 21, "type": "get_triggers_for_target", "target": {"entity_id": "light.living_room"}}
{"id": 22, "type": "get_conditions_for_target", "target": {"entity_id": "light.living_room"}}
{"id": 23, "type": "get_services_for_target", "target": {"entity_id": "light.living_room"}}
```

### Fire Event

```json
{
  "id": 24,
  "type": "fire_event",
  "event_type": "my_custom_event",
  "event_data": {"device": "sensor_01", "value": 42}
}
```

---

## MQTT Integration

HA's MQTT integration has two roles:
1. **Subscriber** — listens to device state topics and creates sensor/switch/etc. entities
2. **Publisher** — sends commands to device command topics

### Discovery Protocol

Discovery topic format:
```
<discovery_prefix>/<component>/[<node_id>/]<object_id>/config
```

- `discovery_prefix` defaults to `homeassistant`
- `component` is the entity type (see supported types below)
- `node_id` is optional (e.g. device hostname)
- `object_id` is a unique identifier for this entity on the device

**Publish with `retain: true`** so the message replays on HA restart.

**Delete** an entity by publishing an empty payload to the config topic.

### HA Status Topic

HA publishes to `homeassistant/status`:
- `online` on startup — devices should re-publish their discovery messages
- `offline` on shutdown

### Supported Discovery Component Types

Actuators/Control: `light`, `switch`, `lock`, `cover`, `climate`, `fan`, `vacuum`, `valve`, `water_heater`, `siren`, `humidifier`, `lawn_mower`

Input: `button`, `number`, `select`, `text`

Sensors: `sensor`, `binary_sensor`, `camera`, `image`

Specialized: `alarm_control_panel`, `device_tracker`, `notify`, `scene`, `tag`, `update`

### Discovery Payload — Common Fields

```json
{
  "name": "Bedroom Temperature",
  "unique_id": "bedroom_sensor_temp",
  "state_topic": "home/bedroom/sensor/temperature/state",
  "availability_topic": "home/bedroom/sensor/availability",
  "payload_available": "online",
  "payload_not_available": "offline",
  "availability_mode": "all",
  "device": {
    "identifiers": ["bedroom_sensor_01"],
    "name": "Bedroom Sensor",
    "manufacturer": "Acme",
    "model": "EnvSensor Pro",
    "sw_version": "1.2.3"
  },
  "origin": {
    "name": "My Integration",
    "sw_version": "1.0.0",
    "support_url": "https://example.com"
  }
}
```

### Discovery Payload — sensor

```json
{
  "name": "Bedroom Temperature",
  "state_topic": "home/bedroom/temp",
  "unit_of_measurement": "°C",
  "device_class": "temperature",
  "state_class": "measurement",
  "value_template": "{{ value_json.temperature }}"
}
```

### Discovery Payload — binary_sensor

```json
{
  "name": "Front Door",
  "state_topic": "home/frontdoor/state",
  "device_class": "door",
  "payload_on": "open",
  "payload_off": "closed"
}
```

### Discovery Payload — switch

```json
{
  "name": "Garage Fan",
  "state_topic": "home/garage/fan/state",
  "command_topic": "home/garage/fan/set",
  "payload_on": "ON",
  "payload_off": "OFF",
  "state_on": "ON",
  "state_off": "OFF"
}
```

### Discovery Payload — light (with brightness + color temp)

```json
{
  "name": "Office Desk Lamp",
  "schema": "json",
  "state_topic": "home/office/lamp/state",
  "command_topic": "home/office/lamp/set",
  "brightness": true,
  "color_temp": true,
  "brightness_command_topic": "home/office/lamp/brightness/set",
  "color_temp_command_topic": "home/office/lamp/color_temp/set",
  "brightness_state_topic": "home/office/lamp/brightness/state",
  "color_temp_state_topic": "home/office/lamp/color_temp/state"
}
```

### Payload Abbreviations

MQTT discovery supports compact abbreviations to reduce payload size:
- `uniq_id` = `unique_id`
- `stat_t` = `state_topic`
- `cmd_t` = `command_topic`
- `dev_cla` = `device_class`
- `avty_t` = `availability_topic`
- `pl_avail` = `payload_available`
- `pl_not_avail` = `payload_not_available`
- `val_tpl` = `value_template`

---

## Entity Model

### Common State Fields (all domains)

```typescript
{
  entity_id: string           // "domain.name" e.g. "light.living_room"
  state: string               // domain-specific value
  attributes: {
    friendly_name?: string
    icon?: string
    assumed_state?: boolean
    supported_features?: number   // bitmask
    device_class?: string
    unit_of_measurement?: string
    // ... domain-specific attributes
  }
  last_changed: string        // ISO 8601
  last_updated: string        // ISO 8601
  context: { id, parent_id, user_id }
}
```

### Domain Reference

#### `light`

**States:** `on`, `off`, `unavailable`

**Attributes:**
| Attribute | Type | Description |
|-----------|------|-------------|
| `brightness` | 0–255 | Current brightness |
| `color_mode` | string | Active color mode |
| `color_temp` | int | Color temperature in mireds |
| `color_temp_kelvin` | int | Color temperature in Kelvin |
| `min_color_temp_kelvin` | int | Warmest supported temp |
| `max_color_temp_kelvin` | int | Coldest supported temp |
| `hs_color` | [hue, sat] | Hue (0–360) and saturation (0–100) |
| `rgb_color` | [r,g,b] | 0–255 each |
| `rgbw_color` | [r,g,b,w] | With white channel |
| `rgbww_color` | [r,g,b,cw,ww] | Dual white channels |
| `xy_color` | [x, y] | CIE 1931 chromaticity |
| `effect` | string | Active effect name |
| `effect_list` | string[] | Available effects |
| `supported_color_modes` | string[] | `onoff`, `brightness`, `color_temp`, `hs`, `rgb`, `rgbw`, `rgbww`, `white`, `xy` |

**Supported Features (bitmask):** `EFFECT=4`, `FLASH=8`, `TRANSITION=32`

#### `switch`

**States:** `on`, `off`, `unavailable`

**Attributes:** `friendly_name`, `icon`, `device_class` (`outlet`, `switch`)

#### `sensor`

**States:** any value (numeric or string)

**Attributes:**
| Attribute | Type | Description |
|-----------|------|-------------|
| `unit_of_measurement` | string | e.g. `°C`, `%`, `kWh` |
| `device_class` | string | One of 80+ classes |
| `state_class` | string | `measurement`, `total`, `total_increasing` |
| `last_reset` | datetime | For total sensors |

**Key device classes:** `temperature`, `humidity`, `pressure`, `power`, `energy`, `voltage`, `current`, `battery`, `illuminance`, `co2`, `motion`, `timestamp`, `duration`, `distance`, `speed`, `weight`, `sound_pressure`, `pm25`, `pm10`, `aqi`

#### `binary_sensor`

**States:** `on`, `off`, `unavailable`

| Device Class | On means | Off means |
|-------------|----------|-----------|
| `battery` | Low | Normal |
| `co` | CO detected | Clear |
| `cold` | Cold | Normal |
| `connectivity` | Connected | Disconnected |
| `door` | Open | Closed |
| `garage_door` | Open | Closed |
| `gas` | Gas detected | Clear |
| `heat` | Hot | Normal |
| `light` | Light detected | No light |
| `lock` | Unlocked | Locked |
| `moisture` | Wet | Dry |
| `motion` | Motion | Clear |
| `moving` | Moving | Stopped |
| `occupancy` | Occupied | Clear |
| `opening` | Open | Closed |
| `plug` | Plugged in | Unplugged |
| `power` | Power detected | No power |
| `presence` | Home | Away |
| `problem` | Problem | OK |
| `running` | Running | Not running |
| `safety` | Unsafe | Safe |
| `smoke` | Smoke detected | Clear |
| `sound` | Sound detected | Clear |
| `tamper` | Tampering | Clear |
| `vibration` | Vibrating | Still |
| `window` | Open | Closed |

#### `climate`

**States (hvac_mode):** `off`, `heat`, `cool`, `heat_cool`, `auto`, `dry`, `fan_only`

**Attributes:**
| Attribute | Description |
|-----------|-------------|
| `hvac_mode` | Current mode |
| `hvac_modes` | Supported modes |
| `hvac_action` | Current action: `heating`, `cooling`, `idle`, `off`, `drying`, `fan` |
| `current_temperature` | Sensor reading |
| `target_temperature` | Setpoint |
| `target_temperature_high/low` | For `heat_cool` range mode |
| `target_temperature_step` | Adjustment granularity |
| `current_humidity` | Sensor reading |
| `target_humidity` | Setpoint |
| `fan_mode` / `fan_modes` | Fan speed options |
| `preset_mode` / `preset_modes` | e.g. `away`, `eco`, `boost`, `sleep`, `home` |
| `swing_mode` / `swing_modes` | Airflow direction options |
| `temperature_unit` | `°C` or `°F` |

**Supported Features (bitmask):** `TARGET_TEMPERATURE`, `TARGET_TEMPERATURE_RANGE`, `TARGET_HUMIDITY`, `FAN_MODE`, `PRESET_MODE`, `SWING_MODE`, `SWING_HORIZONTAL_MODE`, `TURN_ON`, `TURN_OFF`

#### `cover`

**States:** `open`, `opening`, `closing`, `closed`, `unavailable`

**Attributes:**
| Attribute | Description |
|-----------|-------------|
| `current_cover_position` | 0 (closed) – 100 (open) |
| `current_cover_tilt_position` | 0–100 |
| `is_closed` | boolean |
| `is_opening` / `is_closing` | boolean |

**Device classes:** `awning`, `blind`, `curtain`, `damper`, `door`, `garage`, `gate`, `shade`, `shutter`, `window`

**Supported Features:** `OPEN`, `CLOSE`, `STOP`, `SET_POSITION`, `OPEN_TILT`, `CLOSE_TILT`, `STOP_TILT`, `SET_TILT_POSITION`

#### `media_player`

**States:** `off`, `on`, `idle`, `playing`, `paused`, `buffering`, `unavailable`

**Attributes:**
| Attribute | Description |
|-----------|-------------|
| `volume_level` | 0.0–1.0 |
| `is_volume_muted` | boolean |
| `media_title` | Track/show title |
| `media_artist` | Artist |
| `media_album_name` | Album |
| `media_content_type` | `music`, `tvshow`, `movie`, `episode`, `channel`, `playlist` |
| `media_content_id` | Content URI/ID |
| `media_duration` | Seconds |
| `media_position` | Current position seconds |
| `source` | Current input source |
| `source_list` | Available sources |
| `shuffle` | boolean |
| `repeat` | `off`, `all`, `one` |
| `app_name` | Running app |
| `media_channel` | TV channel |
| `group_members` | Grouped player entity IDs |

**Device classes:** `tv`, `speaker`, `receiver`

**Supported Features (bitmask):** `PLAY`, `PAUSE`, `STOP`, `SEEK`, `NEXT_TRACK`, `PREVIOUS_TRACK`, `TURN_ON`, `TURN_OFF`, `VOLUME_SET`, `VOLUME_STEP`, `VOLUME_MUTE`, `SELECT_SOURCE`, `SELECT_SOUND_MODE`, `SHUFFLE_SET`, `REPEAT_SET`, `PLAY_MEDIA`, `BROWSE_MEDIA`, `SEARCH_MEDIA`, `MEDIA_ENQUEUE`, `MEDIA_ANNOUNCE`, `GROUPING`, `CLEAR_PLAYLIST`

#### `lock`

**States:** `locked`, `unlocked`, `locking`, `unlocking`, `jammed`, `unavailable`

**Attributes:** `code_format` (regex for valid lock codes)

#### `alarm_control_panel`

**States:** `disarmed`, `armed_home`, `armed_away`, `armed_night`, `armed_vacation`, `armed_custom_bypass`, `pending`, `arming`, `disarming`, `triggered`, `unavailable`

#### `fan`

**States:** `on`, `off`, `unavailable`

**Attributes:** `percentage` (0–100), `preset_mode`, `preset_modes`, `oscillating`, `direction` (`forward`/`reverse`)

#### `humidifier`

**States:** `on`, `off`, `unavailable`

**Attributes:** `current_humidity`, `target_humidity`, `mode`, `available_modes`, `action` (`humidifying`/`drying`/`idle`/`off`)

#### `vacuum`

**States:** `docked`, `cleaning`, `returning`, `paused`, `idle`, `error`, `unavailable`

**Attributes:** `battery_level`, `fan_speed`, `fan_speed_list`, `status`

#### `person`

**States:** location name or `home`, `not_home`, `unknown`

**Attributes:** `source`, `user_id`, `device_trackers` (list of entity IDs)

#### `zone`

**States:** number of people present (numeric)

**Attributes:** `latitude`, `longitude`, `radius`, `passive`, `icon`

#### `automation`

**States:** `on`, `off`

**Attributes:** `last_triggered`, `friendly_name`, `id`

#### `script`

**States:** `on` (running), `off`

**Attributes:** `last_triggered`, `friendly_name`, `mode` (`single`, `parallel`, `queued`, `restart`)

#### `scene`

**States:** `scening` (while activating), `unknown`

**Attributes:** `friendly_name`, `id`, `entity_id` (list of controlled entities)

#### `input_boolean`

**States:** `on`, `off`

#### `input_number`

**States:** numeric value as string

**Attributes:** `min`, `max`, `step`, `mode` (`box`/`slider`), `unit_of_measurement`

#### `input_select`

**States:** current option string

**Attributes:** `options` (list)

#### `input_text`

**States:** current text value

**Attributes:** `min`, `max`, `pattern`

#### `input_datetime`

**States:** datetime string

**Attributes:** `has_date`, `has_time`

#### `timer`

**States:** `idle`, `active`, `paused`

**Attributes:** `duration`, `remaining`, `finishes_at`

#### `counter`

**States:** current count as string

**Attributes:** `initial`, `step`, `min`, `max`

#### `device_tracker`

**States:** `home`, `not_home`, location zone name, `unavailable`

**Attributes:** `source_type` (`gps`, `router`, `bluetooth`, `bluetooth_le`), `latitude`, `longitude`, `battery_level`, `ip`, `mac`

#### `weather`

**States:** `clear-night`, `cloudy`, `exceptional`, `fog`, `hail`, `lightning`, `lightning-rainy`, `partlycloudy`, `pouring`, `rainy`, `snowy`, `snowy-rainy`, `sunny`, `windy`, `windy-variant`

**Attributes:** `temperature`, `humidity`, `pressure`, `wind_speed`, `wind_bearing`, `visibility`, `forecast` (array)

#### `update`

**States:** `on` (update available), `off` (up to date)

**Attributes:** `installed_version`, `latest_version`, `release_url`, `entity_picture`

---

## Domain Service Catalog

### `homeassistant` (system domain)

| Service | Parameters | Description |
|---------|------------|-------------|
| `homeassistant.reload_all` | — | Reload all YAML configs that don't require restart |
| `homeassistant.reload_core_config` | — | Reload core `configuration.yaml` |
| `homeassistant.restart` | — | Restart HA instance |
| `homeassistant.stop` | — | Stop HA (must restart from host) |
| `homeassistant.check_config` | — | Validate config files |
| `homeassistant.update_entity` | `entity_id` | Force immediate state refresh |
| `homeassistant.set_location` | `latitude`, `longitude`, `elevation?` | Move home zone |
| `homeassistant.toggle` | `entity_id?` | Generic toggle |

### `light`

| Service | Key Parameters |
|---------|----------------|
| `light.turn_on` | `entity_id`, `brightness` (0–255), `brightness_pct` (0–100), `color_temp` (mireds), `color_temp_kelvin`, `rgb_color`, `hs_color`, `xy_color`, `rgbw_color`, `rgbww_color`, `white`, `effect`, `flash` (`short`/`long`), `transition` (seconds) |
| `light.turn_off` | `entity_id`, `transition` |
| `light.toggle` | `entity_id` |

Note: Only one color parameter may be provided at a time — HA translates to the device's supported color mode.

### `switch`

| Service | Parameters |
|---------|------------|
| `switch.turn_on` | `entity_id` |
| `switch.turn_off` | `entity_id` |
| `switch.toggle` | `entity_id` |

### `climate`

| Service | Key Parameters |
|---------|----------------|
| `climate.set_hvac_mode` | `entity_id`, `hvac_mode` (`off`/`heat`/`cool`/`heat_cool`/`auto`/`dry`/`fan_only`) |
| `climate.set_temperature` | `entity_id`, `temperature`, `target_temp_high`, `target_temp_low`, `hvac_mode?` |
| `climate.set_humidity` | `entity_id`, `humidity` |
| `climate.set_fan_mode` | `entity_id`, `fan_mode` |
| `climate.set_preset_mode` | `entity_id`, `preset_mode` |
| `climate.set_swing_mode` | `entity_id`, `swing_mode` |
| `climate.turn_on` / `turn_off` | `entity_id` |

### `cover`

| Service | Parameters |
|---------|------------|
| `cover.open_cover` | `entity_id` |
| `cover.close_cover` | `entity_id` |
| `cover.stop_cover` | `entity_id` |
| `cover.set_cover_position` | `entity_id`, `position` (0–100) |
| `cover.open_cover_tilt` | `entity_id` |
| `cover.close_cover_tilt` | `entity_id` |
| `cover.stop_cover_tilt` | `entity_id` |
| `cover.set_cover_tilt_position` | `entity_id`, `tilt_position` (0–100) |
| `cover.toggle` | `entity_id` |

### `media_player`

| Service | Key Parameters |
|---------|----------------|
| `media_player.turn_on` / `turn_off` | `entity_id` |
| `media_player.toggle` | `entity_id` |
| `media_player.volume_up` / `volume_down` | `entity_id` |
| `media_player.volume_set` | `entity_id`, `volume_level` (0–1) |
| `media_player.volume_mute` | `entity_id`, `is_volume_muted` |
| `media_player.media_play` / `media_pause` / `media_stop` | `entity_id` |
| `media_player.media_play_pause` | `entity_id` |
| `media_player.media_next_track` / `media_previous_track` | `entity_id` |
| `media_player.media_seek` | `entity_id`, `seek_position` (seconds) |
| `media_player.play_media` | `entity_id`, `media_content_id`, `media_content_type`, `enqueue?` (`add`/`next`/`play`/`replace`), `announce?` |
| `media_player.select_source` | `entity_id`, `source` |
| `media_player.shuffle_set` | `entity_id`, `shuffle` |
| `media_player.repeat_set` | `entity_id`, `repeat` (`off`/`all`/`one`) |
| `media_player.clear_playlist` | `entity_id` |
| `media_player.join` | `entity_id` (master), `group_members` (list) |
| `media_player.unjoin` | `entity_id` |

### `lock`

| Service | Parameters |
|---------|------------|
| `lock.lock` | `entity_id`, `code?` |
| `lock.unlock` | `entity_id`, `code?` |
| `lock.open` | `entity_id` (for locks with door release) |

### `alarm_control_panel`

| Service | Parameters |
|---------|------------|
| `alarm_control_panel.alarm_disarm` | `entity_id`, `code?` |
| `alarm_control_panel.alarm_arm_home` | `entity_id`, `code?` |
| `alarm_control_panel.alarm_arm_away` | `entity_id`, `code?` |
| `alarm_control_panel.alarm_arm_night` | `entity_id`, `code?` |
| `alarm_control_panel.alarm_arm_vacation` | `entity_id`, `code?` |
| `alarm_control_panel.alarm_arm_custom_bypass` | `entity_id`, `code?` |
| `alarm_control_panel.alarm_trigger` | `entity_id`, `code?` |

### `fan`

| Service | Parameters |
|---------|------------|
| `fan.turn_on` | `entity_id`, `percentage?`, `preset_mode?` |
| `fan.turn_off` | `entity_id` |
| `fan.toggle` | `entity_id` |
| `fan.set_percentage` | `entity_id`, `percentage` (0–100) |
| `fan.set_preset_mode` | `entity_id`, `preset_mode` |
| `fan.oscillate` | `entity_id`, `oscillating` (bool) |
| `fan.set_direction` | `entity_id`, `direction` (`forward`/`reverse`) |
| `fan.increase_speed` / `decrease_speed` | `entity_id`, `percentage_step?` |

### `scene`

| Service | Parameters |
|---------|------------|
| `scene.turn_on` | `entity_id`, `transition?` |
| `scene.apply` | `entities` (dict of entity_id → state), `transition?` |
| `scene.create` | `scene_id`, `entities` (dict), `snapshot_entities?` (list) |
| `scene.delete` | `entity_id` |
| `scene.reload` | — |

### `script`

| Service | Parameters |
|---------|------------|
| `script.turn_on` | `entity_id`, `variables?` (dict) |
| `script.turn_off` | `entity_id` |
| `script.toggle` | `entity_id` |
| `script.reload` | — |

### `automation`

| Service | Parameters |
|---------|------------|
| `automation.turn_on` / `turn_off` | `entity_id` |
| `automation.toggle` | `entity_id` |
| `automation.trigger` | `entity_id`, `skip_condition?` (bool) |
| `automation.reload` | — |

### `input_boolean`

| Service | Parameters |
|---------|------------|
| `input_boolean.turn_on` / `turn_off` / `toggle` | `entity_id` |

### `input_number`

| Service | Parameters |
|---------|------------|
| `input_number.set_value` | `entity_id`, `value` |
| `input_number.increment` / `decrement` | `entity_id` |

### `input_select`

| Service | Parameters |
|---------|------------|
| `input_select.select_option` | `entity_id`, `option` |
| `input_select.select_next` / `select_previous` | `entity_id`, `cycle?` (bool) |
| `input_select.set_options` | `entity_id`, `options` (list) |

### `input_text`

| Service | Parameters |
|---------|------------|
| `input_text.set_value` | `entity_id`, `value` |

### `input_datetime`

| Service | Parameters |
|---------|------------|
| `input_datetime.set_datetime` | `entity_id`, `date?`, `time?`, `datetime?`, `timestamp?` |

### `timer`

| Service | Parameters |
|---------|------------|
| `timer.start` | `entity_id`, `duration?` |
| `timer.pause` | `entity_id` |
| `timer.cancel` | `entity_id` |
| `timer.finish` | `entity_id` |
| `timer.change` | `entity_id`, `duration` |
| `timer.reload` | — |

### `counter`

| Service | Parameters |
|---------|------------|
| `counter.increment` / `decrement` | `entity_id` |
| `counter.reset` | `entity_id` |
| `counter.set_value` | `entity_id`, `value` |
| `counter.configure` | `entity_id`, `initial?`, `minimum?`, `maximum?`, `step?` |

### `notify`

| Service | Parameters |
|---------|------------|
| `notify.<notifier_name>` | `message`, `title?`, `target?`, `data?` |
| `notify.persistent_notification` | `message`, `title?`, `notification_id?` |

### `vacuum`

| Service | Parameters |
|---------|------------|
| `vacuum.start` / `stop` / `pause` / `return_to_base` | `entity_id` |
| `vacuum.clean_spot` | `entity_id` |
| `vacuum.locate` | `entity_id` |
| `vacuum.set_fan_speed` | `entity_id`, `fan_speed` |
| `vacuum.send_command` | `entity_id`, `command`, `params?` |

### `camera`

| Service | Parameters |
|---------|------------|
| `camera.turn_on` / `turn_off` | `entity_id` |
| `camera.snapshot` | `entity_id`, `filename` |
| `camera.record` | `entity_id`, `filename`, `duration?`, `lookback?` |
| `camera.play_stream` | `entity_id`, `media_player`, `format?` (`hls`/`web_m`) |
| `camera.enable_motion_detection` / `disable_motion_detection` | `entity_id` |

### `person`

| Service | Parameters |
|---------|------------|
| `person.reload` | — |

### `zone`

| Service | Parameters |
|---------|------------|
| `zone.reload` | — |

### `persistent_notification`

| Service | Parameters |
|---------|------------|
| `persistent_notification.create` | `message`, `title?`, `notification_id?` |
| `persistent_notification.dismiss` | `notification_id` |
| `persistent_notification.dismiss_all` | — |

### `conversation` (AI assistant)

| Service | Parameters | Notes |
|---------|------------|-------|
| `conversation.process` | `text`, `agent_id?`, `conversation_id?`, `language?` | Returns response; use `return_response: true` in WS |

---

## Registry Model

### Area Registry

Areas represent rooms or physical spaces in the home. An area can contain multiple devices and entities.

**Fields:**
- `area_id` — unique slug (e.g. `living_room`)
- `name` — display name
- `icon` — optional MDI icon
- `aliases` — alternative names for voice assistants
- `floor_id` — optional floor grouping
- `labels` — string array for tagging

**WS management:**
- `config/area_registry/list`
- `config/area_registry/create` — `{"name": "..."}`
- `config/area_registry/update` — `{"area_id": "...", "name": "...", "icon": "..."}`
- `config/area_registry/delete` — `{"area_id": "..."}`

### Device Registry

Devices group related entities from the same physical hardware.

**Fields:**
| Field | Description |
|-------|-------------|
| `id` | HA-generated unique ID |
| `name` | Display name (editable by user via `name_by_user`) |
| `manufacturer` | Hardware manufacturer |
| `model` | Hardware model |
| `model_id` | Machine-readable model identifier |
| `sw_version` | Firmware version |
| `hw_version` | Hardware revision |
| `serial_number` | Serial (not guaranteed unique) |
| `identifiers` | Set of `(domain, unique_value)` tuples |
| `connections` | Set of `(type, value)` tuples e.g. `("mac", "aa:bb:cc:dd:ee:ff")` |
| `configuration_url` | Link to device's web UI |
| `area_id` | Assigned area |
| `via_device` | Parent device ID (for hubs/gateways) |
| `entry_type` | `service` for cloud services (no physical device) |

**WS management:**
- `config/device_registry/list`
- `config/device_registry/update` — `{"device_id": "...", "name_by_user": "...", "area_id": "..."}`

### Entity Registry

The entity registry persists entity configuration across restarts.

**Fields:**
| Field | Description |
|-------|-------------|
| `entity_id` | Current assigned entity ID |
| `unique_id` | Integration-provided stable identifier |
| `platform` | Integration domain (e.g. `hue`, `zwave_js`) |
| `name` | User-overridden display name |
| `icon` | User-overridden icon |
| `device_id` | Associated device |
| `area_id` | Direct area assignment (overrides device area) |
| `labels` | String tags |
| `disabled_by` | `user`, `integration`, `config_entry`, or null |
| `hidden_by` | `user`, `integration` |
| `entity_category` | `config` or `diagnostic` |
| `aliases` | Alternative names for voice assistants |

**WS management:**
- `config/entity_registry/list` — full list including disabled
- `config/entity_registry/list_for_display` — lightweight display list
- `config/entity_registry/get` — `{"entity_id": "..."}`
- `config/entity_registry/update` — `{"entity_id": "...", "name": "...", "icon": "...", "area_id": "...", "disabled_by": null, "new_entity_id": "..."}`
- `config/entity_registry/remove` — `{"entity_id": "..."}`

### Config Entry Registry

Represents integration instances (e.g. each Hue bridge is a separate config entry).

**WS management:**
- `config_entries/get`
- `config_entries/flow/init` — start new integration setup
- `config_entries/flow/progress` — list in-progress flows

---

## Current Maisie Implementation vs. Full Surface

### What Maisie Currently Has

**Client (`packages/agent/src/skills/smarthome/ha-client.ts`):**
- `ping()` — `/api/`
- `getStates()` — `/api/states` (all)
- `getState(entityId)` — `/api/states/<entity_id>`
- `getByDomain(domain)` — filter all states by domain prefix (client-side)
- `callService(domain, service, data)` — `/api/services/<domain>/<service>`
- `turnOn(entityId)` / `turnOff(entityId)` — convenience wrappers
- `setLight(entityId, {brightness, rgb, color_temp})` — light control
- `triggerScene(sceneEntityId)` — scene activation
- `getLights()` / `getSwitches()` / `getScenes()` — domain-filtered state lists

**Router (`packages/agent/src/api/smart-home.ts`):**
- `GET /ha/lights` — list lights with name/state/brightness/rgb/colorTemp
- `GET /ha/switches` — list switches with name/state
- `GET /ha/scenes` — list scenes
- `POST /ha/lights/:entityId/toggle` — toggle light
- `POST /ha/switches/:entityId/toggle` — toggle switch
- `POST /ha/scenes/:entityId/trigger` — trigger scene

### What Is Missing

**High-value gaps to fill for a home AI platform:**

| Gap | Why It Matters |
|-----|----------------|
| Climate control (read + set) | Thermostat automation is core home AI |
| Binary sensors & motion | Motion-triggered automations |
| All sensors (temperature, energy, etc.) | Environmental awareness |
| Lock control | Smart home security |
| Media player control | Whole-home audio / TV integration |
| Cover control | Blinds, garage doors |
| Person / device tracker | Presence detection, arrivals/departures |
| Generic `callService` endpoint | Exposes any HA service via REST |
| WebSocket push connection | Real-time state change events without polling |
| History API | Trend data for AI context |
| Template rendering | Dynamic queries (e.g. "all lights in living room") |
| Calendar read | AI-aware scheduling |
| Automation trigger/enable/disable | AI-managed automation control |
| Area-scoped queries | "Turn off everything in the bedroom" |
| Intent handling | Natural language → HA actions |
| MQTT discovery publisher | Expose Maisie-native devices to HA |

**Architecture note on WebSocket:** The current client is pure REST (polling). For a home AI platform, subscribing to `state_changed` events via WebSocket is strongly preferable — it enables instant reaction to device state changes with zero polling overhead. The `subscribe_events` command with `event_type: "state_changed"` gives a live feed of every entity transition.

**Architecture note on generic service call:** The `callService(domain, service, data)` method exists in the client but is not exposed via the Maisie REST API. Exposing it as `POST /ha/services/:domain/:service` would unlock the entire HA service catalog without per-service endpoints.

**Architecture note on area targeting:** HA's service call `target` object supports `area_id`, which lets a single call affect all entities of the right type in a room. This is the correct primitive for "turn off all lights in the bedroom"-style commands an AI would issue.
