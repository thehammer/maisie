import { z } from 'zod'
import { defineAction } from '@maisie/shared'
import { getClients } from './clients'

// MAC address regex: colon-separated hex octets
const macSchema = z.string().regex(/^([0-9a-fA-F]{2}:){5}[0-9a-fA-F]{2}$/, 'Invalid MAC address')

export const getDevices = defineAction({
  name: 'get_devices',
  description: 'Get all devices on the home network. Returns MAC, IP, hostname, vendor, VLAN, and online status.',
  input: z.object({
    onlineOnly: z.boolean().optional(),
    vlan: z.number().optional(),
  }),
  output: z.array(z.object({
    mac: z.string(),
    ip: z.string().optional(),
    hostname: z.string().optional(),
    oui: z.string().optional(),
    network: z.string().optional(),
    is_wired: z.boolean(),
    last_seen: z.number(),
  })),
  http: { method: 'GET' },
  ai: { tier: 'inform' },
  ui: { label: 'Network Devices', section: 'network', realtimeTopic: 'home/network/devices/+' },
  async execute(input, _ctx) {
    const { unifi } = getClients()
    if (!unifi) throw new Error('UniFi not configured')
    let clients = await unifi.getActiveClients()
    if (input.onlineOnly !== undefined) {
      // Active clients from UniFi are always currently online
      // onlineOnly: false would include historical — not supported by this endpoint
    }
    if (input.vlan !== undefined) {
      clients = clients.filter((c: any) => c.vlan === input.vlan)
    }
    return clients
  },
})

export const getWanHealth = defineAction({
  name: 'get_wan_health',
  description: 'Check internet connectivity status and latency.',
  input: z.object({}),
  output: z.object({
    online: z.boolean(),
    latencyMs: z.number().optional(),
    wanIp: z.string().optional(),
  }),
  http: { method: 'GET' },
  ai: { tier: 'inform' },
  ui: { label: 'WAN Health', section: 'network' },
  async execute(_input, _ctx) {
    const { unifi } = getClients()
    if (!unifi) throw new Error('UniFi not configured')
    const health = await unifi.getHealth()
    const wan = health.find((h: any) => h.subsystem === 'wan')
    return {
      online: wan?.status === 'ok',
      wanIp: wan?.wan_ip,
    }
  },
})

