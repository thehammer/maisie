import { z } from 'zod'
import { defineAction, field } from '@maisie/shared'
import { getClients } from './clients'

const macSchema = z.string().regex(/^([0-9a-fA-F]{2}:){5}[0-9a-fA-F]{2}$/, 'Invalid MAC address')

// ─────────────────────────────────────────────────────────────────────────────
// Network — list_devices, get_wan_health, get_topology, invoke_network_audit,
//           invoke_block_device, invoke_unblock_device
// ─────────────────────────────────────────────────────────────────────────────

export const listDevices = defineAction({
  name: 'list_devices',
  description: 'List all active devices on the home network with their MAC, IP, hostname, vendor, VLAN, and connection type.',
  input: z.object({
    vlan: z.number().optional(),
  }),
  output: z.array(z.object({
    mac:       field(z.string(), 'string'),
    ip:        field(z.string(), 'string').optional(),
    hostname:  field(z.string(), 'string').optional(),
    oui:       field(z.string(), 'string').optional(),
    network:   field(z.string(), 'string').optional(),
    is_wired:  field(z.boolean(), 'boolean'),
    last_seen: field(z.number(), 'timestamp'),
  })),
  http: { method: 'GET' },
  ai: { tier: 'inform' },
  ui: { type: 'data', label: 'Network Devices', section: 'network', realtimeTopic: 'home/network/devices/+' },
  async execute(input, _ctx) {
    const { unifi } = getClients()
    if (!unifi) throw new Error('UniFi not configured')
    let clients = await unifi.getActiveClients()
    if (input.vlan !== undefined) {
      clients = clients.filter((c: any) => c.vlan === input.vlan)
    }
    return clients
  },
})

export const getWanHealth = defineAction({
  name: 'get_wan_health',
  description: 'Check internet connectivity status, latency, and WAN IP.',
  input: z.object({}),
  output: z.object({
    online:    field(z.boolean(), 'boolean'),
    latencyMs: field(z.number(), 'duration').optional(),
    wanIp:     field(z.string(), 'string').optional(),
  }),
  http: { method: 'GET' },
  ai: { tier: 'inform' },
  ui: { type: 'data', label: 'WAN Health', section: 'network' },
  async execute(_input, _ctx) {
    const { unifi } = getClients()
    if (!unifi) throw new Error('UniFi not configured')
    const health = await unifi.getHealth()
    const wan = health.find((h: any) => h.subsystem === 'wan')
    return {
      online: wan?.status === 'ok',
      wanIp:  wan?.wan_ip,
    }
  },
})

export const getTopology = defineAction({
  name: 'get_topology',
  description: 'Get the home network topology: access points, switches, VLANs, and connected device counts.',
  input: z.object({}),
  output: z.object({
    accessPoints: z.array(z.object({
      name:    field(z.string(), 'string'),
      mac:     field(z.string(), 'string'),
      status:  field(z.string(), 'status'),
      clients: field(z.number(), 'number'),
    })),
    switches: z.array(z.object({
      name:   field(z.string(), 'string'),
      mac:    field(z.string(), 'string'),
      status: field(z.string(), 'status'),
    })),
    vlans: z.array(z.object({
      name:        field(z.string(), 'string'),
      id:          z.union([z.string(), z.number()]),
      purpose:     field(z.string(), 'string').optional(),
      deviceCount: field(z.number(), 'number'),
    })),
    wanStatus: field(z.string(), 'status'),
    wanIp:     field(z.string(), 'string').optional(),
  }),
  http: { method: 'GET' },
  ai: { tier: 'inform' },
  ui: { type: 'data', label: 'Network Topology', section: 'network' },
  async execute(_input, _ctx) {
    const { unifi } = getClients()
    if (!unifi) throw new Error('UniFi not configured')
    // Sequential calls — never Promise.all with UniFi (causes UDM to become unresponsive)
    const clients      = await unifi.getActiveClients()
    const infraDevices = await unifi.getDevices()
    const health       = await unifi.getHealth()
    const networks     = await unifi.getNetworks()

    const wanHealth = health.find((h: any) => h.subsystem === 'wan')

    const accessPoints = infraDevices
      .filter((d: any) => d.type === 'uap')
      .map((ap: any) => ({
        name:    ap.name || ap.mac,
        mac:     ap.mac,
        status:  ap.state === 1 ? 'ok' : 'error',
        clients: clients.filter((c: any) => c.ap_mac === ap.mac).length,
      }))

    const switches = infraDevices
      .filter((d: any) => d.type === 'usw')
      .map((sw: any) => ({
        name:   sw.name || sw.mac,
        mac:    sw.mac,
        status: sw.state === 1 ? 'ok' : 'error',
      }))

    const vlans = networks.map((n: any) => ({
      name:        n.name,
      id:          n.vlan || n._id,
      purpose:     n.purpose,
      deviceCount: clients.filter(
        (c: any) => c.network === n.name || c.network_id === n._id
      ).length,
    }))

    return {
      accessPoints,
      switches,
      vlans,
      wanStatus: wanHealth?.status === 'ok' ? 'ok' : 'error',
      wanIp:     wanHealth?.wan_ip,
    }
  },
})

