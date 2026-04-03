import type { createDsmClient } from "./dsm-client";
import type { NasHealth } from "@maisie/shared";

type Dsm = ReturnType<typeof createDsmClient>;

export async function getNasHealth(dsm: Dsm): Promise<NasHealth> {
  const sysInfo = await dsm.getSystemInfo();
  const utilization = await dsm.getSystemUtilization();
  const storage = await dsm.getStorageInfo();
  const containers = await dsm.getDockerContainers();

  const totalMem = Number(utilization.memory.total_real);
  const availMem = Number(utilization.memory.avail_real);
  const ramUsedPercent = totalMem > 0 ? Math.round(((totalMem - availMem) / totalMem) * 100) : 0;

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
      const total = Number(v.size.total);
      const used = Number(v.size.used);
      return {
        id: v.id,
        status: v.status,
        totalBytes: total,
        usedBytes: used,
        usedPercent: total > 0 ? Math.round((used / total) * 100) : 0,
      };
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
      state: c.state as "running" | "stopped" | "exited" | "created",
      uptime: c.up_time,
    })),
    timestamp: new Date().toISOString(),
  };
}
