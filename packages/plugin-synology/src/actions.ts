import { z } from 'zod'
import { defineAction } from '@maisie/shared'
import { getClients } from './clients'

const volumeSchema = z.object({
  id: z.string(),
  status: z.string(),
  totalBytes: z.number(),
  usedBytes: z.number(),
  usedPercent: z.number(),
})

const diskSchema = z.object({
  id: z.string(),
  name: z.string(),
  vendor: z.string(),
  model: z.string(),
  temp: z.number(),
  smartStatus: z.string(),
  sizeBytes: z.number(),
})

const containerSchema = z.object({
  name: z.string(),
  image: z.string(),
  status: z.string(),
  state: z.enum(['running', 'stopped', 'exited', 'created']),
  uptime: z.number().optional(),
})

const systemInfoSchema = z.object({
  model: z.string(),
  dsmVersion: z.string(),
  uptime: z.number(),
  cpuLoad: z.number(),
  ramUsedPercent: z.number(),
  temp: z.number(),
})

export const getHealth = defineAction({
  name: 'get_health',
  description: 'Get NAS health: volume status, disk health, container states, system load.',
  input: z.object({}),
  output: z.object({
    system: systemInfoSchema,
    volumes: z.array(volumeSchema),
    disks: z.array(diskSchema),
    containers: z.array(containerSchema),
    timestamp: z.string(),
  }),
  http: { method: 'GET' },
  ai: { tier: 'inform' },
  ui: { label: 'NAS Health', section: 'nas', realtimeTopic: 'home/nas/health' },
  async execute(_input, _ctx) {
    const { dsm } = getClients()
    if (!dsm) throw new Error('Synology not configured')

    const sysInfo = await dsm.getSystemInfo()
    const utilization = await dsm.getSystemUtilization()
    const storage = await dsm.getStorageInfo()
    const containers = await dsm.getDockerContainers()

    const totalMem = Number(utilization.memory.total_real)
    const availMem = Number(utilization.memory.avail_real)
    const ramUsedPercent = totalMem > 0 ? Math.round(((totalMem - availMem) / totalMem) * 100) : 0

    return {
      system: {
        model: sysInfo.model,
        dsmVersion: sysInfo.version_string,
        uptime: sysInfo.uptime,
        cpuLoad: utilization.cpu.system_load + utilization.cpu.user_load,
        ramUsedPercent,
        temp: sysInfo.temperature,
      },
      volumes: storage.volumes.map((v) => {
        const total = Number(v.size.total)
        const used = Number(v.size.used)
        return {
          id: v.id,
          status: v.status,
          totalBytes: total,
          usedBytes: used,
          usedPercent: total > 0 ? Math.round((used / total) * 100) : 0,
        }
      }),
      disks: storage.disks.map((d) => ({
        id: d.id,
        name: d.name,
        vendor: d.vendor,
        model: d.model,
        temp: d.temp,
        smartStatus: d.smart_status,
        sizeBytes: Number(d.size_total),
      })),
      containers: containers.map((c) => ({
        name: c.name,
        image: c.image,
        status: c.status,
        state: c.state as 'running' | 'stopped' | 'exited' | 'created',
        uptime: c.up_time,
      })),
      timestamp: new Date().toISOString(),
    }
  },
})

const fileEntrySchema = z.object({
  name: z.string(),
  path: z.string(),
  isdir: z.boolean(),
  size: z.number().optional(),
  mtime: z.number().optional(),
})

export const listFiles = defineAction({
  name: 'list_files',
  description: 'List files in a directory on the NAS.',
  input: z.object({
    path: z.string(),
  }),
  output: z.array(fileEntrySchema),
  http: { method: 'GET' },
  ai: { tier: 'inform' },
  ui: { label: 'Files', section: 'nas' },
  async execute(input, _ctx) {
    const { dsm } = getClients()
    if (!dsm) throw new Error('Synology not configured')
    const files = await dsm.listFiles(input.path)
    return files.map((f) => ({
      name: f.name,
      path: f.path,
      isdir: f.isdir,
      size: f.additional?.size,
      mtime: f.additional?.time?.mtime,
    }))
  },
})

export const getContainerStatus = defineAction({
  name: 'get_container_status',
  description: 'Get the status of all Docker containers running on the NAS.',
  input: z.object({}),
  output: z.array(containerSchema),
  http: { method: 'GET' },
  ai: { tier: 'inform' },
  ui: { label: 'Containers', section: 'nas' },
  async execute(_input, _ctx) {
    const { dsm } = getClients()
    if (!dsm) throw new Error('Synology not configured')
    const containers = await dsm.getDockerContainers()
    return containers.map((c) => ({
      name: c.name,
      image: c.image,
      status: c.status,
      state: c.state as 'running' | 'stopped' | 'exited' | 'created',
      uptime: c.up_time,
    }))
  },
})

export const getSystemInfo = defineAction({
  name: 'get_system_info',
  description: 'Get NAS system information: model, DSM version, uptime, CPU and memory usage.',
  input: z.object({}),
  output: systemInfoSchema,
  http: { method: 'GET' },
  ai: { tier: 'inform' },
  ui: { label: 'System Info', section: 'nas' },
  async execute(_input, _ctx) {
    const { dsm } = getClients()
    if (!dsm) throw new Error('Synology not configured')
    const sysInfo = await dsm.getSystemInfo()
    const utilization = await dsm.getSystemUtilization()
    const totalMem = Number(utilization.memory.total_real)
    const availMem = Number(utilization.memory.avail_real)
    const ramUsedPercent = totalMem > 0 ? Math.round(((totalMem - availMem) / totalMem) * 100) : 0
    return {
      model: sysInfo.model,
      dsmVersion: sysInfo.version_string,
      uptime: sysInfo.uptime,
      cpuLoad: utilization.cpu.system_load + utilization.cpu.user_load,
      ramUsedPercent,
      temp: sysInfo.temperature,
    }
  },
})
