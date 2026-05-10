# Plan: serviceStatus-conversion

## Goal

Convert the `ServiceStatus` dashboard component from a hand-coded card to one that works in `AppNext.tsx` via the entity + component system. Add a `services` entity to the entity registry backed by a new `/api/services/status` endpoint, author a ViewDef and derived component, wire it into `AppNext.tsx`, and track the conversion in `packages/agent/src/coverage-matrix.ts`.

## Why

`ServiceStatus` is among the simpler hand-coded cards (uniform list of chip-style items). Converting it validates the Wave 1 conversion workflow and demonstrates the three-layer model on a service health display. The pattern established here (multi-API aggregation → single entity endpoint) will be reused for other cards.

## Current State (confirmed by reading source)

### The hand-coded component

**`packages/dashboard/src/components/ServiceStatus.tsx`** — renders a `<div class="card wide">` containing service chips. Each chip shows a status dot (colored by `s.status: 'connected' | 'error' | 'unconfigured'`), the service name, and an optional detail string.

### Where the data comes from (important)

**`packages/dashboard/src/App.tsx` lines 300–358** — ServiceStatus is NOT backed by a single API endpoint. Its `services` array is assembled in App.tsx from 12 different `useApi` calls (UniFi, Synology, Plex, Radarr, Sonarr, DAKboard, HDHomeRun, Home Assistant, Bambu, Calibre, plus Agent health and MQTT connection state).

`packages/dashboard/src/lib/static-descriptors.ts` line 128–141 — `ServiceStatus` descriptor has `endpoint: ""` (empty string) with a comment: "aggregated in App.tsx — no single endpoint."

### The entity system

**`packages/plugin-core/src/entity-registry.ts`** — `EntityRegistry` registers `catalog` and `memory` as sentinel-backed entities in its constructor. We will add a `services` entity here, backed by a sentinel `__services_status` that dispatches to a new API endpoint.

Alternatively (and more correctly), we create a plugin action for service status and let `synthesizeEntityFromAction` handle the entity creation automatically. This is the correct path for new capabilities.

**`packages/dashboard/src/AppNext.tsx`** — currently shows `PlaceholderPage` for all non-Studio pages. The `home` page is where `ServiceStatus` should appear.

**`packages/dashboard/src/components/ViewCard.tsx`** — resolves a named view through the three-layer pipeline: fetch ViewDef → fetch entity field → apply chain → render with component.

## Approach

The cleanest path is:

1. **New API endpoint** `GET /api/services/status` — aggregates health from all services and returns a flat array of `{ name, status, detail? }` records
2. **New entity** `services.get_status` — a plugin entity backed by the new endpoint (via the plugin action pattern, or registered directly)
3. **New derived component** `ServiceChip` — renders a single service row with status dot + name + detail
4. **ViewDef** `services-status` — source: `services.get_status`, chain: [], component: `ServiceChips` (derived component that renders the list)
5. **AppNext.tsx home page** — render `<ViewCard viewName="services-status" />` instead of `PlaceholderPage`
6. **Coverage matrix** entry

## Steps

### Step 1: Create the service status API endpoint

Create `packages/agent/src/api/services.ts`:

```typescript
import { Hono } from 'hono'
import type { Services } from './types'

interface ServiceStatusItem {
  name: string
  status: 'connected' | 'error' | 'unconfigured'
  detail?: string
}

export function createServicesRouter(_services: Pick<Services, 'db'>): Hono {
  const router = new Hono()

  // GET /services/status — aggregate health from all connected services
  router.get('/services/status', async (c) => {
    const checks = await Promise.allSettled([
      checkService('Agent', '/api/health'),
      checkService('Plex', '/api/plex/plex-status'),
      checkService('Synology', '/api/synology/storage-health'),
      checkService('HDHomeRun', '/api/hdhr/status'),
      checkService('Home Assistant', '/api/home-assistant/switches'),
      checkService('DAKboard', '/api/dakboard/devices'),
      checkService('Bambu X1C', '/api/bambu/print-status'),
      checkService('Calibre', '/api/calibre/calibre-status'),
      checkService('Media Stack', '/api/media/calendar'),
    ])

    const services: ServiceStatusItem[] = checks.map((result, i) => {
      if (result.status === 'fulfilled') return result.value
      const names = ['Agent', 'Plex', 'Synology', 'HDHomeRun', 'Home Assistant', 'DAKboard', 'Bambu X1C', 'Calibre', 'Media Stack']
      return { name: names[i], status: 'error' as const, detail: 'check failed' }
    })

    return c.json(services)
  })

  return router
}

async function checkService(name: string, path: string): Promise<ServiceStatusItem> {
  try {
    const baseUrl = process.env.AGENT_BASE_URL ?? 'http://localhost:3001'
    const res = await fetch(`${baseUrl}${path}`, { signal: AbortSignal.timeout(5000) })
    if (res.ok) {
      return { name, status: 'connected' }
    }
    return { name, status: 'error', detail: `HTTP ${res.status}` }
  } catch {
    return { name, status: 'unconfigured', detail: 'unreachable' }
  }
}
```