export const invokeNetworkAudit = defineAction({
  name: 'invoke_network_audit',
  description: 'Run a security audit of the home network. Returns findings about unusual devices, firewall config, and network health.',
  input: z.object({}),
  output: z.object({
    findings: z.array(z.object({
      type:    z.enum(['warning', 'recommendation', 'info']),
      area:    z.string(),
      message: z.string(),
    })),
    summary: z.string(),
  }),
  http: { method: 'POST' },
  ai: {
    tier: 'advise',
    description: 'Run a security audit of the home network. Returns findings about unusual devices, firewall config, and network health. Call this when asked about network security or anomalies.',
  },
  ui: { type: 'action', label: 'Network Audit', section: 'network' },
  async execute(_input, _ctx) {
    const { unifi } = getClients()
    if (!unifi) throw new Error('UniFi not configured')

    // Sequential calls — never Promise.all with UniFi
    const clients       = await unifi.getActiveClients()
    const infraDevices  = await unifi.getDevices()
    const health        = await unifi.getHealth()
    const networks      = await unifi.getNetworks()
    const firewallRules = await unifi.getFirewallRules()

    const findings: { type: 'warning' | 'recommendation' | 'info'; area: string; message: string }[] = []

    const wanHealth = health.find((h: any) => h.subsystem === 'wan')
    if (wanHealth?.status !== 'ok') {
      findings.push({ type: 'warning', area: 'wan', message: `WAN status: ${wanHealth?.status || 'unknown'}` })
    }

    const iotKeywords = /tv|roku|firestick|echo|alexa|nest|ring|wyze|plug|bulb|hue|sonos|roomba|klipsch|lgweb/i
    const mainNetIot = clients.filter((c: any) => {
      const name = c.hostname || c.name || ''
      return iotKeywords.test(name) && (c.network === 'Default' || c.network === 'LAN' || !c.network)
    })
    if (mainNetIot.length > 0) {
      const names = mainNetIot.map((c: any) => c.hostname || c.name || c.mac).join(', ')
      findings.push({ type: 'recommendation', area: 'segmentation', message: `${mainNetIot.length} IoT-like device(s) on main network: ${names}` })
    }

    const weakSignal = clients.filter((c: any) => c.rssi !== undefined && c.rssi < 20)
    if (weakSignal.length > 0) {
      findings.push({ type: 'info', area: 'wifi', message: `${weakSignal.length} client(s) with weak signal (RSSI < 20)` })
    }

    const unidentified = clients.filter((c: any) => !c.hostname && !c.name && !c.oui)
    if (unidentified.length > 0) {
      findings.push({ type: 'warning', area: 'inventory', message: `${unidentified.length} device(s) with no hostname or vendor information` })
    }

    const hasIotVlan = networks.some((n: any) => /iot/i.test(n.name))
    if (!hasIotVlan) {
      findings.push({ type: 'recommendation', area: 'segmentation', message: 'No IoT VLAN detected — consider creating one' })
    }

    const aps = infraDevices.filter((d: any) => d.type === 'uap')
    if (aps.length > 1) {
      const counts = aps.map((ap: any) => clients.filter((c: any) => c.ap_mac === ap.mac).length)
      const maxC = Math.max(...counts)
      const minC = Math.min(...counts)
      if (maxC > minC * 3 && maxC > 10) {
        findings.push({ type: 'info', area: 'wifi', message: `AP load imbalance: max ${maxC} clients vs min ${minC}` })
      }
    }

    const disabledRules = firewallRules.filter((r: any) => r.enabled === false)
    if (disabledRules.length > 0) {
      findings.push({ type: 'info', area: 'firewall', message: `${disabledRules.length} firewall rule(s) are disabled` })
    }

    const summary = findings.length === 0
      ? 'Network looks healthy — no issues detected.'
      : `${findings.length} finding(s): ${findings.filter(f => f.type === 'warning').length} warning(s), ${findings.filter(f => f.type === 'recommendation').length} recommendation(s), ${findings.filter(f => f.type === 'info').length} info.`

    return { findings, summary }
  },
})