export const blockDevice = defineAction({
  name: 'block_device',
  description: 'Block a device from accessing the network by MAC address. Use when a device is identified as unauthorized or suspicious.',
  input: z.object({
    mac: macSchema,
    reason: z.string().optional(),
  }),
  output: z.object({ success: z.boolean() }),
  http: { method: 'POST' },
  ai: {
    tier: 'act',
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

export const unblockDevice = defineAction({
  name: 'unblock_device',
  description: 'Unblock a previously blocked device, restoring its network access.',
  input: z.object({ mac: macSchema }),
  output: z.object({ success: z.boolean() }),
  http: { method: 'POST' },
  ai: { tier: 'act' },
  ui: false,
  async execute(input, ctx) {
    const { unifi } = getClients()
    if (!unifi) throw new Error('UniFi not configured')
    await unifi.unblockClient(input.mac)
    ctx.emit('home/network/devices/unblocked', { mac: input.mac })
    return { success: true }
  },
})

export const getTopology = defineAction({
  name: 'get_topology',
  description: 'Get the home network topology: access points, switches, VLANs, and connected device counts.',
  input: z.object({}),
  output: z.object({
    accessPoints: z.array(z.object({
      name: z.string(),
      mac: z.string(),
      status: z.string(),
      clients: z.number(),
    })),
    switches: z.array(z.object({
      name: z.string(),
      mac: z.string(),
      status: z.string(),
    })),
    vlans: z.array(z.object({
      name: z.string(),
      id: z.union([z.string(), z.number()]),
      purpose: z.string().optional(),
      deviceCount: z.number(),
    })),
    wanStatus: z.string(),
    wanIp: z.string().optional(),
  }),
  http: { method: 'GET' },
  ai: { tier: 'inform' },
  ui: { label: 'Network Topology', section: 'network' },
  async execute(_input, _ctx) {
    const { unifi } = getClients()
    if (!unifi) throw new Error('UniFi not configured')
    // Sequential calls — never Promise.all with UniFi (causes UDM to become unresponsive)
    const clients = await unifi.getActiveClients()
    const infraDevices = await unifi.getDevices()
    const health = await unifi.getHealth()
    const networks = await unifi.getNetworks()

    const wanHealth = health.find((h: any) => h.subsystem === 'wan')

    const accessPoints = infraDevices
      .filter((d: any) => d.type === 'uap')
      .map((ap: any) => ({
        name: ap.name || ap.mac,
        mac: ap.mac,
        status: ap.state === 1 ? 'online' : 'offline',
        clients: clients.filter((c: any) => c.ap_mac === ap.mac).length,
      }))

    const switches = infraDevices
      .filter((d: any) => d.type === 'usw')
      .map((sw: any) => ({
        name: sw.name || sw.mac,
        mac: sw.mac,
        status: sw.state === 1 ? 'online' : 'offline',
      }))

    const vlans = networks.map((n: any) => ({
      name: n.name,
      id: n.vlan || n._id,
      purpose: n.purpose,
      deviceCount: clients.filter(
        (c: any) => c.network === n.name || c.network_id === n._id
      ).length,
    }))

    return {
      accessPoints,
      switches,
      vlans,
      wanStatus: wanHealth?.status || 'unknown',
      wanIp: wanHealth?.wan_ip,
    }
  },
})

export const getNetworkAudit = defineAction({
  name: 'get_network_audit',
  description: 'Run a security audit of the home network. Returns findings about unusual devices, firewall config, and network health.',
  input: z.object({
    format: z.enum(['json', 'markdown']).optional(),
  }),
  output: z.object({
    findings: z.array(z.any()),
    summary: z.string(),
  }),
  http: { method: 'GET' },
  ai: {
    tier: 'advise',
    description: 'Run a security audit of the home network. Returns findings about unusual devices, firewall config, and network health. Call this when asked about network security or anomalies.',
  },
  ui: { label: 'Network Audit', section: 'network' },
  async execute(input, _ctx) {
    const { unifi } = getClients()
    if (!unifi) throw new Error('UniFi not configured')

    // Sequential calls — never Promise.all with UniFi
    const clients = await unifi.getActiveClients()
    const infraDevices = await unifi.getDevices()
    const health = await unifi.getHealth()
    const networks = await unifi.getNetworks()
    const firewallRules = await unifi.getFirewallRules()

    const findings: any[] = []
    const recommendations: string[] = []

    // WAN health
    const wanHealth = health.find((h: any) => h.subsystem === 'wan')
    if (wanHealth?.status !== 'ok') {
      findings.push({ type: 'warning', area: 'wan', message: `WAN status: ${wanHealth?.status || 'unknown'}` })
    }

    // IoT devices on main network
    const iotKeywords = /tv|roku|firestick|echo|alexa|nest|ring|wyze|plug|bulb|hue|sonos|roomba|klipsch|lgweb/i
    const mainNetIotDevices = clients.filter((c: any) => {
      const name = c.hostname || c.name || ''
      return iotKeywords.test(name) && (c.network === 'Default' || c.network === 'LAN' || !c.network)
    })
    if (mainNetIotDevices.length > 0) {
      const names = mainNetIotDevices.map((c: any) => c.hostname || c.name || c.mac).join(', ')
      findings.push({ type: 'recommendation', area: 'segmentation', message: `${mainNetIotDevices.length} IoT-like device(s) on main network: ${names}` })
      recommendations.push(`Move IoT devices to a dedicated VLAN: ${names}`)
    }

    // Weak WiFi signal
    const weakSignal = clients.filter((c: any) => c.rssi !== undefined && c.rssi < 20)
    if (weakSignal.length > 0) {
      findings.push({ type: 'info', area: 'wifi', message: `${weakSignal.length} client(s) with weak signal (RSSI < 20)` })
    }

    // Unidentified devices
    const unidentified = clients.filter((c: any) => !c.hostname && !c.name && !c.oui)
    if (unidentified.length > 0) {
      findings.push({ type: 'warning', area: 'inventory', message: `${unidentified.length} device(s) with no hostname or vendor information` })
    }

    // IoT VLAN existence
    const hasIotVlan = networks.some((n: any) => /iot/i.test(n.name))
    if (!hasIotVlan) {
      findings.push({ type: 'recommendation', area: 'segmentation', message: 'No IoT VLAN detected — consider creating one' })
    }

    // AP load balance
    const aps = infraDevices.filter((d: any) => d.type === 'uap')
    if (aps.length > 1) {
      const apClientCounts = aps.map((ap: any) => clients.filter((c: any) => c.ap_mac === ap.mac).length)
      const maxClients = Math.max(...apClientCounts)
      const minClients = Math.min(...apClientCounts)
      if (maxClients > minClients * 3 && maxClients > 10) {
        findings.push({ type: 'info', area: 'wifi', message: `AP load imbalance: max ${maxClients} clients vs min ${minClients}` })
      }
    }

    // Disabled firewall rules
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

export const getCameras = defineAction({
  name: 'get_cameras',
  description: 'Get all UniFi Protect cameras with their current state, recording status, and channel configuration.',
  input: z.object({}),
  output: z.array(z.object({
    id: z.string(),
    name: z.string(),
    type: z.string(),
    state: z.string(),
    isConnected: z.boolean(),
    isRecording: z.boolean(),
    isMotionDetected: z.boolean(),
    mac: z.string(),
  })),
  http: { method: 'GET' },
  ai: { tier: 'inform' },
  ui: { label: 'Cameras', section: 'protect', realtimeTopic: 'home/protect/cameras' },
  async execute(_input, _ctx) {
    const { protect } = getClients()
    if (!protect) throw new Error('UniFi Protect not configured')
    const cameras = await protect.getCameras()
    return cameras.map((cam: any) => ({
      id: cam.id,
      name: cam.name,
      type: cam.type,
      state: cam.state,
      isConnected: cam.isConnected,
      isRecording: cam.isRecording,
      isMotionDetected: cam.isMotionDetected,
      mac: cam.mac,
    }))
  },
})

export const getSnapshot = defineAction({
  name: 'get_snapshot',
  description: 'Get the current snapshot URL for a security camera by camera ID.',
  input: z.object({ cameraId: z.string() }),
  output: z.object({ url: z.string(), cameraName: z.string() }),
  http: { method: 'GET' },
  ai: {
    tier: 'inform',
    description: 'Get the current snapshot URL for a security camera by camera ID.',
  },
  ui: false,
  async execute(input, _ctx) {
    const { protect } = getClients()
    if (!protect) throw new Error('UniFi Protect not configured')
    const camera = await protect.getCamera(input.cameraId)
    // Protect snapshot URL pattern
    const host = process.env.UNIFI_HOST
    const url = `https://${host}/proxy/protect/api/cameras/${input.cameraId}/snapshot`
    return { url, cameraName: camera.name }
  },
})

export const getRecentCameraEvents = defineAction({
  name: 'get_recent_camera_events',
  description: 'Get recent motion and smart detection events from Protect cameras.',
  input: z.object({
    cameraId: z.string().optional(),
    limit: z.number().default(20),
  }),
  output: z.array(z.object({
    id: z.string(),
    type: z.string(),
    start: z.number(),
    end: z.number().nullable(),
    camera: z.string(),
    score: z.number(),
  })),
  http: { method: 'GET' },
  ai: { tier: 'inform' },
  ui: { label: 'Recent Events', section: 'protect' },
  async execute(input, _ctx) {
    const { protect } = getClients()
    if (!protect) throw new Error('UniFi Protect not configured')
    // Get events from the last 24 hours
    const end = Date.now()
    const start = end - 24 * 60 * 60 * 1000
    let events = await protect.getEvents({ start, end })
    if (input.cameraId) {
      events = events.filter((e: any) => e.camera === input.cameraId)
    }
    return events.slice(0, input.limit).map((e: any) => ({
      id: e.id,
      type: e.type,
      start: e.start,
      end: e.end ?? null,
      camera: e.camera,
      score: e.score ?? 0,
    }))
  },
})