**Note on self-calling**: The services endpoint checks other local endpoints. Use `process.env.AGENT_BASE_URL` or default to `http://localhost:3001` (the agent's own port). Alternatively, import the service clients directly and call them inline — this avoids HTTP round-trips but requires more refactoring. The HTTP approach is simpler for this job.

**Simpler alternative**: Since the services are all internal, the router can import the existing service clients directly and call `healthCheck()` or equivalent methods. Look at `packages/agent/src/skills/synology/health.ts`, `packages/agent/src/skills/media/plex-status.ts`, etc. The HTTP self-call approach is fine for a first pass.

### Step 2: Wire the services router into the API

In `packages/agent/src/api/index.ts`:

Add the import:
```typescript
import { createServicesRouter } from './services'
```

Add the route mount (add after the health router line ~83):
```typescript
app.route('/api', createServicesRouter(services))
```

### Step 3: Register the services entity

The service status endpoint returns a collection of service status records. Register a plugin entity for it.

The simplest path: add the entity registration in `packages/agent/src/services/entity-loader.ts` (look at this file to understand the boot-time entity registration pattern). Or register it directly in `entity-registry.ts`'s constructor as a sentinel-backed entity.

**Preferred approach — sentinel in constructor** (consistent with catalog/memory):

In `packages/plugin-core/src/entity-registry.ts` constructor, add after the memory entity:

```typescript
const servicesEntity: EntityDef = {
  name: 'services',
  description: 'Health status of all connected services',
  source: 'plugin',
  pluginName: 'core',
  section: 'system',
  fields: {
    status: {
      kind: 'data',
      type: 'collection',
      actionName: '__services_status',
    },
  },
}
this.entities.set('services', servicesEntity)
```

Then add the sentinel dispatch in `packages/plugin-core/src/address-resolver.ts` inside `invokePluginAction()`:

```typescript
if (actionName === '__services_status') {
  const baseUrl = process.env.AGENT_BASE_URL ?? 'http://localhost:3001'
  const res = await fetch(`${baseUrl}/api/services/status`, { signal: AbortSignal.timeout(8000) })
  if (!res.ok) throw new Error(`Services status fetch failed: HTTP ${res.status}`)
  return res.json() as Promise<MaisieValue>
}
```

This makes `resolve_address("services.status")` work from the agent's MEL evaluator.

### Step 4: Author a derived component for service chips

Create or seed a derived component called `service-chip-list` that renders the services collection. Since derived components are stored in the database, seed it via the view-loader or by POSTing to `/api/components` at boot.

For this job, the simplest approach is to seed the derived component definition in code. Add a seed function in `packages/agent/src/services/view-loader.ts` (look at this file to understand the boot pattern):

The `service-chip-list` derived component description:
```
Renders a list of service status chips. Each chip shows a status indicator, service name, and optional detail.
```

Input type: `collection<record<{ name: string, status: string, detail?: string }>>`

For the initial conversion, rather than a full derived-component authoring pass, use the existing `json` base component as the rendering component — it will display the data correctly even without custom chip styling. A proper chip-styled component is follow-up work.

### Step 5: Create and seed the ViewDef

Create a ViewDef for `services-status`. Seed it at boot time via the view loader.

In `packages/agent/src/services/view-loader.ts`, add a seed step that ensures the `services-status` view exists:

```typescript
// Seed default views if they don't exist
const existingServiceView = await viewStore.get('services-status')
if (!existingServiceView) {
  await viewStore.save({
    name: 'services-status',
    description: 'Health status of all connected services',
    source: { entity: 'services', field: 'status' },
    chain: [],
    component: 'json',  // initial: json renderer; upgrade to derived chip component later
    componentProps: { expanded: true },
  })
  viewRegistry.register({
    name: 'services-status',
    description: 'Health status of all connected services',
    source: { entity: 'services', field: 'status' },
    chain: [],
    component: 'json',
    componentProps: { expanded: true },
  })
}
```

If `view-loader.ts` doesn't exist yet, check what boot sequence wires up views from the database. Look at `packages/agent/src/index.ts` for the boot sequence, and `packages/agent/src/services/entity-loader.ts` as a model for loader pattern.

### Step 6: Wire into AppNext.tsx

In `packages/dashboard/src/AppNext.tsx`, add a home page case that renders the service status view:

Replace the `PlaceholderPage` for the `home` page with actual content:

```typescript
import { ViewCard } from "./components/ViewCard";

// In the page content section, replace:
// {page === "studio" ? <StudioPage .../> : <PlaceholderPage name={page} />}
// with:

{page === "studio" ? (
  <StudioPage onBack={() => setPage("home")} />
) : page === "home" ? (
  <div style={{ padding: 24, display: "flex", flexDirection: "column", gap: 16 }}>
    <ViewCard viewName="services-status" titleOverride="Services" />
  </div>
) : (
  <PlaceholderPage name={page} />
)}
```

### Step 7: Create the coverage matrix

Create `packages/agent/src/coverage-matrix.ts`:

```typescript
/**
 * Coverage matrix — tracks which hand-coded cards have been converted
 * to the three-layer entity + component system.
 *
 * Each entry records:
 *   - visual: the component renders in AppNext (via ViewCard)
 *   - scriptable: the entity is addressable via MEL (resolve_address works)
 *   - agentic: the entity is exposed to agent personas (ai tier declared)
 */

export interface CoverageEntry {
  cardId: string
  description: string
  visual: boolean       // ViewCard renders in AppNext
  scriptable: boolean   // MEL-addressable via resolve_address()
  agentic: boolean      // exposed to agent personas
  notes?: string
}

export const COVERAGE_MATRIX: CoverageEntry[] = [
  {
    cardId: 'ServiceStatus',
    description: 'Service health chips — connected/error/unconfigured per integration',
    visual: true,
    scriptable: true,
    agentic: false,
    notes: 'Rendered via ViewCard (services-status view) in AppNext home page. Entity: services.status sentinel. Agentic exposure deferred.',
  },
  {
    cardId: 'NetworkCard',
    description: 'UniFi device list',
    visual: false,
    scriptable: false,
    agentic: false,
    notes: 'Not yet converted.',
  },
  {
    cardId: 'PlexCard',
    description: 'Plex server status with libraries, now playing, recently added',
    visual: false,
    scriptable: false,
    agentic: false,
    notes: 'Not yet converted.',
  },
  {
    cardId: 'NasCard',
    description: 'Synology NAS storage health',
    visual: false,
    scriptable: false,
    agentic: false,
    notes: 'Not yet converted.',
  },
  {
    cardId: 'RecentlyAddedCard',
    description: 'Plex recently added with RAF carousel animation',
    visual: false,
    scriptable: false,
    agentic: false,
    notes: 'Requires carousel base component stub. Not yet converted.',
  },
  {
    cardId: 'NightlyCard',
    description: 'Nightly maintenance task status',
    visual: false,
    scriptable: false,
    agentic: false,
    notes: 'Not yet converted.',
  },
]

/** Returns all converted cards (visual AND scriptable). */
export function getConvertedCards(): CoverageEntry[] {
  return COVERAGE_MATRIX.filter((e) => e.visual && e.scriptable)
}

/** Returns conversion percentage. */
export function getCoveragePercent(): number {
  const converted = getConvertedCards().length
  return Math.round((converted / COVERAGE_MATRIX.length) * 100)
}
```

### Step 8: Verify

```bash
bun run typecheck
bun test
```

Both must pass. The `bun test` suite should not break — the new endpoint and entity are additive.

Manually verify by opening the AppNext UI at `/next` — the Home page should show the services-status ViewCard rendering the services collection.

## Key Files to Create/Modify

| File | Action |
|------|--------|
| `packages/agent/src/api/services.ts` | CREATE — new services status router |
| `packages/agent/src/api/index.ts` | MODIFY — add services router mount |
| `packages/plugin-core/src/entity-registry.ts` | MODIFY — add `services` sentinel entity in constructor |
| `packages/plugin-core/src/address-resolver.ts` | MODIFY — add `__services_status` sentinel dispatch |
| `packages/agent/src/services/view-loader.ts` | MODIFY (or CREATE) — seed `services-status` ViewDef at boot |
| `packages/dashboard/src/AppNext.tsx` | MODIFY — render ViewCard for home page |
| `packages/agent/src/coverage-matrix.ts` | CREATE — coverage tracking |

## What NOT to do

- Do not modify `packages/dashboard/src/App.tsx` or `packages/dashboard/src/components/ServiceStatus.tsx`. The legacy card stays working; AppNext gets the new version.
- Do not attempt a full chip-styled derived component in this job. The `json` base component renderer is an acceptable first-pass. Custom chip styling is follow-up work.
- Do not break the existing `/api/views` or `/api/entities` routes.

```yaml
suggested_config:
  cody:
    model: sonnet
    effort: high
    rationale: "Multi-file conversion touching entity registry, address resolver, API routing, view seeding, and AppNext wiring. Many integration points. Needs understanding of the sentinel pattern and boot sequence."
  redd:
    model: sonnet
    effort: high
    rationale: "Critical to verify the sentinel dispatch, view seeding pattern, and that AppNext renders correctly without breaking the legacy app."
  marty:
    model: sonnet
    effort: medium
    rationale: "Integration test verification is important here — ensure the ViewCard resolves through the full pipeline."
  perri:
    skip: false
    model: haiku
    effort: low
    rationale: "downgrade: the services endpoint only calls localhost; no external SSRF surface. Light review pass is sufficient."
```