export const invokeBlockDevice = defineAction({
  name: 'invoke_block_device',
  description: 'Block a device from accessing the network by MAC address. Use when a device is identified as unauthorized or suspicious.',
  input: z.object({
    mac:    macSchema,
    reason: z.string().optional(),
  }),
  output: z.object({ success: z.boolean() }),
  http: { method: 'POST' },
  ai: {
    tier: 'advise',
    description: 'Block a device from accessing the network by MAC address. Use when a device is identified as unauthorized or suspicious.',
  },
  ui: false,
  async execute(input, ctx) {
    const { unifi } = getClients()
    if (!unifi) throw new Error('UniFi not configured')
    await unifi.blockClient(input.mac)
    ctx.emit('home/network/devices/blocked', { mac: input.mac, reason: input.reason })
    return { success: true }
  },
})

export const invokeUnblockDevice = defineAction({
  name: 'invoke_unblock_device',
  description: 'Unblock a previously blocked device, restoring its network access.',
  input: z.object({ mac: macSchema }),
  output: z.object({ success: z.boolean() }),
  http: { method: 'POST' },
  ai: { tier: 'advise' },
  ui: false,
  async execute(input, ctx) {
    const { unifi } = getClients()
    if (!unifi) throw new Error('UniFi not configured')
    await unifi.unblockClient(input.mac)
    ctx.emit('home/network/devices/unblocked', { mac: input.mac })
    return { success: true }
  },
})

// ─────────────────────────────────────────────────────────────────────────────
// Camera (Protect) — list_cameras, get_snapshot, list_camera_events
// ─────────────────────────────────────────────────────────────────────────────

export const listCameras = defineAction({
  name: 'list_cameras',
  description: 'List all UniFi Protect cameras with their state, recording status, and channel configuration.',
  input: z.object({}),
  output: z.array(z.object({
    id:               field(z.string(), 'string'),
    name:             field(z.string(), 'string'),
    type:             field(z.string(), 'string'),
    state:            field(z.string(), 'status'),
    isConnected:      field(z.boolean(), 'boolean'),
    isRecording:      field(z.boolean(), 'boolean'),
    isMotionDetected: field(z.boolean(), 'boolean'),
    mac:              field(z.string(), 'string'),
  })),
  http: { method: 'GET' },
  ai: { tier: 'inform' },
  ui: { type: 'data', label: 'Cameras', section: 'protect', realtimeTopic: 'home/protect/cameras' },
  async execute(_input, _ctx) {
    const { protect } = getClients()
    if (!protect) throw new Error('UniFi Protect not configured')
    const cameras = await protect.getCameras()
    return cameras.map((cam: any) => ({
      id:               cam.id,
      name:             cam.name,
      type:             cam.type,
      state:            cam.state === 'connected' ? 'ok' : 'error',
      isConnected:      cam.isConnected,
      isRecording:      cam.isRecording,
      isMotionDetected: cam.isMotionDetected,
      mac:              cam.mac,
    }))
  },
})

export const getSnapshot = defineAction({
  name: 'get_snapshot',
  description: 'Get the current snapshot URL for a security camera by camera ID.',
  input: z.object({ cameraId: z.string() }),
  output: z.object({
    url:        field(z.string(), 'image'),
    cameraName: field(z.string(), 'string'),
  }),
  http: { method: 'GET' },
  ai: { tier: 'inform' },
  ui: false,
  async execute(input, _ctx) {
    const { protect } = getClients()
    if (!protect) throw new Error('UniFi Protect not configured')
    const camera = await protect.getCamera(input.cameraId)
    const host = process.env.UNIFI_HOST
    const url = `https://${host}/proxy/protect/api/cameras/${input.cameraId}/snapshot`
    return { url, cameraName: camera.name }
  },
})

export const listCameraEvents = defineAction({
  name: 'list_camera_events',
  description: 'List recent motion and smart detection events from Protect cameras in the last 24 hours.',
  input: z.object({
    cameraId: z.string().optional(),
    limit:    z.number().default(20),
  }),
  output: z.array(z.object({
    id:     field(z.string(), 'string'),
    type:   field(z.string(), 'string'),
    start:  field(z.number(), 'timestamp'),
    end:    field(z.number(), 'timestamp').nullable(),
    camera: field(z.string(), 'string'),
    score:  field(z.number(), 'percentage'),
  })),
  http: { method: 'GET' },
  ai: { tier: 'inform' },
  ui: { type: 'data', label: 'Recent Camera Events', section: 'protect' },
  async execute(input, _ctx) {
    const { protect } = getClients()
    if (!protect) throw new Error('UniFi Protect not configured')
    const end   = Date.now()
    const start = end - 24 * 60 * 60 * 1000
    let events  = await protect.getEvents({ start, end })
    if (input.cameraId) {
      events = events.filter((e: any) => e.camera === input.cameraId)
    }
    return events.slice(0, input.limit).map((e: any) => ({
      id:     e.id,
      type:   e.type,
      start:  e.start,
      end:    e.end ?? null,
      camera: e.camera,
      score:  e.score ?? 0,
    }))
  },
})
